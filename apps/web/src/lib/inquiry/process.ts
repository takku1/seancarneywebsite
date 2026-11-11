/**
 * The one lead pipeline. Used by the inquiry form (/api/inquire) and by Scout,
 * so every lead gets the same scoring, CRM write, attribution and emails.
 *
 * score -> durable acceptance (lib/inquiry/deliver.ts): lead database (D1) +
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
import { upsertContact, createOpportunity, addNote, GHL_TIMEOUT_MS } from '../integrations/ghl';
import { scoreLead, EVENT_TYPES, BUDGETS, ROLES, FORMATS, type Inquiry } from './schema';
import { acceptLead, listOpen, retryOpen, reopenAbandoned, purgeExpired, LeaseLost, type Lease, type CrmProgress, type DeliveryDeps, type LeadDB, type LeadRecord } from './deliver';
import { errorCode } from '../security/errors';

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
    signal: AbortSignal.timeout(GHL_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`resend_${res.status}`);
}

type Lead = ReturnType<typeof scoreLead>;
export type InquiryRecord = LeadRecord<Inquiry, Lead>;

/** The LEADS_DB binding (D1, wrangler.jsonc); null in plain `astro dev` or if unbound. */
async function leadDB(): Promise<LeadDB | null> {
  try {
    const mod = (await import('cloudflare:workers')) as { env?: Record<string, unknown> };
    return (mod.env?.LEADS_DB as LeadDB | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * CRM delivery: GoHighLevel/SHA-BAM API v2, then the webhook. Throws unless one
 * of them took the lead. API steps record their result in `progress`, so a
 * retry after a partial success resumes at the next step. Before each remote write
 * (webhook included) `lease.guard()` requires an unexpired lease and renews it;
 * after each API step `lease.save()` checkpoints it. Either throws LeaseLost,
 * which stops this runner there.
 */
function crmSink(): ((r: InquiryRecord, progress: CrmProgress, lease: Lease) => Promise<void>) | null {
  const api = GHL_PRIVATE_TOKEN && GHL_LOCATION_ID;
  if (!api && !GHL_WEBHOOK_URL) return null;
  return async ({ inquiry: i, lead, leadId, channel }, progress, lease) => {
    const payload = crmPayload(i, lead, leadId, channel);
    let apiError = '';
    if (api) {
      try {
        const cfg = { token: GHL_PRIVATE_TOKEN!, locationId: GHL_LOCATION_ID! };
        if (!progress.contactId) {
          // An upsert keyed on email: repeating it after a crash is harmless.
          await lease.guard();
          progress.contactId = await upsertContact(cfg, {
            firstName: payload.firstName,
            lastName: payload.lastName,
            email: i.email,
            phone: i.phone || undefined,
            companyName: i.company || undefined,
            source: payload.source,
            tags: payload.tags,
          });
          await lease.save(progress);
        }
        if (GHL_PIPELINE_ID && GHL_STAGE_NEW_ID && !progress.opportunityId) {
          await lease.guard();
          progress.opportunityId = (await createOpportunity(cfg, {
            contactId: progress.contactId,
            pipelineId: GHL_PIPELINE_ID,
            stageId: GHL_STAGE_NEW_ID,
            name: `${payload.event_type} | ${payload.event_date || 'TBD'} | ${i.location} | Tier ${lead.tier}`,
            monetaryValue: BUDGET_VALUE[i.budget],
            source: payload.source,
          })) ?? 'created';
          await lease.save(progress);
        }
        if (!progress.noted) {
          await lease.guard();
          await addNote(cfg, progress.contactId, Object.entries(payload).filter(([k]) => !['firstName', 'lastName', 'name', 'tags'].includes(k)).map(([k, v]) => `${k}: ${v}`).join('\n'));
          progress.noted = true;
          await lease.save(progress);
        }
        return;
      } catch (err) {
        if (err instanceof LeaseLost) throw err;
        apiError = errorCode(err);
        if (!GHL_WEBHOOK_URL) throw new Error(apiError);
        // A partial API write plus a full webhook would duplicate the contact's data: only fall back if the API wrote nothing.
        if (progress.contactId) throw new Error(`${apiError}+partial`);
      }
    }
    await lease.guard();
    const res = await fetch(GHL_WEBHOOK_URL!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(GHL_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`${apiError ? apiError + '+' : ''}webhook_${res.status}`);
  };
}

const emailReady = () => !!(RESEND_API_KEY && INQUIRY_FROM_EMAIL);

function deps(db: LeadDB | null): DeliveryDeps<InquiryRecord> {
  return {
    db,
    sendToCrm: crmSink(),
    notifyOwner: emailReady() && INQUIRY_NOTIFY_EMAIL
      ? ({ inquiry: i, lead, leadId, channel }) =>
          sendEmail(INQUIRY_NOTIFY_EMAIL!, `[Tier ${lead.tier}]${channel === 'scout' ? ' [Scout]' : ''} ${labelOf(EVENT_TYPES, i.event_type)}, ${i.event_date || 'date TBD'}, ${i.location}`, notifyHtml(i, lead, leadId, channel), i.email)
      : null,
    confirmVisitor: emailReady() ? ({ inquiry: i }) => sendEmail(i.email, 'Your inquiry for Sean Carney', confirmHtml(i)) : null,
    allowDryRun: import.meta.env.DEV,
    log: (event, fields) => {
      const line = JSON.stringify({ ts: new Date().toISOString(), kind: 'lead', event, ...fields });
      // Error level = alert-worthy: a lead not delivered, given up on, crashed, or about to be deleted unresolved.
      if (/(undeliverable|failed|abandoned|crashed|unresolved|expired)$/.test(event)) console.error(line);
      else console.info(line);
    },
  };
}

/**
 * Accepts one lead. `accepted: false` means nothing durable took it: the caller
 * must tell the visitor so (they are shown the direct email address instead).
 * `accepted: true` means safely recorded, not necessarily delivered yet.
 * With `defer` (Cloudflare's waitUntil), delivery runs after the response once
 * the lead is stored, so a slow CRM never delays the visitor.
 */
export async function processInquiry(
  i: Inquiry,
  channel: 'form' | 'scout',
  opts: { defer?: (work: Promise<unknown>) => void; idempotencyKey?: string } = {},
): Promise<{ accepted: boolean; leadId: string; tier: 'A' | 'B' | 'C'; duplicate?: boolean }> {
  const lead = scoreLead(i);
  const record: InquiryRecord = {
    leadId: `SC-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`,
    channel,
    createdAt: new Date().toISOString(),
    inquiry: i,
    lead,
  };
  const db = await leadDB();
  const d = deps(db);
  const result = await acceptLead(record, { ...d, defer: opts.defer }, opts.idempotencyKey ?? i.event_id);
  // Retention also runs on every cron; here it keeps the 90-day promise even if the cron is not registered.
  if (db && opts.defer) opts.defer(purgeExpired(db, d.log).catch((e) => d.log('lead_purge_failed', { error: errorCode(e) })));
  return { accepted: result.accepted, leadId: result.leadId, tier: lead.tier, duplicate: result.duplicate };
}

/** Admin: open leads (CRM not yet taken, or Sean not yet notified), no personal data. null = no database bound. */
export async function openLeads(opts: { limit?: number; cursor?: string | null }) {
  const db = await leadDB();
  return db ? listOpen(db, opts) : null;
}

/** One bounded retry batch: cron every 15 minutes, or POST /api/leads (e.g. once SHA-BAM is connected). */
export async function retryOpenLeads(opts: { limit?: number; reopen?: boolean } = {}) {
  const db = await leadDB();
  const reopened = db && opts.reopen ? await reopenAbandoned(db) : 0;
  return { reopened, ...(await retryOpen(deps(db), opts)) };
}

/** Cron: apply the retention policy (resolved leads at 90 days, unresolved at 180). */
export async function purgeLeads() {
  const db = await leadDB();
  return db ? purgeExpired(db, deps(db).log) : null;
}
