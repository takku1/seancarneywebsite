/**
 * The one lead pipeline. Used by the inquiry form (/api/inquire) and by Scout,
 * so every lead gets the same scoring, CRM write, attribution and emails.
 *
 * score -> durable acceptance (lib/inquiry/deliver.ts): lead store (KV) +
 * GoHighLevel/SHA-BAM (API v2, webhook fallback) + Resend notify, then confirm.
 */
import {
  GHL_WEBHOOK_URL,
  GHL_PRIVATE_TOKEN,
  GHL_LOCATION_ID,
  GHL_PIPELINE_ID,
  GHL_STAGE_NEW_ID,
  RESEND_API_KEY,
  INQUIRY_NOTIFY_EMAIL,
  INQUIRY_FROM_EMAIL,
} from 'astro:env/server';
import { upsertContact, createOpportunity, addNote } from '../integrations/ghl';
import { scoreLead, EVENT_TYPES, BUDGETS, ROLES, FORMATS, type Inquiry } from './schema';
import { acceptLead, listPending, retryPending, type DeliveryDeps, type LeadRecord, type LeadStore } from './deliver';

/** Pipeline value estimate per budget band (midpoints), for GHL forecasting. */
const BUDGET_VALUE: Record<string, number | undefined> = { under_5k: 3500, '5k_10k': 7500, '10k_20k': 15000, '20k_40k': 30000, '40k_plus': 45000, discuss: undefined };

/** Email header safety: collapse whitespace so visitor text can never add header lines. */
const headerSafe = (s: string) => s.replace(/[\r\n\t]+/g, ' ').slice(0, 180);

export const labelOf = (list: readonly { value: string; label: string }[], v?: string) => list.find((x) => x.value === v)?.label ?? v ?? '';
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function crmPayload(i: Inquiry, lead: ReturnType<typeof scoreLead>, leadId: string, channel: 'form' | 'scout') {
  const [firstName, ...rest] = i.name.split(/\s+/);
  return {
    firstName,
    lastName: rest.join(' '),
    name: i.name,
    email: i.email,
    phone: i.phone || undefined,
    companyName: i.company || undefined,
    source: `website:${i.attribution.last_channel || i.attribution.first_channel || 'direct'}`,
    tags: ['website-inquiry', `via:${channel}`, `event:${i.event_type}`, `tier:${lead.tier}`, `role:${i.role}`, ...(i.sms_consent ? ['sms-consent'] : [])],
    lead_id: leadId,
    inquiry_channel: channel,
    event_type: labelOf(EVENT_TYPES, i.event_type),
    event_date: i.event_date || (i.date_flexible ? 'Flexible' : ''),
    event_location: i.location,
    guest_count: i.guests ?? '',
    format: labelOf(FORMATS, i.format),
    moments: i.moments.join(', '),
    budget: labelOf(BUDGETS, i.budget),
    role: labelOf(ROLES, i.role),
    message: i.message ?? '',
    sms_consent: i.sms_consent,
    lead_score: lead.score,
    lead_tier: lead.tier,
    lead_signals: lead.signals.join(', '),
    page: i.page ?? '',
    ...i.experiments,
    ...i.attribution,
  };
}

function notifyHtml(i: Inquiry, lead: ReturnType<typeof scoreLead>, leadId: string, channel: string): string {
  const row = (k: string, v: string | undefined) => (v ? `<tr><td style="padding:4px 12px 4px 0;color:#777">${k}</td><td style="padding:4px 0">${escapeHtml(v)}</td></tr>` : '');
  return `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#111">
<p style="font-size:18px"><strong>Tier ${lead.tier}</strong> inquiry (score ${lead.score}) from ${escapeHtml(i.name)}${channel === 'scout' ? ' <span style="color:#777">via Scout</span>' : ''}</p>
<table>${row('Event', labelOf(EVENT_TYPES, i.event_type))}${row('Date', i.event_date || (i.date_flexible ? 'Flexible' : 'Not set'))}${row('Location', i.location)}${row('Guests', i.guests)}${row('Format', labelOf(FORMATS, i.format))}${row('Moments', i.moments.join(', '))}${row('Budget', labelOf(BUDGETS, i.budget))}${row('Role', labelOf(ROLES, i.role))}${row('Company', i.company)}${row('Email', i.email)}${row('Phone', i.phone)}${row('Message', i.message)}${row('Channel', i.attribution.last_channel || i.attribution.first_channel)}${row('Landing page', i.attribution.first_landing)}${row('Signals', lead.signals.join(', '))}</table>
<p style="color:#777;font-size:13px">Lead ${leadId}. Reply directly to this email to respond.</p></div>`;
}

function confirmHtml(i: Inquiry): string {
  return `<div style="font-family:Georgia,serif;font-size:16px;color:#111;line-height:1.6;max-width:560px">
<p>Dear ${escapeHtml(i.name.split(/\s+/)[0])},</p>
<p>Thank you for reaching out about your ${escapeHtml(labelOf(EVENT_TYPES, i.event_type).toLowerCase())}. Your note has been received and you will hear back personally within one business day with availability and next steps.</p>
<p>Warmly,<br/>Sean Carney</p></div>`;
}

/** Sends one email through Resend; throws unless Resend accepted it. */
async function sendEmail(to: string, subject: string, html: string, replyTo?: string): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: INQUIRY_FROM_EMAIL, to: [to], subject: headerSafe(subject), html, ...(replyTo ? { reply_to: headerSafe(replyTo) } : {}) }),
  });
  if (!res.ok) throw new Error(`resend_${res.status}`);
}

type Lead = ReturnType<typeof scoreLead>;
export type InquiryRecord = LeadRecord<Inquiry, Lead>;

/** The LEADS_KV binding (wrangler.jsonc); null in plain `astro dev` or if unbound. */
async function leadStore(): Promise<LeadStore | null> {
  try {
    const mod = (await import('cloudflare:workers')) as { env?: Record<string, unknown> };
    return (mod.env?.LEADS_KV as LeadStore | undefined) ?? null;
  } catch {
    return null;
  }
}

/** CRM delivery: GoHighLevel/SHA-BAM API v2, then the webhook. Throws unless one of them took the lead. */
function crmSink(): ((r: InquiryRecord) => Promise<void>) | null {
  const api = GHL_PRIVATE_TOKEN && GHL_LOCATION_ID;
  if (!api && !GHL_WEBHOOK_URL) return null;
  return async ({ inquiry: i, lead, leadId, channel }) => {
    const payload = crmPayload(i, lead, leadId, channel);
    let apiError = '';
    if (api) {
      try {
        const cfg = { token: GHL_PRIVATE_TOKEN!, locationId: GHL_LOCATION_ID! };
        const contactId = await upsertContact(cfg, {
          firstName: payload.firstName,
          lastName: payload.lastName,
          email: i.email,
          phone: i.phone || undefined,
          companyName: i.company || undefined,
          source: payload.source,
          tags: payload.tags,
        });
        if (GHL_PIPELINE_ID && GHL_STAGE_NEW_ID) {
          await createOpportunity(cfg, {
            contactId,
            pipelineId: GHL_PIPELINE_ID,
            stageId: GHL_STAGE_NEW_ID,
            name: `${payload.event_type} | ${payload.event_date || 'TBD'} | ${i.location} | Tier ${lead.tier}`,
            monetaryValue: BUDGET_VALUE[i.budget],
            source: payload.source,
          });
        }
        await addNote(cfg, contactId, Object.entries(payload).filter(([k]) => !['firstName', 'lastName', 'name', 'tags'].includes(k)).map(([k, v]) => `${k}: ${v}`).join('\n'));
        return;
      } catch (err) {
        apiError = `api: ${(err as Error).message}`;
        if (!GHL_WEBHOOK_URL) throw new Error(apiError);
      }
    }
    const res = await fetch(GHL_WEBHOOK_URL!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(`${apiError ? apiError + '; ' : ''}webhook_${res.status}`);
  };
}

const emailReady = () => !!(RESEND_API_KEY && INQUIRY_FROM_EMAIL);

function deps(store: LeadStore | null): DeliveryDeps<InquiryRecord> {
  return {
    store,
    sendToCrm: crmSink(),
    notifyOwner: emailReady() && INQUIRY_NOTIFY_EMAIL
      ? ({ inquiry: i, lead, leadId, channel }) =>
          sendEmail(INQUIRY_NOTIFY_EMAIL!, `[Tier ${lead.tier}]${channel === 'scout' ? ' [Scout]' : ''} ${labelOf(EVENT_TYPES, i.event_type)}, ${i.event_date || 'date TBD'}, ${i.location}`, notifyHtml(i, lead, leadId, channel), i.email)
      : null,
    confirmVisitor: emailReady() ? ({ inquiry: i }) => sendEmail(i.email, 'Your inquiry for Sean Carney', confirmHtml(i)) : null,
    allowDryRun: import.meta.env.DEV,
    log: (event, fields) => {
      const line = JSON.stringify({ ts: new Date().toISOString(), kind: 'lead', event, ...fields });
      if (event === 'lead_undeliverable' || event === 'lead_delivery_failed' || event === 'lead_retry_failed') console.error(line);
      else console.info(line);
    },
  };
}

/**
 * Accepts one lead. `accepted: false` means nothing durable took it: the caller
 * must tell the visitor so (they are shown the direct email address instead).
 */
export async function processInquiry(i: Inquiry, channel: 'form' | 'scout'): Promise<{ accepted: boolean; leadId: string; tier: 'A' | 'B' | 'C'; duplicate?: boolean }> {
  const lead = scoreLead(i);
  const record: InquiryRecord = {
    leadId: `SC-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`,
    channel,
    createdAt: new Date().toISOString(),
    inquiry: i,
    lead,
    delivery: { crm: 'skipped', notify: 'skipped', confirm: 'skipped' },
    attempts: 0,
  };
  const result = await acceptLead(record, deps(await leadStore()), i.event_id);
  return { accepted: result.accepted, leadId: result.leadId, tier: lead.tier, duplicate: result.duplicate };
}

/** Admin: leads the CRM has not taken yet (no personal data). */
export async function pendingLeads() {
  const store = await leadStore();
  return store ? listPending(store) : null;
}

/** Admin: re-send pending leads to the CRM (e.g. once SHA-BAM is connected). */
export async function retryPendingLeads() {
  const d = deps(await leadStore());
  return retryPending(d);
}
