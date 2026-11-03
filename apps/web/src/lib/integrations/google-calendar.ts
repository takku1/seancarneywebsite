/**
 * Google Calendar free/busy from a Cloudflare Worker, no SDK.
 *
 * Setup (see docs/current/04-integrations-and-workflows.md):
 *  1. Google Cloud project, enable "Google Calendar API".
 *  2. Create a service account and a JSON key. Put client_email and private_key in env.
 *  3. In Google Calendar, share each calendar with the service account email using
 *     "See only free/busy (hide details)". The site can never read event titles.
 *
 * google-auth-library does not run on Workers, so the RS256 JWT is signed with Web Crypto.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/calendar.freebusy';

let cached: { token: string; exp: number } | null = null;

const b64url = (data: ArrayBuffer | string) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function importKey(pem: string): Promise<CryptoKey> {
  // Env vars often carry literal "\n"; normalize before decoding.
  const body = pem.replace(/\\n/g, '\n').replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

export async function getAccessToken(clientEmail: string, privateKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.token;
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: clientEmail, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const key = await importKey(privateKey);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`));
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${b64url(sig)}` }),
  });
  if (!res.ok) throw new Error(`google_token_${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: data.access_token, exp: now + data.expires_in };
  return data.access_token;
}

export interface DayStatus {
  date: string;
  status: 'open' | 'busy';
  /** Busy minutes on that day across all calendars (no event details). */
  busyMinutes: number;
}

/**
 * Busy if any event overlaps the event-hours window of that local day.
 * timeZone defaults to Los Angeles; windowStart/End are local hours.
 */
export async function checkDay(opts: {
  date: string; // YYYY-MM-DD
  calendarIds: string[];
  clientEmail: string;
  privateKey: string;
  timeZone?: string;
  windowStart?: number;
  windowEnd?: number;
  busyThresholdMinutes?: number;
}): Promise<DayStatus> {
  const { date, calendarIds, timeZone = 'America/Los_Angeles', windowStart = 10, windowEnd = 24, busyThresholdMinutes = 60 } = opts;
  const token = await getAccessToken(opts.clientEmail, opts.privateKey);
  // Generous UTC window around the local day; Google returns busy blocks we then clip.
  const dayStart = new Date(`${date}T00:00:00Z`);
  const timeMin = new Date(dayStart.getTime() - 14 * 3600_000).toISOString();
  const timeMax = new Date(dayStart.getTime() + 38 * 3600_000).toISOString();
  const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ timeMin, timeMax, timeZone, items: calendarIds.map((id) => ({ id })) }),
  });
  if (!res.ok) throw new Error(`google_freebusy_${res.status}`);
  const data = (await res.json()) as { calendars: Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }> };

  // Local window -> UTC using the zone's offset on that date.
  const offsetMin = tzOffsetMinutes(timeZone, dayStart);
  const winStart = dayStart.getTime() + (windowStart * 60 - offsetMin) * 60_000;
  const winEnd = dayStart.getTime() + (windowEnd * 60 - offsetMin) * 60_000;

  let busy = 0;
  for (const cal of Object.values(data.calendars)) {
    for (const b of cal.busy ?? []) {
      const s = Math.max(Date.parse(b.start), winStart);
      const e = Math.min(Date.parse(b.end), winEnd);
      if (e > s) busy += (e - s) / 60_000;
    }
  }
  return { date, status: busy >= busyThresholdMinutes ? 'busy' : 'open', busyMinutes: Math.round(busy) };
}

/** Minutes the zone is ahead of UTC on a given instant (negative for the Americas). */
function tzOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asUtc - at.getTime()) / 60_000);
}
