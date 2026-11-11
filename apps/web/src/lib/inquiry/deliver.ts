/**
 * Durable lead acceptance: the rule for when an inquiry counts as received,
 * and the recovery loop for anything not yet delivered.
 *
 * Storage is D1 (SQLite; binding LEADS_DB): strongly consistent with atomic
 * statements.
 * - Idempotent submission: `idem_key` is UNIQUE, so concurrent submissions
 *   with the same client event id insert exactly one row.
 * - No invisible leads: the row is inserted with every channel `pending` in
 *   one write; open work is a query on the rows themselves.
 *
 * Deliveries (CRM, notify Sean, confirm to the visitor) run under a LEASE per
 * channel: a random token plus an expiry. Whoever holds an unexpired lease is
 * the only runner for that channel, whether it is the request that accepted
 * the lead or a later retry (cron every 15 minutes, or POST /api/leads).
 * Results and CRM checkpoints are written only while the writer's token still
 * holds the lease (fencing); a runner that lost its lease stops before its
 * next CRM step. Every external call has a timeout well inside the lease, so
 * a call cannot outlive the lease that authorised it.
 *
 * Guarantee: at-least-once delivery with duplicates confined to one window.
 * If the Worker dies after a remote call succeeded but before its checkpoint
 * was written, that one step can repeat after the lease expires. Closing that
 * window needs idempotency on the remote side (the contact upsert already is;
 * see docs/current/04-integrations-and-workflows.md for the opportunity).
 *
 * No Astro or Cloudflare imports: side effects are injected, so the failure
 * paths are unit-tested against real SQLite (evals/inquiry-delivery.test.mjs).
 */

/** pending: not yet done · skipped: channel not configured · abandoned: gave up (attempt limit, or a confirmation too old to send). */
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

/** Saves CRM progress under the caller's lease; throws LeaseLost if the lease has moved on. */
export type Checkpoint = (progress: CrmProgress) => Promise<void>;
type CrmSink<R> = ((record: R, progress: CrmProgress, checkpoint: Checkpoint) => Promise<void>) | null;
type Sink<R> = ((record: R) => Promise<void>) | null;

export interface DeliveryDeps<R extends LeadRecord = LeadRecord> {
  /** Lead database (D1). null = not bound. */
  db: LeadDB | null;
  /** Throws when the CRM did not take the lead. Calls `checkpoint` after each completed step. null = not configured. */
  sendToCrm: CrmSink<R>;
  /** Throws when the owner notification was not sent. null = not configured. */
  notifyOwner: Sink<R>;
  /** Throws when the visitor's confirmation was not sent. null = not configured. */
  confirmVisitor: Sink<R>;
  /** Development with nothing configured: accept without delivering, so the form can be exercised. */
  allowDryRun: boolean;
  /** Operational log. Never pass personal data: lead IDs and outcomes only. */
  log: (event: string, fields: Record<string, unknown>) => void;
  /** Clock in ms (tests move it to expire leases). */
  now?: () => number;
}

export const RETENTION_DAYS = 90;
export const MAX_ATTEMPTS = 5;
/** Lease length. Each external call times out after 20 s and a CRM attempt makes at most 3, so a live runner never outlasts its lease. */
export const LEASE_MS = 5 * 60_000;
/** A confirmation older than this is no longer sent ("we'll reply within a day" would be stale). */
export const CONFIRM_MAX_AGE_MS = 24 * 3_600_000;

export class LeaseLost extends Error {
  constructor() {
    super('lease_lost');
  }
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS leads (
    lead_id TEXT PRIMARY KEY,
    idem_key TEXT UNIQUE,
    channel TEXT NOT NULL,
    created_at TEXT NOT NULL,
    data TEXT NOT NULL,
    crm TEXT NOT NULL DEFAULT 'pending', crm_error TEXT, crm_attempts INTEGER NOT NULL DEFAULT 0,
    crm_lease TEXT, crm_lease_until INTEGER, crm_progress TEXT NOT NULL DEFAULT '{}',
    notify TEXT NOT NULL DEFAULT 'pending', notify_error TEXT, notify_attempts INTEGER NOT NULL DEFAULT 0,
    notify_lease TEXT, notify_lease_until INTEGER,
    confirm TEXT NOT NULL DEFAULT 'pending', confirm_error TEXT, confirm_attempts INTEGER NOT NULL DEFAULT 0,
    confirm_lease TEXT, confirm_lease_until INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS leads_created ON leads (created_at, lead_id)`,
];

const ready = new WeakMap<LeadDB, Promise<void>>();
/** Creates the table on first use (idempotent), so no migration step is needed per environment. */
export function ensureSchema(db: LeadDB): Promise<void> {
  let p = ready.get(db);
  if (!p) {
    p = (async () => {
      for (const sql of SCHEMA) await db.prepare(sql).bind().run();
    })();
    p.catch(() => ready.delete(db));
    ready.set(db, p);
  }
  return p;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 160);
const token = () => crypto.randomUUID();

/** Writes a channel's result only if `tok` still holds its lease, and releases the lease. */
async function finish(db: LeadDB, leadId: string, ch: Channel, tok: string, outcome: Outcome, error?: string): Promise<boolean> {
  const r = await db
    .prepare(`UPDATE leads SET ${ch} = ?, ${ch}_error = ?, ${ch}_lease = NULL, ${ch}_lease_until = NULL WHERE lead_id = ? AND ${ch}_lease = ?`)
    .bind(outcome, error ?? null, leadId, tok)
    .run();
  return r.meta.changes === 1;
}

function checkpointer(db: LeadDB, leadId: string, tok: string): Checkpoint {
  return async (progress) => {
    const r = await db.prepare('UPDATE leads SET crm_progress = ? WHERE lead_id = ? AND crm_lease = ?').bind(JSON.stringify(progress), leadId, tok).run();
    if (r.meta.changes !== 1) throw new LeaseLost();
  };
}

/** Runs one delivery and turns it into an outcome; a lost lease is reported as such, never as delivered. */
async function run(fn: () => Promise<void>): Promise<{ outcome: 'delivered' | 'failed'; error?: string; leaseLost?: boolean }> {
  try {
    await fn();
    return { outcome: 'delivered' };
  } catch (e) {
    return { outcome: 'failed', error: errText(e), leaseLost: e instanceof LeaseLost };
  }
}

export interface AcceptResult {
  accepted: boolean;
  leadId: string;
  duplicate?: boolean;
  delivery?: Record<Channel, Outcome>;
}

export async function acceptLead<R extends LeadRecord>(record: R, deps: DeliveryDeps<R>, idempotencyKey?: string): Promise<AcceptResult> {
  const { db, log } = deps;
  const now = deps.now?.() ?? Date.now();
  const tok = token();
  const until = now + LEASE_MS;
  const sinks = { crm: deps.sendToCrm, notify: deps.notifyOwner, confirm: deps.confirmVisitor };

  // 1. Store, with every configured channel already leased to this request, so a
  //    concurrent retry run cannot pick the lead up while it is being delivered.
  //    ON CONFLICT on the unique idempotency key makes duplicate submissions lose atomically.
  let stored = false;
  if (db) {
    try {
      await ensureSchema(db);
      await db.prepare('DELETE FROM leads WHERE created_at < ?').bind(new Date(now - RETENTION_DAYS * 864e5).toISOString()).run();
      const lease = (ch: Channel) => (sinks[ch] ? [tok, until, 1] : [null, null, 0]);
      const [crmL, crmU, crmA] = lease('crm');
      const [notL, notU, notA] = lease('notify');
      const [conL, conU, conA] = lease('confirm');
      const ins = await db
        .prepare(`INSERT INTO leads (lead_id, idem_key, channel, created_at, data,
            crm, crm_lease, crm_lease_until, crm_attempts, notify, notify_lease, notify_lease_until, notify_attempts, confirm, confirm_lease, confirm_lease_until, confirm_attempts)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (idem_key) DO NOTHING`)
        .bind(
          record.leadId, idempotencyKey ?? null, record.channel, record.createdAt, JSON.stringify({ inquiry: record.inquiry, lead: record.lead }),
          sinks.crm ? 'pending' : 'skipped', crmL, crmU, crmA,
          sinks.notify ? 'pending' : 'skipped', notL, notU, notA,
          sinks.confirm ? 'pending' : 'skipped', conL, conU, conA,
        )
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
      log('lead_store_failed', { leadId: record.leadId, error: errText(e) });
    }
  }

  // 2. Deliver to the CRM and Sean.
  const progress: CrmProgress = {};
  const checkpoint: Checkpoint = stored ? checkpointer(db!, record.leadId, tok) : async () => {};
  const crm = sinks.crm ? await run(() => sinks.crm!(record, progress, checkpoint)) : null;
  const notify = sinks.notify ? await run(() => sinks.notify!(record)) : null;

  // 3. Decide.
  const nothingConfigured = !db && !sinks.crm && !sinks.notify;
  const durable = stored || crm?.outcome === 'delivered' || notify?.outcome === 'delivered';
  if (!durable && !(nothingConfigured && deps.allowDryRun)) {
    log('lead_undeliverable', { leadId: record.leadId, channel: record.channel, stored, crm: crm?.outcome ?? 'skipped', crmError: crm?.error, notify: notify?.outcome ?? 'skipped', notifyError: notify?.error });
    return { accepted: false, leadId: record.leadId };
  }
  const confirm = sinks.confirm ? await run(() => sinks.confirm!(record)) : null;

  // 4. Record outcomes under the lease. A failed write leaves the row `pending`
  //    with an expiring lease, so recovery still finds it.
  const delivery: Record<Channel, Outcome> = { crm: crm?.outcome ?? 'skipped', notify: notify?.outcome ?? 'skipped', confirm: confirm?.outcome ?? 'skipped' };
  if (stored) {
    for (const [ch, r] of [['crm', crm], ['notify', notify], ['confirm', confirm]] as const) {
      if (!r) continue;
      try {
        if (!(await finish(db!, record.leadId, ch, tok, r.outcome, r.error))) log('lead_lease_lost', { leadId: record.leadId, channel: ch });
      } catch (e) {
        log('lead_state_write_failed', { leadId: record.leadId, channel: ch, error: errText(e) });
      }
    }
  }

  const failed = [crm, notify, confirm].some((r) => r?.outcome === 'failed');
  log(nothingConfigured ? 'lead_dry_run' : failed ? 'lead_delivery_failed' : 'lead_accepted', {
    leadId: record.leadId, channel: record.channel, stored, ...delivery,
    crmError: crm?.error, notifyError: notify?.error, confirmError: confirm?.error,
  });
  return { accepted: true, leadId: record.leadId, delivery };
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

/** States a channel can still move from; `skipped` only once that channel is configured. */
const statesFor = (configured: boolean) => (configured ? "('pending','failed','skipped')" : "('pending','failed')");

async function openRows(db: LeadDB, opts: { limit: number; cursor?: string | null; configured: Record<Channel, boolean> }): Promise<Row[]> {
  await ensureSchema(db);
  const [c, id] = decodeCursor(opts.cursor);
  const where = CHANNELS.map((ch) => `${ch} IN ${statesFor(opts.configured[ch])}`).join(' OR ');
  const sql = `SELECT * FROM leads WHERE (${where}) AND (created_at > ? OR (created_at = ? AND lead_id > ?)) ORDER BY created_at, lead_id LIMIT ?`;
  return (await db.prepare(sql).bind(c, c, id, opts.limit).all<Row>()).results;
}

export interface OpenPage { leads: OpenLead[]; nextCursor: string | null; counts: Record<string, number> }

/** Admin view: open leads (no personal data) and per-state counts. */
export async function listOpen(db: LeadDB, opts: { limit?: number; cursor?: string | null; now?: number } = {}): Promise<OpenPage> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = await openRows(db, { limit, cursor: opts.cursor, configured: { crm: true, notify: false, confirm: false } });
  const counts: Record<string, number> = {};
  const q = CHANNELS.map((ch) => `SELECT '${ch}:' || ${ch} AS k, COUNT(*) AS n FROM leads GROUP BY ${ch}`).join(' UNION ALL ');
  for (const r of (await db.prepare(q).bind().all<{ k: string; n: number }>()).results) counts[r.k] = r.n;
  const last = rows.at(-1);
  return { leads: rows.map((r) => summary(r, opts.now ?? Date.now())), nextCursor: rows.length === limit && last ? `${last.created_at}|${last.lead_id}` : null, counts };
}

/**
 * Takes the lease for one channel if it is free (none, or expired) and the
 * attempt budget allows. Atomic: of any number of concurrent runners, at most
 * one gets it. Returns the token, or null.
 */
async function claim(db: LeadDB, leadId: string, ch: Channel, states: string, now: number): Promise<string | null> {
  const tok = token();
  const r = await db
    .prepare(`UPDATE leads SET ${ch}_lease = ?, ${ch}_lease_until = ?, ${ch}_attempts = ${ch}_attempts + 1
      WHERE lead_id = ? AND ${ch} IN ${states} AND ${ch}_attempts < ? AND (${ch}_lease_until IS NULL OR ${ch}_lease_until <= ?)`)
    .bind(tok, now + LEASE_MS, leadId, MAX_ATTEMPTS, now)
    .run();
  return r.meta.changes === 1 ? tok : null;
}

/** Marks a channel abandoned if it is out of attempts (or a stale confirmation) and nobody holds it. */
async function abandon(db: LeadDB, leadId: string, ch: Channel, states: string, now: number, force = false): Promise<boolean> {
  const r = await db
    .prepare(`UPDATE leads SET ${ch} = 'abandoned', ${ch}_lease = NULL, ${ch}_lease_until = NULL
      WHERE lead_id = ? AND ${ch} IN ${states} AND (${force ? '1 = 1' : `${ch}_attempts >= ${MAX_ATTEMPTS}`}) AND (${ch}_lease_until IS NULL OR ${ch}_lease_until <= ?)`)
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

export interface RetryResult { processed: number; delivered: Record<Channel, number>; abandoned: number; skippedInProgress: number; nextCursor: string | null }

/**
 * One bounded batch of retries. Call again with `nextCursor` to continue;
 * null means the scan reached the end.
 */
export async function retryOpen<R extends LeadRecord>(
  deps: Pick<DeliveryDeps<R>, 'db' | 'sendToCrm' | 'notifyOwner' | 'confirmVisitor' | 'log' | 'now'>,
  opts: { limit?: number; cursor?: string | null } = {},
): Promise<RetryResult> {
  const out: RetryResult = { processed: 0, delivered: { crm: 0, notify: 0, confirm: 0 }, abandoned: 0, skippedInProgress: 0, nextCursor: null };
  const { db, log } = deps;
  const sinks = { crm: deps.sendToCrm, notify: deps.notifyOwner, confirm: deps.confirmVisitor };
  if (!db || (!sinks.crm && !sinks.notify && !sinks.confirm)) return out;
  const configured = { crm: !!sinks.crm, notify: !!sinks.notify, confirm: !!sinks.confirm };
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const clock = () => deps.now?.() ?? Date.now();
  const rows = await openRows(db, { limit, cursor: opts.cursor, configured });

  for (const row of rows) {
    out.processed++;
    const { inquiry, lead } = JSON.parse(row.data) as { inquiry: R['inquiry']; lead: R['lead'] };
    const record = { leadId: row.lead_id, channel: row.channel, createdAt: row.created_at, inquiry, lead } as R;

    for (const ch of CHANNELS) {
      const sink = sinks[ch];
      if (!sink) continue;
      const states = statesFor(true);
      if (!['pending', 'failed', 'skipped'].includes(row[ch])) continue;
      const now = clock();

      // A confirmation that can no longer be timely is dropped rather than sent late.
      if (ch === 'confirm' && now - Date.parse(row.created_at) > CONFIRM_MAX_AGE_MS) {
        if (await abandon(db, row.lead_id, ch, states, now, true)) log('lead_confirm_expired', { leadId: row.lead_id });
        continue;
      }
      if (row[`${ch}_attempts`] >= MAX_ATTEMPTS) {
        if (await abandon(db, row.lead_id, ch, states, now)) {
          out.abandoned++;
          log(`lead_${ch}_abandoned`, { leadId: row.lead_id, attempts: row[`${ch}_attempts`], error: row[`${ch}_error`] });
        }
        continue;
      }
      const tok = await claim(db, row.lead_id, ch, states, now);
      if (!tok) {
        out.skippedInProgress++;
        continue;
      }
      const r = ch === 'crm'
        ? await run(async () => {
            // Fresh read under the lease: another runner may have checkpointed steps since the page was loaded.
            const cur = await db.prepare('SELECT crm_progress FROM leads WHERE lead_id = ?').bind(row.lead_id).first<{ crm_progress: string }>();
            await sinks.crm!(record, JSON.parse(cur?.crm_progress || '{}') as CrmProgress, checkpointer(db, row.lead_id, tok));
          })
        : await run(() => (sink as (r: R) => Promise<void>)(record));
      const kept = await finish(db, row.lead_id, ch, tok, r.outcome, r.error);
      if (!kept || r.leaseLost) {
        log('lead_lease_lost', { leadId: row.lead_id, channel: ch });
        continue;
      }
      if (r.outcome === 'delivered') out.delivered[ch]++;
      log(r.outcome === 'delivered' ? 'lead_retry_delivered' : 'lead_retry_failed', { leadId: row.lead_id, channel: ch, attempts: row[`${ch}_attempts`] + 1, error: r.error });
    }
  }
  const last = rows.at(-1);
  out.nextCursor = rows.length === limit && last ? `${last.created_at}|${last.lead_id}` : null;
  return out;
}
