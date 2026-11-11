/**
 * POST /api/inquire  (runs on the Cloudflare Worker)
 *
 * validate -> anti-spam (honeypot, min fill time, Turnstile) -> processInquiry
 * (score, durable acceptance, CRM, Resend). 200 only once the lead is held
 * durably, 503 otherwise. The shared pipeline lives in lib/inquiry/process.ts.
 */
import { z } from 'astro/zod';
import type { APIRoute } from 'astro';
import { TURNSTILE_SECRET_KEY } from 'astro:env/server';
import { inquirySchema } from '../../lib/inquiry/schema';
import { processInquiry } from '../../lib/inquiry/process';
import { logSecurity, clientKey } from '../../lib/security/log';
import { sendMetaEvent } from '../../lib/integrations/meta-capi';

export const prerender = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function verifyTurnstile(token: string | undefined, ip: string | null): Promise<boolean> {
  // Development may run without Turnstile (honeypot + timing still apply).
  // Production fails closed: a missing secret is a deployment error, logged loudly.
  if (!TURNSTILE_SECRET_KEY) {
    if (import.meta.env.DEV) return true;
    console.error(JSON.stringify({ ts: new Date().toISOString(), kind: 'config', event: 'turnstile_secret_missing', route: '/api/inquire' }));
    return false;
  }
  if (!token) return false;
  const body = new FormData();
  body.append('secret', TURNSTILE_SECRET_KEY);
  body.append('response', token);
  if (ip) body.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  const data = (await res.json()) as { success?: boolean };
  return !!data.success;
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json(400, { ok: false, error: 'invalid_json' });
  }

  const parsed = inquirySchema.safeParse(raw);
  if (!parsed.success) {
    logSecurity('validation_failed', { route: '/api/inquire', fields: Object.keys(z.flattenError(parsed.error).fieldErrors).join(',') });
    return json(422, { ok: false, error: 'validation', fields: z.flattenError(parsed.error).fieldErrors });
  }
  const i = parsed.data;

  // Bots fill hidden fields and submit instantly. Pretend success so they don't retry.
  const tooFast = i.started_at ? Date.now() - i.started_at < 4000 : false;
  if (i.website || tooFast) {
    logSecurity('honeypot', { route: '/api/inquire', reason: i.website ? 'field' : 'timing' });
    return json(200, { ok: true, leadId: 'filtered' });
  }

  const ip = request.headers.get('cf-connecting-ip') ?? (() => { try { return clientAddress; } catch { return null; } })();
  if (!(await verifyTurnstile(i.turnstile_token, ip))) {
    logSecurity('turnstile_failed', { route: '/api/inquire', who: await clientKey(ip) });
    return json(403, { ok: false, error: 'verification_failed' });
  }

  const { accepted, leadId, tier, duplicate } = await processInquiry(i, 'form');
  // Nothing durable took the lead: say so, so the visitor uses the direct email instead.
  if (!accepted) return json(503, { ok: false, error: 'delivery_failed' });
  if (duplicate) return json(200, { ok: true, leadId, tier });
  await sendMetaEvent(request, { name: 'Lead', eventId: i.event_id, adsOk: i.ads_ok, email: i.email, phone: i.phone || undefined, page: i.page, fbclid: i.attribution.last_fbclid ?? i.attribution.first_fbclid, customData: { event_type: i.event_type, lead_tier: tier } });
  return json(200, { ok: true, leadId, tier });
};

export const ALL: APIRoute = () => json(405, { ok: false, error: 'method_not_allowed' });
