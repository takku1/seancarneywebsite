/**
 * Meta Conversions API (server-side events), deduplicated with the browser
 * pixel through a shared event_id generated in the browser.
 *
 * Sends only when ALL of these hold, mirroring when the pixel itself may load:
 *  - PUBLIC_META_PIXEL_ID and META_CAPI_ACCESS_TOKEN are configured;
 *  - the visitor granted consent and has not opted out (client sends ads_ok);
 *  - the request carries no Global Privacy Control signal (Sec-GPC: 1).
 * Email/phone are normalized and SHA-256 hashed (Meta's requirement); no raw
 * personal data leaves the Worker. Never throws; times out after 2.5s.
 */
import { PUBLIC_META_PIXEL_ID } from 'astro:env/client';
import { META_CAPI_ACCESS_TOKEN } from 'astro:env/server';

/** Graph API version. Meta supports each version for about two years; bump when Events Manager warns. */
const GRAPH_VERSION = 'v24.0';

async function sha256(v: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const cookie = (header: string | null, name: string) => header?.split(/;\s*/).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);

export interface MetaEvent {
  name: 'Lead' | 'CompleteRegistration';
  eventId?: string;
  adsOk?: boolean;
  email?: string;
  phone?: string;
  /** Page the action happened on (path or absolute URL). */
  page?: string;
  fbclid?: string;
  customData?: Record<string, string | number | boolean | undefined>;
}

export async function sendMetaEvent(request: Request, e: MetaEvent): Promise<'sent' | 'skipped' | 'error'> {
  if (!PUBLIC_META_PIXEL_ID || !META_CAPI_ACCESS_TOKEN || !e.adsOk || request.headers.get('sec-gpc') === '1') return 'skipped';
  try {
    const now = Math.floor(Date.now() / 1000);
    const cookies = request.headers.get('cookie');
    const fbp = cookie(cookies, '_fbp');
    const fbc = cookie(cookies, '_fbc') ?? (e.fbclid ? `fb.1.${now * 1000}.${e.fbclid}` : undefined);
    const phone = e.phone?.replace(/\D/g, '');
    const user_data: Record<string, unknown> = {
      client_ip_address: request.headers.get('cf-connecting-ip') ?? undefined,
      client_user_agent: request.headers.get('user-agent') ?? undefined,
      ...(e.email ? { em: [await sha256(e.email.trim().toLowerCase())] } : {}),
      ...(phone ? { ph: [await sha256(phone)] } : {}),
      ...(fbp ? { fbp } : {}),
      ...(fbc ? { fbc } : {}),
    };
    const origin = new URL(request.url).origin;
    const body = {
      data: [
        {
          event_name: e.name,
          event_time: now,
          ...(e.eventId ? { event_id: e.eventId } : {}),
          action_source: 'website',
          event_source_url: e.page ? new URL(e.page, origin).href : request.headers.get('referer') ?? origin,
          user_data,
          ...(e.customData ? { custom_data: Object.fromEntries(Object.entries(e.customData).filter(([, v]) => v !== undefined)) } : {}),
        },
      ],
    };
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(PUBLIC_META_PIXEL_ID)}/events?access_token=${encodeURIComponent(META_CAPI_ACCESS_TOKEN)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2500),
    });
    return res.ok ? 'sent' : 'error';
  } catch {
    return 'error';
  }
}
