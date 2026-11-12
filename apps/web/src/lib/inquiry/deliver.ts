/**
 * Durable lead acceptance: the rule for when an inquiry counts as received,
 * and the recovery loop for anything not yet delivered.
 *
 * WHAT "ACCEPTED" MEANS. `accepted: true` means the lead is safely recorded:
 * stored in D1, or (if D1 is unavailable) taken by the CRM or Sean's inbox.
 * It does not mean every delivery has happened. A duplicate submission is
 * accepted with the original lead id whatever that lead's delivery state is;
 * recovery owns the rest.
 *
 * Storage is D1 (SQLite; binding LEADS_DB): strongly consistent with atomic
 * statements.
 * - Idempotent submission: `idem_key` is UNIQUE, so concurrent submissions
 *   with the same client event id insert exactly one row.
 * - No invisible leads: the row is inserted with every channel `pending` (or
 *   `skipped` if unconfigured) in one write; open work is a query on rows.
 * - Fast response: once the row is stored, delivery can run after the
 *   response (`defer`, i.e. Cloudflare's waitUntil), so a slow CRM never
 *   delays the visitor.
 *
 * Deliveries (CRM, notify Sean, confirm to the visitor) run under a LEASE per
 * channel: a random token plus an expiry.
 * - To START a step (any remote call) a runner must hold an UNEXPIRED lease;
 *   the check renews it (a heartbeat), so a long but live delivery keeps it.
 * - To RECORD a result or a CRM checkpoint, the token must still be the
 *   channel's lease token. An expired holder that nobody has replaced still
 *   records: its result is the truth, and discarding it would only cause a
 *   redundant resend. Once another runner claims the channel, the old token
 *   is fenced out.
 * - Every external call times out after 20 s, far inside the lease.
 *
 * Guarantee: at-least-once delivery. A duplicate is possible whenever a remote
 * service acted but this side never learned it: the call timed out or the
 * response was lost after the service processed it, or the Worker died before
 * checkpointing. Retries then repeat that step. Only remote idempotency or
 * reconciliation closes this (the contact upsert is idempotent; the
 * opportunity and Resend emails are on the integration test list).
 *
 * A channel that was not configured when the lead arrived is `skipped`; it is
 * delivered once the channel is configured (CRM backfill; Sean is told about
 * leads that arrived before email was set up; confirmations only within 24 h).
 *
 * Retention: resolved leads are deleted after 90 days. A lead whose CRM or
 * notification never completed is held up to 180 days so it can still be
 * recovered (disclosed on /privacy), then deleted with an error log line.
 *
 * Logs never carry raw exception messages, only allowlisted codes
 * (lib/security/errors.ts). No Astro or Cloudflare imports: side effects are
 * injected, so the failure paths are unit-tested against real SQLite.
 */
import { errorCode } from '../security/errors';

/** pending: not yet done · skipped: channel not configured yet · abandoned: gave up (attempt limit, or a confirmation too old to send). */
export type Outcome = 'pending' | 'delivered' | 'failed' | 'skipped' | 'abandoned';
export type Channel = 'crm' | 'notify' | 'confirm';
const CHANNELS: Channel[] = ['crm', 'notify', 'confirm'];

/** Steps the CRM has completed for this lead; persisted after each one, and skipped on retry. */
export interface CrmProgress {
  contactId?: string;
  opportunityId?: string;
  noted?: boolean;
}

export interface LeadRecord<I = unknown, L = unknown> {
  leadId: string;
  channel: 'form' | 'scout';
  createdAt: string;
  inquiry: I;
  lead: L;
  /** Same person across leads (a hash of the normalized email): links a form inquiry and a Scout one. */
  contactKey?: string;
}

/** The subset of Cloudflare's D1Database used here (a node:sqlite shim implements it in tests). */
export interface LeadDB {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      run(): Promise<{ meta: { changes: number } }>;
      first<T = Record<string, unknown>>(): Promise<T | null>;
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
    };
  };
}

/** Lease guard for one delivery. */
export interface Lease {
  /** Before any remote call: throws LeaseLost unless this runner holds an unexpired lease; renews it. */
  guard(): Promise<void>;
  /** After a CRM step: saves progress while the token still holds the lease; throws LeaseLost otherwise. */
  save(progress: CrmProgress): Promise<void>;
}
type CrmSink<R> = ((record: R, progress: CrmProgress, lease: Lease) => Promise<void>) | null;
type Sink<R> = ((record: R) => Promise<void>) | null;

export interface DeliveryDeps<R extends LeadRecord = LeadRecord> {
  /** Lead database (D1). null = not bound. */
  db: LeadDB | null;
  /** Throws when the CRM did not take the lead. Guards before and saves after each step. null = not configured. */
  sendToCrm: CrmSink<R>;
  /** Throws when the owner notification was not sent. null = not configured. */
  notifyOwner: Sink<R>;
  /** Throws when the visitor's confirmation was not sent. null = not configured. */
  confirmVisitor: Sink<R>;
  /** Development with nothing configured: accept without delivering, so the form can be exercised. */
  allowDryRun: boolean;
  /** Operational log. Never pass personal data: lead IDs, outcomes and error codes only. */
  log: (event: string, fields: Record<string, unknown>) => void;
  /** Runs work after the response (Cloudflare's waitUntil). Without it, delivery is awaited inline. */
  defer?: (work: Promise<unknown>) => void;
  /** Clock in ms (tests move it to expire leases). */
  now?: () => number;
}

export const RETENTION_DAYS = 90;
/** Unresolved leads (CRM or notification never completed) are kept this long for recovery. */
export const UNRESOLVED_RETENTION_DAYS = 180;
export const MAX_ATTEMPTS = 5;
/** Lease length; renewed at every guard. Each external call times out after 20 s. */
export const LEASE_MS = 5 * 60_000;
/** A confirmation older than this is no longer sent ("we'll reply within a day" would be stale). */
export const CONFIRM_MAX_AGE_MS = 24 * 3_600_000;

export class LeaseLost extends Error {
  constructor() {
    super('lease_lost');
  }
}

/** The identity columns every version of the table has had. */
const KEY_COLUMNS = `lead_id TEXT PRIMARY KEY, idem_key TEXT UNIQUE, channel TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL`;

/**
 * Every other column, in order. Each must be addable with ALTER TABLE ADD
 * COLUMN (nullable, or NOT NULL with a constant default), because this list
 * is also the migration: a table created by an earlier version gets the
 * columns it lacks. To add a column, append it here.
 */
const COLUMNS: [name: string, ddl: string][] = [
  ['crm', `TEXT NOT NULL DEFAULT 'pending'`], ['crm_error', 'TEXT'], ['crm_attempts', 'INTEGER NOT NULL DEFAULT 0'],
  ['crm_lease', 'TEXT'], ['crm_lease_until', 'INTEGER'], ['crm_progress', `TEXT NOT NULL DEFAULT '{}'`],
  ['notify', `TEXT NOT NULL DEFAULT 'pending'`], ['notify_error', 'TEXT'], ['notify_attempts', 'INTEGER NOT NULL DEFAULT 0'],
  ['notify_lease', 'TEXT'], ['notify_lease_until', 'INTEGER'],
  ['confirm', `TEXT NOT NULL DEFAULT 'pending'`], ['confirm_error', 'TEXT'], ['confirm_attempts', 'INTEGER NOT NULL DEFAULT 0'],
  ['confirm_lease', 'TEXT'], ['confirm_lease_until', 'INTEGER'],
  ['last_attempt_at', 'INTEGER'],
  ['contact_key', 'TEXT'],
];

const ready = new WeakMap<LeadDB, Promise<void>>();

/**
 * Creates the table on first use and migrates an older one, idempotently: no
 * separate migration step per environment. Columns missing from an existing
 * table (PRAGMA table_info) are added; a concurrent isolate adding the same
 * column first is tolerated. Existing rows are kept and get each new column's default.
 */
export function ensureSchema(db: LeadDB): Promise<void> {
  let p = ready.get(db);
  if (!p) {
    p = (async () => {
      await db.prepare(`CREATE TABLE IF NOT EXISTS leads (${KEY_COLUMNS}, ${COLUMNS.map(([n, d]) => `${n} ${d}`).join(', ')})`).bind().run();
      const present = async () => new Set((await db.prepare('PRAGMA table_info(leads)').bind().all<{ name: string }>()).results.map((c) => c.name));
      const have = await present();
      for (const [name, ddl] of COLUMNS) {
        if (have.has(name)) continue;
        try {
          await db.prepare(`ALTER TABLE leads ADD COLUMN ${name} ${ddl}`).bind().run();
        } catch (e) {
          if (!(await present()).has(name)) throw e; // a real failure, not a concurrent add
        }
      }
      await db.prepare('CREATE INDEX IF NOT EXISTS leads_created ON leads (created_at, lead_id)').bind().run();
      await db.prepare('CREATE INDEX IF NOT EXISTS leads_contact ON leads (contact_key, created_at)').bind().run();
    })();
    p.catch(() => ready.delete(db));
    ready.set(db, p);
  }
  return p;
}

const token = () => crypto.randomUUID();
const isoDaysAgo = (now: number, days: number) => new Date(now - days * 864e5).toISOString();
/** States a channel can still be delivered from (when configured). */
const RETRYABLE = "('pending','failed','skipped')";

/** Records a channel's result and releases the lease, if `tok` still holds it (see header). */
async function finish(db: LeadDB, leadId: string, ch: Channel, tok: string, outcome: Outcome, error?: string): Promise<boolean> {
  const r = await db
    .prepare(`UPDATE leads SET ${ch} = ?, ${ch}_error = ?, ${ch}_lease = NULL, ${ch}_lease_until = NULL WHERE lead_id = ? AND ${ch}_lease = ?`)
    .bind(outcome, error ?? null, leadId, tok)
    .run();
  return r.meta.changes === 1;
}

function lease(db: LeadDB, leadId: string, ch: Channel, tok: string, clock: () => number): Lease {
  return {
    async guard() {
      const now = clock();
      const r = await db
        .prepare(`UPDATE leads SET ${ch}_lease_until = ? WHERE lead_id = ? AND ${ch}_lease = ? AND ${ch}_lease_until > ?`)
        .bind(now + LEASE_MS, leadId, tok, now)
        .run();
      if (r.meta.changes !== 1) throw new LeaseLost();
    },
    async save(progress) {
      const r = await db.prepare('UPDATE leads SET crm_progress = ? WHERE lead_id = ? AND crm_lease = ?').bind(JSON.stringify(progress), leadId, tok).run();
      if (r.meta.changes !== 1) throw new LeaseLost();
    },
  };
}

/** Without a stored row there is nothing to lease: delivery proceeds unguarded. */
const NO_LEASE: Lease = { guard: async () => {}, save: async () => {} };

type RunResult = { outcome: 'delivered' | 'failed'; error?: string; leaseLost?: boolean };

/** Runs one delivery and turns it into an outcome; a lost lease is reported as such, never as delivered. */
async function run(fn: () => Promise<void>): Promise<RunResult> {
  try {
    await fn();
    return { outcome: 'delivered' };
  } catch (e) {
    return { outcome: 'failed', error: errorCode(e), leaseLost: e instanceof LeaseLost };
  }
}

/** One delivery under a lease: guard first, then the sink (the CRM sink guards each of its own steps). */
function deliver<R extends LeadRecord>(ch: Channel, sinks: Record<Channel, unknown>, record: R, l: Lease, progress: CrmProgress): Promise<RunResult> {
  return ch === 'crm'
    ? run(() => (sinks.crm as NonNullable<CrmSink<R>>)(record, progress, l))
    : run(() => l.guard().then(() => (sinks[ch] as NonNullable<Sink<R>>)(record)));
}

/**
 * Retention: resolved leads go after 90 days; unresolved ones (CRM not
 * delivered, or Sean never notified) are kept to 180 days for recovery.
 */
export async function purgeExpired(db: LeadDB, log: DeliveryDeps['log'], now = Date.now()): Promise<{ resolved: number; unresolved: number }> {
  await ensureSchema(db);
  const resolved = "crm = 'delivered' AND notify IN ('delivered','skipped') AND confirm NOT IN ('pending','failed')";
  const a = await db.prepare(`DELETE FROM leads WHERE created_at < ? AND ${resolved}`).bind(isoDaysAgo(now, RETENTION_DAYS)).run();
  const cutoff = isoDaysAgo(now, UNRESOLVED_RETENTION_DAYS);
  // A sample of ids for the alert, never the whole set: the DELETE reports the count.
  const sample = (await db.prepare('SELECT lead_id FROM leads WHERE created_at < ? LIMIT 20').bind(cutoff).all<{ lead_id: string }>()).results;
  const b = sample.length ? await db.prepare('DELETE FROM leads WHERE created_at < ?').bind(cutoff).run() : { meta: { changes: 0 } };
  if (b.meta.changes) log('lead_retention_expired_unresolved', { count: b.meta.changes, leadIds: sample.map((r) => r.lead_id) });
  return { resolved: a.meta.changes, unresolved: b.meta.changes };
}

/**
 * Visitors are told "received" once a lead is stored; Sean learns of it from the
 * notification. A lead whose notification is still undelivered NOTIFY_OVERDUE_MS
 * after acceptance (pending, failing or abandoned) is overdue: the cron logs
 * lead_notify_overdue so an alert reaches Sean before the visitor waits a day.
 * Only the last 7 days count, so an old abandoned lead doesn't alert forever
 * (GET /api/leads still lists it).
 */
export const NOTIFY_OVERDUE_MS = 30 * 60_000;
export async function overdueNotifications(db: LeadDB, now = Date.now()): Promise<number> {
  await ensureSchema(db);
  const r = await db
    .prepare("SELECT COUNT(*) AS n FROM leads WHERE notify IN ('pending','failed','abandoned') AND created_at < ? AND created_at >= ?")
    .bind(new Date(now - NOTIFY_OVERDUE_MS).toISOString(), isoDaysAgo(now, 7))
    .all<{ n: number }>();
  return r.results[0]?.n ?? 0;
}

export interface RelatedLead { leadId: string; channel: string; createdAt: string }

/**
 * Earlier leads from the same person (contact key) in the last `days`: a couple
 * who used both the form and Scout, or a planner following up. Each is still
 * its own lead and is delivered; this only lets Sean and the CRM see them as
 * one relationship. Oldest first, at most 5.
 */
export async function relatedLeads(db: LeadDB, contactKey: string, now = Date.now(), days = 60): Promise<RelatedLead[]> {
  await ensureSchema(db);
  const r = await db
    .prepare('SELECT lead_id, channel, created_at FROM leads WHERE contact_key = ? AND created_at >= ? ORDER BY created_at LIMIT 5')
    .bind(contactKey, isoDaysAgo(now, days))
    .all<{ lead_id: string; channel: string; created_at: string }>();
  return r.results.map((x) => ({ leadId: x.lead_id, channel: x.channel, createdAt: x.created_at }));
}

export interface AcceptResult {
  accepted: boolean;
  leadId: string;
  duplicate?: boolean;
  /** Present when delivery ran inline; absent when it was deferred past the response. */
  delivery?: Record<Channel, Outcome>;
}

export async function acceptLead<R extends LeadRecord>(record: R, deps: DeliveryDeps<R>, idempotencyKey?: string): Promise<AcceptResult> {
  const { db, log } = deps;
  const clock = () => deps.now?.() ?? Date.now();
  const now = clock();
  const tok = token();
  const sinks = { crm: deps.sendToCrm, notify: deps.notifyOwner, confirm: deps.confirmVisitor };

  // 1. Store, with every configured channel already leased to this request, so a
  //    concurrent retry run cannot pick the lead up while it is being delivered.
  //    ON CONFLICT on the unique idempotency key makes duplicate submissions lose atomically.
  let stored = false;
  if (db) {
    try {
      await ensureSchema(db);
      const held = (ch: Channel) => (sinks[ch] ? ['pending', tok, now + LEASE_MS, 1] : ['skipped', null, null, 0]);
      const ins = await db
        .prepare(`INSERT INTO leads (lead_id, idem_key, channel, created_at, data, contact_key,
            crm, crm_lease, crm_lease_until, crm_attempts, notify, notify_lease, notify_lease_until, notify_attempts, confirm, confirm_lease, confirm_lease_until, confirm_attempts)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (idem_key) DO NOTHING`)
        .bind(record.leadId, idempotencyKey ?? null, record.channel, record.createdAt, JSON.stringify({ inquiry: record.inquiry, lead: record.lead }), record.contactKey ?? null, ...held('crm'), ...held('notify'), ...held('confirm'))
        .run();
      if (ins.meta.changes === 0 && idempotencyKey) {
        const prior = await db.prepare('SELECT lead_id FROM leads WHERE idem_key = ?').bind(idempotencyKey).first<{ lead_id: string }>();
        if (prior) {
          log('lead_duplicate', { leadId: prior.lead_id, channel: record.channel });
          return { accepted: true, leadId: prior.lead_id, duplicate: true };
        }
      }
      stored = ins.meta.changes === 1;
    } catch (e) {
      log('lead_store_failed', { leadId: record.leadId, error: errorCode(e) });
    }
  }

  const one = (ch: Channel): Promise<RunResult | null> =>
    sinks[ch] ? deliver(ch, sinks, record, stored ? lease(db!, record.leadId, ch, tok, clock) : NO_LEASE, {}) : Promise.resolve(null);
  type Results = Partial<Record<Channel, RunResult | null>>;
  const report = (results: Results, nothingConfigured: boolean) => {
    const delivery = Object.fromEntries(CHANNELS.map((ch) => [ch, results[ch]?.outcome ?? 'skipped'])) as Record<Channel, Outcome>;
    const failed = CHANNELS.some((ch) => results[ch]?.outcome === 'failed');
    log(nothingConfigured ? 'lead_dry_run' : failed ? 'lead_delivery_failed' : 'lead_accepted', {
      leadId: record.leadId, channel: record.channel, stored, ...delivery,
      crmError: results.crm?.error, notifyError: results.notify?.error, confirmError: results.confirm?.error,
    });
    return delivery;
  };

  // 2a. Stored: the lead is safe. Deliver after the response when we can.
  if (stored) {
    // The three channels are independent and separately leased: they run concurrently,
    // and each records its outcome as soon as it completes, so a stalled CRM never holds
    // back Sean's email or the visitor's confirmation.
    const settle = async (ch: Channel): Promise<RunResult | null> => {
      const r = await one(ch);
      if (!r) return null;
      try {
        if (!(await finish(db!, record.leadId, ch, tok, r.outcome, r.error))) log('lead_lease_lost', { leadId: record.leadId, channel: ch });
      } catch (e) {
        log('lead_state_write_failed', { leadId: record.leadId, channel: ch, error: errorCode(e) });
      }
      return r;
    };
    const work = (async () => {
      const [crm, notify, confirm] = await Promise.all(CHANNELS.map(settle));
      return report({ crm, notify, confirm }, false);
    })();
    if (deps.defer) {
      deps.defer(work.catch((e) => log('lead_delivery_crashed', { leadId: record.leadId, error: errorCode(e) })));
      return { accepted: true, leadId: record.leadId };
    }
    return { accepted: true, leadId: record.leadId, delivery: await work };
  }

  // 2b. Not stored: acceptance depends on delivery, so it runs inline.
  const crm = await one('crm');
  const notify = await one('notify');
  const nothingConfigured = !db && !sinks.crm && !sinks.notify;
  const durable = crm?.outcome === 'delivered' || notify?.outcome === 'delivered';
  if (!durable && !(nothingConfigured && deps.allowDryRun)) {
    log('lead_undeliverable', { leadId: record.leadId, channel: record.channel, stored, crm: crm?.outcome ?? 'skipped', crmError: crm?.error, notify: notify?.outcome ?? 'skipped', notifyError: notify?.error });
    return { accepted: false, leadId: record.leadId };
  }
  const confirm = await one('confirm');
  return { accepted: true, leadId: record.leadId, delivery: report({ crm, notify, confirm }, nothingConfigured) };
}

// ── Recovery ────────────────────────────────────────────────────────────────

type Row = {
  lead_id: string; channel: 'form' | 'scout'; created_at: string; data: string; crm_progress: string;
} & { [K in `${Channel}`]: Outcome } & { [K in `${Channel}_error`]: string | null } & { [K in `${Channel}_attempts`]: number } & { [K in `${Channel}_lease_until`]: number | null };

export interface OpenLead {
  leadId: string;
  createdAt: string;
  channels: Record<Channel, { state: Outcome; attempts: number; error?: string; inProgress?: boolean }>;
}

const summary = (r: Row, now: number): OpenLead => ({
  leadId: r.lead_id,
  createdAt: r.created_at,
  channels: Object.fromEntries(CHANNELS.map((ch) => [ch, {
    state: r[ch], attempts: r[`${ch}_attempts`],
    ...(r[`${ch}_error`] ? { error: r[`${ch}_error`]! } : {}),
    ...((r[`${ch}_lease_until`] ?? 0) > now ? { inProgress: true } : {}),
  }])) as OpenLead['channels'],
});

/** Cursor = "<created_at>|<lead_id>" of the last row on the previous page (keyset paging). */
function decodeCursor(cursor?: string | null): [string, string] {
  const [a = '', b = ''] = (cursor ?? '').split('|');
  return [a, b];
}

/**
 * Admin view rows: everything an operator should see: the CRM until
 * delivered (including leads waiting for it to be connected), and email
 * channels that are pending or failed. Keyset-paged by creation time.
 */
async function openRows(db: LeadDB, opts: { limit: number; cursor?: string | null }): Promise<Row[]> {
  await ensureSchema(db);
  const [c, id] = decodeCursor(opts.cursor);
  const sql = `SELECT * FROM leads WHERE (crm IN ${RETRYABLE} OR notify IN ('pending','failed') OR confirm IN ('pending','failed'))
    AND (created_at > ? OR (created_at = ? AND lead_id > ?)) ORDER BY created_at, lead_id LIMIT ?`;
  return (await db.prepare(sql).bind(c, c, id, opts.limit).all<Row>()).results;
}

/**
 * A row is retried at most once per this window, so repeated batches (and
 * runs) move on through a backlog. Per lead, not per channel: a channel that
 * becomes deliverable just after the lead's CRM retry waits for the lead's
 * next turn. Deliberate; per-channel scheduling isn't worth it at this volume.
 */
export const RETRY_SPACING_MS = 10 * 60_000;

/**
 * Retry candidates: rows with a channel that is configured, retryable and
 * not leased right now, not attempted in the last RETRY_SPACING_MS. Never-
 * attempted rows come first, then the least recently attempted: a large
 * backlog is worked round-robin, with no cursor state to keep between runs,
 * and leased rows never take a batch slot.
 */
async function claimableRows(db: LeadDB, channels: Channel[], limit: number, now: number): Promise<Row[]> {
  await ensureSchema(db);
  const free = channels.map((ch) => `(${ch} IN ${RETRYABLE} AND (${ch}_lease_until IS NULL OR ${ch}_lease_until <= ?))`).join(' OR ');
  const sql = `SELECT * FROM leads WHERE (${free}) AND (last_attempt_at IS NULL OR last_attempt_at <= ?)
    ORDER BY last_attempt_at IS NOT NULL, last_attempt_at, created_at, lead_id LIMIT ?`;
  return (await db.prepare(sql).bind(...channels.map(() => now), now - RETRY_SPACING_MS, limit).all<Row>()).results;
}

/** Marks a row as taken by this retry round; false if another runner took it first. */
async function touch(db: LeadDB, leadId: string, now: number): Promise<boolean> {
  const r = await db
    .prepare('UPDATE leads SET last_attempt_at = ? WHERE lead_id = ? AND (last_attempt_at IS NULL OR last_attempt_at <= ?)')
    .bind(now, leadId, now - RETRY_SPACING_MS)
    .run();
  return r.meta.changes === 1;
}

export interface OpenPage { leads: OpenLead[]; nextCursor: string | null; counts: Record<string, number> }

/** Admin view: every lead with outstanding work (no personal data), and per-state counts. */
export async function listOpen(db: LeadDB, opts: { limit?: number; cursor?: string | null; now?: number } = {}): Promise<OpenPage> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = await openRows(db, { limit, cursor: opts.cursor });
  const counts: Record<string, number> = {};
  const q = CHANNELS.map((ch) => `SELECT '${ch}:' || ${ch} AS k, COUNT(*) AS n FROM leads GROUP BY ${ch}`).join(' UNION ALL ');
  for (const r of (await db.prepare(q).bind().all<{ k: string; n: number }>()).results) counts[r.k] = r.n;
  const last = rows.at(-1);
  return { leads: rows.map((r) => summary(r, opts.now ?? Date.now())), nextCursor: rows.length === limit && last ? `${last.created_at}|${last.lead_id}` : null, counts };
}

export interface SourceReport {
  since: string;
  total: number;
  /** heard_via value ("unknown" when not given) -> inquiries per tier, and the total. */
  bySource: Record<string, { total: number; A: number; B: number; C: number }>;
}

/**
 * Inquiries per self-reported source and tier over the last `days` (default 90, the
 * retention window for resolved leads). Counts only, no personal data. Bookings live in
 * the CRM: compare these with won opportunities tagged heard:<source> there.
 */
export async function sourceReport(db: LeadDB, opts: { days?: number; now?: number } = {}): Promise<SourceReport> {
  const days = Math.min(Math.max(opts.days ?? 90, 1), 180);
  const since = new Date((opts.now ?? Date.now()) - days * 86_400_000).toISOString();
  const rows = (
    await db
      .prepare(`SELECT COALESCE(json_extract(data, '$.inquiry.heard_via'), 'unknown') AS source, COALESCE(json_extract(data, '$.lead.tier'), '?') AS tier, COUNT(*) AS n
        FROM leads WHERE created_at >= ? GROUP BY source, tier`)
      .bind(since)
      .all<{ source: string; tier: string; n: number }>()
  ).results;
  const bySource: SourceReport['bySource'] = {};
  let total = 0;
  for (const r of rows) {
    const s = (bySource[r.source] ??= { total: 0, A: 0, B: 0, C: 0 });
    const n = Number(r.n);
    s.total += n;
    total += n;
    if (r.tier === 'A' || r.tier === 'B' || r.tier === 'C') s[r.tier] += n;
  }
  return { since, total, bySource };
}

/**
 * Takes the lease for one channel if it is free (none, or expired) and the
 * attempt budget allows. Atomic: of any number of concurrent runners, at most
 * one gets it. Returns the token, or null.
 */
async function claim(db: LeadDB, leadId: string, ch: Channel, now: number): Promise<string | null> {
  const tok = token();
  const r = await db
    .prepare(`UPDATE leads SET ${ch}_lease = ?, ${ch}_lease_until = ?, ${ch}_attempts = ${ch}_attempts + 1
      WHERE lead_id = ? AND ${ch} IN ${RETRYABLE} AND ${ch}_attempts < ? AND (${ch}_lease_until IS NULL OR ${ch}_lease_until <= ?)`)
    .bind(tok, now + LEASE_MS, leadId, MAX_ATTEMPTS, now)
    .run();
  return r.meta.changes === 1 ? tok : null;
}

/** Marks a channel abandoned if it is out of attempts (or `force`, for a stale confirmation) and nobody holds it. */
async function abandon(db: LeadDB, leadId: string, ch: Channel, now: number, force = false): Promise<boolean> {
  const r = await db
    .prepare(`UPDATE leads SET ${ch} = 'abandoned', ${ch}_lease = NULL, ${ch}_lease_until = NULL
      WHERE lead_id = ? AND ${ch} IN ${RETRYABLE} AND (${force ? '1 = 1' : `${ch}_attempts >= ${MAX_ATTEMPTS}`}) AND (${ch}_lease_until IS NULL OR ${ch}_lease_until <= ?)`)
    .bind(leadId, now)
    .run();
  return r.meta.changes === 1;
}

/** Admin: put abandoned deliveries back in the queue with a fresh attempt budget (e.g. after a long CRM outage). */
export async function reopenAbandoned(db: LeadDB): Promise<number> {
  await ensureSchema(db);
  let n = 0;
  for (const ch of ['crm', 'notify'] as const) {
    n += (await db.prepare(`UPDATE leads SET ${ch} = 'failed', ${ch}_attempts = 0 WHERE ${ch} = 'abandoned'`).bind().run()).meta.changes;
  }
  return n;
}

export interface RetryResult { processed: number; delivered: Record<Channel, number>; abandoned: number; skippedInProgress: number }

/**
 * One bounded batch of retries over the channels that are configured. Call
 * again for the next batch: rows handled in this round are spaced out, so
 * each call reaches new rows; `processed: 0` means nothing is due.
 */
export async function retryOpen<R extends LeadRecord>(
  deps: Pick<DeliveryDeps<R>, 'db' | 'sendToCrm' | 'notifyOwner' | 'confirmVisitor' | 'log' | 'now'>,
  opts: { limit?: number } = {},
): Promise<RetryResult> {
  const out: RetryResult = { processed: 0, delivered: { crm: 0, notify: 0, confirm: 0 }, abandoned: 0, skippedInProgress: 0 };
  const { db, log } = deps;
  const sinks = { crm: deps.sendToCrm, notify: deps.notifyOwner, confirm: deps.confirmVisitor };
  const active = CHANNELS.filter((ch) => sinks[ch]);
  if (!db || !active.length) return out;
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const clock = () => deps.now?.() ?? Date.now();
  const rows = await claimableRows(db, active, limit, clock());

  for (const row of rows) {
    if (!(await touch(db, row.lead_id, clock()))) continue; // another runner took this row
    out.processed++;
    const { inquiry, lead } = JSON.parse(row.data) as { inquiry: R['inquiry']; lead: R['lead'] };
    const record = { leadId: row.lead_id, channel: row.channel, createdAt: row.created_at, inquiry, lead } as R;

    // Channels are independent and separately leased: retry them concurrently,
    // so a stalled CRM never holds back this lead's emails.
    await Promise.all(active.map(async (ch) => {
      if (!['pending', 'failed', 'skipped'].includes(row[ch])) return;
      const now = clock();

      // A confirmation that can no longer be timely is dropped rather than sent late.
      if (ch === 'confirm' && now - Date.parse(row.created_at) > CONFIRM_MAX_AGE_MS) {
        if (await abandon(db, row.lead_id, ch, now, true)) log('lead_confirm_expired', { leadId: row.lead_id });
        return;
      }
      if (row[`${ch}_attempts`] >= MAX_ATTEMPTS) {
        if (await abandon(db, row.lead_id, ch, now)) {
          out.abandoned++;
          log(`lead_${ch}_abandoned`, { leadId: row.lead_id, attempts: row[`${ch}_attempts`], error: row[`${ch}_error`] });
        }
        return;
      }
      const tok = await claim(db, row.lead_id, ch, now);
      if (!tok) {
        out.skippedInProgress++;
        return;
      }
      // Fresh read under the lease: another runner may have checkpointed CRM steps since the row was loaded.
      const progress = ch === 'crm'
        ? (JSON.parse((await db.prepare('SELECT crm_progress FROM leads WHERE lead_id = ?').bind(row.lead_id).first<{ crm_progress: string }>())?.crm_progress || '{}') as CrmProgress)
        : {};
      const r = await deliver(ch, sinks, record, lease(db, row.lead_id, ch, tok, clock), progress);
      const kept = await finish(db, row.lead_id, ch, tok, r.outcome, r.error);
      if (!kept || r.leaseLost) {
        log('lead_lease_lost', { leadId: row.lead_id, channel: ch });
        return;
      }
      if (r.outcome === 'delivered') out.delivered[ch]++;
      log(r.outcome === 'delivered' ? 'lead_retry_delivered' : 'lead_retry_failed', { leadId: row.lead_id, channel: ch, attempts: row[`${ch}_attempts`] + 1, error: r.error });
    }));
  }
  return out;
}
