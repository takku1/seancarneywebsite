/**
 * Durable lead acceptance: the rule for when an inquiry counts as received,
 * and the recovery loop for anything not yet delivered.
 *
 * Storage is D1 (SQLite; binding LEADS_DB), chosen over KV because it is
 * strongly consistent and atomic:
 * - Idempotency: `idem_key` is UNIQUE, so of two concurrent submissions with
 *   the same client event id exactly one row is inserted; the other returns
 *   the first lead id.
 * - Recovery: a lead row is inserted with every channel `pending` in one
 *   write, so a lead can never be stored yet invisible to recovery. Open work
 *   is a query on the row itself, not a separate index.
 *
 * A visitor sees success only when the lead is held durably (the row, the
 * CRM, or Sean's notification inbox); then the confirmation email goes out.
 * `retryOpen` (cron every 15 minutes, or POST /api/leads) re-sends CRM and
 * notification deliveries in bounded, cursor-paged batches, keeps CRM
 * progress so a retry never repeats a completed step, and gives up after
 * MAX_ATTEMPTS with an error log line for alerting.
 *
 * No Astro or Cloudflare imports: side effects are injected, so the failure
 * paths are unit-tested against real SQLite (evals/inquiry-delivery.test.mjs).
 */

/** pending: not yet attempted · skipped: channel not configured · abandoned: gave up after MAX_ATTEMPTS. */
export type Outcome = 'pending' | 'delivered' | 'failed' | 'skipped' | 'abandoned';

/** Steps the CRM has completed for this lead; a retry skips them. */
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

type Sink<R> = ((record: R, progress: CrmProgress) => Promise<void>) | null;

export interface DeliveryDeps<R extends LeadRecord = LeadRecord> {
  /** Lead database (D1). null = not bound. */
  db: LeadDB | null;
  /** Throws when the CRM did not take the lead. Records completed steps in `progress`. null = not configured. */
  sendToCrm: Sink<R>;
  /** Throws when the owner notification was not sent. null = not configured. */
  notifyOwner: ((record: R) => Promise<void>) | null;
  confirmVisitor: ((record: R) => Promise<void>) | null;
  /** Development with nothing configured: accept without delivering, so the form can be exercised. */
  allowDryRun: boolean;
  /** Operational log. Never pass personal data: lead IDs and outcomes only. */
  log: (event: string, fields: Record<string, unknown>) => void;
  now?: () => Date;
}

export const RETENTION_DAYS = 90;
export const MAX_ATTEMPTS = 5;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS leads (
    lead_id TEXT PRIMARY KEY,
    idem_key TEXT UNIQUE,
    channel TEXT NOT NULL,
    created_at TEXT NOT NULL,
    data TEXT NOT NULL,
    crm TEXT NOT NULL DEFAULT 'pending',
    crm_error TEXT,
    crm_attempts INTEGER NOT NULL DEFAULT 0,
    crm_progress TEXT NOT NULL DEFAULT '{}',
    notify TEXT NOT NULL DEFAULT 'pending',
    notify_error TEXT,
    notify_attempts INTEGER NOT NULL DEFAULT 0,
    confirm TEXT NOT NULL DEFAULT 'pending'
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
const iso = (d: Date) => d.toISOString();

async function attempt(fn: () => Promise<void>): Promise<{ outcome: 'delivered' | 'failed'; error?: string }> {
  try {
    await fn();
    return { outcome: 'delivered' };
  } catch (e) {
    return { outcome: 'failed', error: errText(e) };
  }
}

export interface AcceptResult {
  accepted: boolean;
  leadId: string;
  duplicate?: boolean;
  delivery?: { crm: Outcome; notify: Outcome; confirm: Outcome };
}

export async function acceptLead<R extends LeadRecord>(record: R, deps: DeliveryDeps<R>, idempotencyKey?: string): Promise<AcceptResult> {
  const { db, log } = deps;
  const now = deps.now?.() ?? new Date();

  // 1. Store first. ON CONFLICT on the unique idempotency key makes concurrent duplicates lose atomically.
  let stored = false;
  if (db) {
    try {
      await ensureSchema(db);
      await db.prepare('DELETE FROM leads WHERE created_at < ?').bind(iso(new Date(now.getTime() - RETENTION_DAYS * 864e5))).run();
      const ins = await db
        .prepare('INSERT INTO leads (lead_id, idem_key, channel, created_at, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT (idem_key) DO NOTHING')
        .bind(record.leadId, idempotencyKey ?? null, record.channel, record.createdAt, JSON.stringify({ inquiry: record.inquiry, lead: record.lead }))
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

  // 2. Deliver.
  const progress: CrmProgress = {};
  const crm = deps.sendToCrm ? await attempt(() => deps.sendToCrm!(record, progress)) : { outcome: 'skipped' as const };
  const notify = deps.notifyOwner ? await attempt(() => deps.notifyOwner!(record)) : { outcome: 'skipped' as const };

  // 3. Decide.
  const nothingConfigured = !db && !deps.sendToCrm && !deps.notifyOwner;
  const durable = stored || crm.outcome === 'delivered' || notify.outcome === 'delivered';
  if (!durable && !(nothingConfigured && deps.allowDryRun)) {
    log('lead_undeliverable', { leadId: record.leadId, channel: record.channel, stored, crm: crm.outcome, crmError: 'error' in crm ? crm.error : undefined, notify: notify.outcome, notifyError: 'error' in notify ? notify.error : undefined });
    return { accepted: false, leadId: record.leadId };
  }

  const confirm: Outcome = deps.confirmVisitor ? (await attempt(() => deps.confirmVisitor!(record))).outcome : 'skipped';
  const delivery = { crm: crm.outcome as Outcome, notify: notify.outcome as Outcome, confirm };

  // 4. Record outcomes. If this write fails the row keeps `pending`, so recovery still finds it.
  if (stored) {
    try {
      await db!
        .prepare('UPDATE leads SET crm = ?, crm_error = ?, crm_attempts = ?, crm_progress = ?, notify = ?, notify_error = ?, notify_attempts = ?, confirm = ? WHERE lead_id = ?')
        .bind(crm.outcome, 'error' in crm ? crm.error ?? null : null, deps.sendToCrm ? 1 : 0, JSON.stringify(progress), notify.outcome, 'error' in notify ? notify.error ?? null : null, deps.notifyOwner ? 1 : 0, confirm, record.leadId)
        .run();
    } catch (e) {
      log('lead_state_write_failed', { leadId: record.leadId, error: errText(e) });
    }
  }

  const failed = crm.outcome === 'failed' || notify.outcome === 'failed';
  log(nothingConfigured ? 'lead_dry_run' : failed ? 'lead_delivery_failed' : 'lead_accepted', {
    leadId: record.leadId, channel: record.channel, stored, ...delivery,
    crmError: 'error' in crm ? crm.error : undefined, notifyError: 'error' in notify ? notify.error : undefined,
  });
  return { accepted: true, leadId: record.leadId, delivery };
}

// ── Recovery ────────────────────────────────────────────────────────────────

interface Row {
  lead_id: string; channel: 'form' | 'scout'; created_at: string; data: string;
  crm: Outcome; crm_error: string | null; crm_attempts: number; crm_progress: string;
  notify: Outcome; notify_error: string | null; notify_attempts: number;
}

export interface OpenLead {
  leadId: string; createdAt: string;
  crm: Outcome; crmAttempts: number; crmError?: string;
  notify: Outcome; notifyAttempts: number; notifyError?: string;
}

const summary = (r: Row): OpenLead => ({
  leadId: r.lead_id, createdAt: r.created_at,
  crm: r.crm, crmAttempts: r.crm_attempts, ...(r.crm_error ? { crmError: r.crm_error } : {}),
  notify: r.notify, notifyAttempts: r.notify_attempts, ...(r.notify_error ? { notifyError: r.notify_error } : {}),
});

/** Cursor = "<created_at>|<lead_id>" of the last row on the previous page (keyset paging). */
function decodeCursor(cursor?: string | null): [string, string] {
  const [a = '', b = ''] = (cursor ?? '').split('|');
  return [a, b];
}

/**
 * Leads with work outstanding. `crm` / `notify` limit it to the channels that
 * are configured: a lead waiting for a CRM that isn't connected yet is listed
 * (for visibility) but only retried once `crm` is true.
 */
async function openRows(db: LeadDB, opts: { limit: number; cursor?: string | null; crm: boolean; notify: boolean }): Promise<Row[]> {
  await ensureSchema(db);
  const [c, id] = decodeCursor(opts.cursor);
  const crmStates = opts.crm ? "('pending','failed','skipped')" : "('pending','failed')";
  const notifyStates = opts.notify ? "('pending','failed','skipped')" : "('pending','failed')";
  const sql = `SELECT * FROM leads
    WHERE (crm IN ${crmStates} OR notify IN ${notifyStates})
      AND (created_at > ? OR (created_at = ? AND lead_id > ?))
    ORDER BY created_at, lead_id LIMIT ?`;
  return (await db.prepare(sql).bind(c, c, id, opts.limit).all<Row>()).results;
}

export interface OpenPage { leads: OpenLead[]; nextCursor: string | null; counts: Record<string, number> }

/** Admin view: open leads (no personal data) and per-state counts. */
export async function listOpen(db: LeadDB, opts: { limit?: number; cursor?: string | null } = {}): Promise<OpenPage> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = await openRows(db, { limit, cursor: opts.cursor, crm: true, notify: false });
  const counts: Record<string, number> = {};
  for (const r of (await db.prepare("SELECT 'crm:' || crm AS k, COUNT(*) AS n FROM leads GROUP BY crm UNION ALL SELECT 'notify:' || notify, COUNT(*) FROM leads GROUP BY notify").bind().all<{ k: string; n: number }>()).results) counts[r.k] = r.n;
  const last = rows.at(-1);
  return { leads: rows.map(summary), nextCursor: rows.length === limit && last ? `${last.created_at}|${last.lead_id}` : null, counts };
}

/**
 * Optimistic claim: bump the attempt counter only if nobody else has since.
 * Two concurrent retry runs (cron and an admin call) can't both send the same
 * delivery; the loser skips it. No lock state is left behind if a run dies.
 */
async function claim(db: LeadDB, leadId: string, column: 'crm_attempts' | 'notify_attempts', seen: number): Promise<boolean> {
  const r = await db.prepare(`UPDATE leads SET ${column} = ${column} + 1 WHERE lead_id = ? AND ${column} = ?`).bind(leadId, seen).run();
  return r.meta.changes === 1;
}

/** Admin: put abandoned deliveries back in the queue with a fresh attempt budget (e.g. after a long CRM outage). */
export async function reopenAbandoned(db: LeadDB): Promise<number> {
  await ensureSchema(db);
  const a = await db.prepare("UPDATE leads SET crm = 'failed', crm_attempts = 0 WHERE crm = 'abandoned'").bind().run();
  const b = await db.prepare("UPDATE leads SET notify = 'failed', notify_attempts = 0 WHERE notify = 'abandoned'").bind().run();
  return a.meta.changes + b.meta.changes;
}

export interface RetryResult { processed: number; crmDelivered: number; notifyDelivered: number; abandoned: number; nextCursor: string | null }

/**
 * One bounded batch of retries. Call again with `nextCursor` to continue;
 * null means the scan reached the end.
 */
export async function retryOpen<R extends LeadRecord>(
  deps: Pick<DeliveryDeps<R>, 'db' | 'sendToCrm' | 'notifyOwner' | 'log'>,
  opts: { limit?: number; cursor?: string | null } = {},
): Promise<RetryResult> {
  const out: RetryResult = { processed: 0, crmDelivered: 0, notifyDelivered: 0, abandoned: 0, nextCursor: null };
  const { db, log } = deps;
  if (!db || (!deps.sendToCrm && !deps.notifyOwner)) return out;
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const rows = await openRows(db, { limit, cursor: opts.cursor, crm: !!deps.sendToCrm, notify: !!deps.notifyOwner });

  for (const row of rows) {
    out.processed++;
    const { inquiry, lead } = JSON.parse(row.data) as { inquiry: R['inquiry']; lead: R['lead'] };
    const record = { leadId: row.lead_id, channel: row.channel, createdAt: row.created_at, inquiry, lead } as R;

    if (deps.sendToCrm && ['pending', 'failed', 'skipped'].includes(row.crm)) {
      if (row.crm_attempts >= MAX_ATTEMPTS) {
        await db.prepare("UPDATE leads SET crm = 'abandoned' WHERE lead_id = ?").bind(row.lead_id).run();
        log('lead_crm_abandoned', { leadId: row.lead_id, attempts: row.crm_attempts, crmError: row.crm_error });
        out.abandoned++;
      } else if (await claim(db, row.lead_id, 'crm_attempts', row.crm_attempts)) {
        const progress = JSON.parse(row.crm_progress || '{}') as CrmProgress;
        const r = await attempt(() => deps.sendToCrm!(record, progress));
        await db.prepare('UPDATE leads SET crm = ?, crm_error = ?, crm_progress = ? WHERE lead_id = ?')
          .bind(r.outcome, r.error ?? null, JSON.stringify(progress), row.lead_id).run();
        if (r.outcome === 'delivered') out.crmDelivered++;
        log(r.outcome === 'delivered' ? 'lead_retry_delivered' : 'lead_retry_failed', { leadId: row.lead_id, channel: 'crm', attempts: row.crm_attempts + 1, error: r.error });
      }
    }

    if (deps.notifyOwner && ['pending', 'failed', 'skipped'].includes(row.notify)) {
      if (row.notify_attempts >= MAX_ATTEMPTS) {
        await db.prepare("UPDATE leads SET notify = 'abandoned' WHERE lead_id = ?").bind(row.lead_id).run();
        log('lead_notify_abandoned', { leadId: row.lead_id, attempts: row.notify_attempts, notifyError: row.notify_error });
        out.abandoned++;
      } else if (await claim(db, row.lead_id, 'notify_attempts', row.notify_attempts)) {
        const r = await attempt(() => deps.notifyOwner!(record));
        await db.prepare('UPDATE leads SET notify = ?, notify_error = ? WHERE lead_id = ?')
          .bind(r.outcome, r.error ?? null, row.lead_id).run();
        if (r.outcome === 'delivered') out.notifyDelivered++;
        log(r.outcome === 'delivered' ? 'lead_retry_delivered' : 'lead_retry_failed', { leadId: row.lead_id, channel: 'notify', attempts: row.notify_attempts + 1, error: r.error });
      }
    }
  }
  const last = rows.at(-1);
  out.nextCursor = rows.length === limit && last ? `${last.created_at}|${last.lead_id}` : null;
  return out;
}
