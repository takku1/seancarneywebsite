/**
 * GoHighLevel (LeadConnector) API v2 via a Private Integration token.
 * Base https://services.leadconnectorhq.com, header Version: 2021-07-28.
 * Scopes needed: contacts.write, opportunities.write (plus .readonly).
 *
 * Endpoint shapes follow the public v2 docs (marketplace.gohighlevel.com/docs).
 * VERIFY against a real sub-account before launch; GHL changes field names.
 * The inbound-webhook path in /api/inquire remains as a fallback.
 */
const BASE = 'https://services.leadconnectorhq.com';

interface Cfg {
  token: string;
  locationId: string;
}

/** Per-call ceiling. Must stay well inside the delivery lease (lib/inquiry/deliver.ts LEASE_MS). */
export const GHL_TIMEOUT_MS = 20_000;

async function call<T>(cfg: Cfg, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${cfg.token}`, version: '2021-07-28', 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(GHL_TIMEOUT_MS),
  });
  // Status only: error bodies can echo the contact's details, and this message is logged.
  if (!res.ok) throw new Error(`ghl_${path}_${res.status}`);
  return (await res.json()) as T;
}

export async function upsertContact(
  cfg: Cfg,
  c: { firstName: string; lastName: string; email: string; phone?: string; companyName?: string; source: string; tags: string[] },
): Promise<string> {
  const out = await call<{ contact?: { id: string }; id?: string }>(cfg, '/contacts/upsert', { locationId: cfg.locationId, ...c });
  const id = out.contact?.id ?? out.id;
  if (!id) throw new Error('ghl_no_contact_id');
  return id;
}

export async function createOpportunity(
  cfg: Cfg,
  o: { contactId: string; pipelineId: string; stageId: string; name: string; monetaryValue?: number; source?: string },
): Promise<string | undefined> {
  const out = await call<{ opportunity?: { id: string } }>(cfg, '/opportunities/', {
    locationId: cfg.locationId,
    pipelineId: o.pipelineId,
    pipelineStageId: o.stageId,
    contactId: o.contactId,
    name: o.name,
    status: 'open',
    source: o.source,
    ...(o.monetaryValue ? { monetaryValue: o.monetaryValue } : {}),
  });
  return out.opportunity?.id;
}

export async function addNote(cfg: Cfg, contactId: string, body: string): Promise<void> {
  await call(cfg, `/contacts/${contactId}/notes`, { body });
}
