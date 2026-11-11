/**
 * Durable lead acceptance: the rule for when an inquiry counts as received.
 *
 * A visitor sees success only when the lead is held somewhere durable: the
 * lead store (KV), the CRM, or Sean's notification inbox. Then the confirmation
 * email goes out. Leads the CRM did not take (failed, or CRM not connected yet)
 * are indexed as `pending:` so an admin retry (POST /api/leads) delivers them later.
 *
 * No Astro or Cloudflare imports: every side effect is injected, so the
 * failure paths are unit-tested (evals/inquiry-delivery.test.mjs).
 */

export type Outcome = 'delivered' | 'failed' | 'skipped';

export interface LeadRecord<I = unknown, L = unknown> {
  leadId: string;
  channel: 'form' | 'scout';
  createdAt: string;
  inquiry: I;
  lead: L;
  delivery: { crm: Outcome; notify: Outcome; confirm: Outcome; crmError?: string };
  attempts: number;
}

export interface LeadStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(opts: { prefix: string; limit?: number }): Promise<{ keys: { name: string }[] }>;
}

type Sink<R> = ((record: R) => Promise<void>) | null;

export interface DeliveryDeps<R extends LeadRecord = LeadRecord> {
  /** Lead store (KV). null = not bound. */
  store: LeadStore | null;
  /** Throws when the CRM did not take the lead. null = CRM not configured. */
  sendToCrm: Sink<R>;
  /** Throws when the owner notification was not sent. null = not configured. */
  notifyOwner: Sink<R>;
  confirmVisitor: Sink<R>;
  /** Development with nothing configured: accept without delivering, so the form can be exercised. */
  allowDryRun: boolean;
  /** Operational log. Never pass personal data: lead IDs and outcomes only. */
  log: (event: string, fields: Record<string, unknown>) => void;
}

/** Lead records keep long enough for reconciliation; the CRM is the long-term record. */
export const LEAD_TTL = 60 * 60 * 24 * 90;
const IDEMPOTENCY_TTL = 60 * 60 * 24;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 160);

async function attempt<R>(sink: Sink<R>, record: R): Promise<{ outcome: Outcome; error?: string }> {
  if (!sink) return { outcome: 'skipped' };
  try {
    await sink(record);
    return { outcome: 'delivered' };
  } catch (e) {
    return { outcome: 'failed', error: errText(e) };
  }
}

async function save(store: LeadStore | null, record: LeadRecord): Promise<boolean> {
  if (!store) return false;
  try {
    await store.put(`lead:${record.leadId}`, JSON.stringify(record), { expirationTtl: LEAD_TTL });
    return true;
  } catch {
    return false;
  }
}

async function markPending(store: LeadStore | null, record: LeadRecord): Promise<void> {
  if (!store) return;
  try {
    // 'skipped' counts as pending too: leads taken before the CRM is connected
    // are backfilled by the first retry once it is.
    if (record.delivery.crm === 'delivered') await store.delete(`pending:${record.leadId}`);
    else await store.put(`pending:${record.leadId}`, record.createdAt, { expirationTtl: LEAD_TTL });
  } catch {
    /* the lead record itself is already stored */
  }
}

export interface AcceptResult {
  accepted: boolean;
  leadId: string;
  duplicate?: boolean;
  delivery?: LeadRecord['delivery'];
}

export async function acceptLead<R extends LeadRecord>(record: R, deps: DeliveryDeps<R>, idempotencyKey?: string): Promise<AcceptResult> {
  const { store, log } = deps;

  // A double-click or network retry with the same client event id returns the first result.
  if (idempotencyKey && store) {
    const prior = await store.get(`idem:${idempotencyKey}`).catch(() => null);
    if (prior) {
      log('lead_duplicate', { leadId: prior, channel: record.channel });
      return { accepted: true, leadId: prior, duplicate: true };
    }
  }

  const stored = await save(store, record);
  const crm = await attempt(deps.sendToCrm, record);
  const notify = await attempt(deps.notifyOwner, record);
  record.delivery = { crm: crm.outcome, notify: notify.outcome, confirm: 'skipped', ...(crm.error ? { crmError: crm.error } : {}) };
  record.attempts = 1;

  const nothingConfigured = !store && !deps.sendToCrm && !deps.notifyOwner;
  const durable = stored || crm.outcome === 'delivered' || notify.outcome === 'delivered';
  if (!durable && !(nothingConfigured && deps.allowDryRun)) {
    log('lead_undeliverable', { leadId: record.leadId, channel: record.channel, stored, crm: crm.outcome, crmError: crm.error, notify: notify.outcome, notifyError: notify.error });
    return { accepted: false, leadId: record.leadId, delivery: record.delivery };
  }

  record.delivery.confirm = (await attempt(deps.confirmVisitor, record)).outcome;
  if (stored) {
    await save(store, record);
    await markPending(store, record);
    if (idempotencyKey) await store!.put(`idem:${idempotencyKey}`, record.leadId, { expirationTtl: IDEMPOTENCY_TTL }).catch(() => undefined);
  }

  const fields = { leadId: record.leadId, channel: record.channel, stored, ...record.delivery, notifyError: notify.error };
  log(nothingConfigured ? 'lead_dry_run' : crm.outcome === 'failed' || notify.outcome === 'failed' ? 'lead_delivery_failed' : 'lead_accepted', fields);
  return { accepted: true, leadId: record.leadId, delivery: record.delivery };
}

export interface PendingSummary {
  leadId: string;
  createdAt: string;
  attempts: number;
  crm: Outcome;
  crmError?: string;
}

async function loadPending<R extends LeadRecord>(store: LeadStore, limit: number): Promise<R[]> {
  const { keys } = await store.list({ prefix: 'pending:', limit });
  const out: R[] = [];
  for (const { name } of keys) {
    const raw = await store.get(`lead:${name.slice('pending:'.length)}`);
    if (raw) out.push(JSON.parse(raw) as R);
    else await store.delete(name); // record expired: drop the index entry
  }
  return out;
}

/** Leads the CRM has not taken yet. No personal data: IDs, times and outcomes only. */
export async function listPending(store: LeadStore, limit = 100): Promise<PendingSummary[]> {
  return (await loadPending(store, limit)).map((r) => ({ leadId: r.leadId, createdAt: r.createdAt, attempts: r.attempts, crm: r.delivery.crm, crmError: r.delivery.crmError }));
}

/** Re-sends pending leads to the CRM; delivered ones leave the pending index. */
export async function retryPending<R extends LeadRecord>(deps: Pick<DeliveryDeps<R>, 'store' | 'sendToCrm' | 'log'>, limit = 50): Promise<{ retried: number; delivered: number; still: PendingSummary[] }> {
  if (!deps.store || !deps.sendToCrm) return { retried: 0, delivered: 0, still: deps.store ? await listPending(deps.store, limit) : [] };
  const records = await loadPending<R>(deps.store, limit);
  let delivered = 0;
  for (const record of records) {
    const crm = await attempt(deps.sendToCrm, record);
    record.attempts += 1;
    record.delivery = { ...record.delivery, crm: crm.outcome, ...(crm.error ? { crmError: crm.error } : { crmError: undefined }) };
    await save(deps.store, record);
    await markPending(deps.store, record);
    if (crm.outcome === 'delivered') delivered++;
    deps.log(crm.outcome === 'delivered' ? 'lead_retry_delivered' : 'lead_retry_failed', { leadId: record.leadId, attempts: record.attempts, crmError: crm.error });
  }
  return { retried: records.length, delivered, still: await listPending(deps.store, limit) };
}
