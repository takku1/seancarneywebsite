/**
 * POST /api/notify  { topic: 'shows' | 'merch' | 'news', email, city?, website?, started_at? }
 * "Tell me when" list for tour dates, merch and new music (news = the main fan list). Goes to GoHighLevel as a fan
 * contact (tags fan, notify:<topic>, city:<slug>), separate from booking leads.
 * Also counts cities anonymously, so Sean sees where demand for shows is.
 */
import type { APIRoute } from 'astro';
import { GHL_PRIVATE_TOKEN, GHL_LOCATION_ID, GHL_WEBHOOK_URL } from 'astro:env/server';
import { z } from 'astro/zod';
import { upsertContact } from '../../lib/integrations/ghl';
import { recordNotify } from '../../lib/scout/signals';
import { logSecurity } from '../../lib/security/log';
import { sendMetaEvent } from '../../lib/integrations/meta-capi';

export const prerender = false;

const schema = z.object({
  topic: z.enum(['shows', 'merch', 'news']),
  email: z.string().trim().pipe(z.email().max(200)),
  city: z.string().trim().max(80).optional().or(z.literal('')),
  website: z.string().max(500).optional(), // honeypot
  started_at: z.number().optional(),
  page: z.string().max(200).optional(),
  attribution: z.record(z.string(), z.string()).default({}),
  event_id: z.uuid().optional(), // Meta CAPI dedupe with the pixel
  ads_ok: z.boolean().optional(), // browser consent + opt-out state
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export const POST: APIRoute = async ({ request }) => {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json(400, { ok: false, error: 'invalid_json' });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return json(422, { ok: false, error: 'validation' });
  const n = parsed.data;
  if (n.website || (n.started_at && Date.now() - n.started_at < 2500)) {
    logSecurity('honeypot', { route: '/api/notify' });
    return json(200, { ok: true }); // bots get a silent success
  }

  const city = n.city ? n.city.replace(/\s+/g, ' ') : '';
  const tags = ['fan', `notify:${n.topic}`, ...(city ? [`city:${slug(city)}`] : [])];
  const source = `website:notify:${n.attribution.last_channel || n.attribution.first_channel || 'direct'}`;
  let crm = 'skipped';
  try {
    if (GHL_PRIVATE_TOKEN && GHL_LOCATION_ID) {
      await upsertContact({ token: GHL_PRIVATE_TOKEN, locationId: GHL_LOCATION_ID }, { firstName: '', lastName: '', email: n.email, source, tags });
      crm = 'api';
    } else if (GHL_WEBHOOK_URL) {
      await fetch(GHL_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: n.email, tags, source, notify_topic: n.topic, notify_city: city, page: n.page ?? '', ...n.attribution }) });
      crm = 'webhook';
    } else {
      console.info('[notify] CRM not configured:', n.topic, city || '(no city)');
    }
  } catch (err) {
    crm = `error:${(err as Error).message}`;
  }
  void recordNotify(n.topic, city).catch(() => undefined);
  await sendMetaEvent(request, { name: 'CompleteRegistration', eventId: n.event_id, adsOk: n.ads_ok, email: n.email, page: n.page, fbclid: n.attribution.last_fbclid ?? n.attribution.first_fbclid, customData: { content_name: `notify_${n.topic}` } });
  console.info('[notify]', n.topic, crm);
  return json(200, { ok: true });
};
