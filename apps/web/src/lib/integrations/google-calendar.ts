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
    signal: AbortSignal.timeout(8_000),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${b64url(sig)}` }),
  });
  if (!res.ok) throw new Error(`google_token_${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: data.access_token, exp: now + data.expires_in };
  return data.access_token;
}

/**
 * Day states, from the visitor's point of view (all indicative; Sean confirms personally):
 * - open: nothing in the performance window.
 * - tentative: something is on a personal calendar that day. It needs Sean's
 *   confirmation, not a "no" (only when a holds calendar is configured).
 * - busy: a confirmed hold on the holds calendar, or, with no holds calendar,
 *   at least busyThresholdMinutes of combined busy time in the window.
 * - unknown: any calendar could not be read. Never guessed as open.
 */
export type DayState = 'open' | 'tentative' | 'busy' | 'unknown';

export interface DayStatus {
  date: string;
  status: DayState;
  /** Busy minutes in the window, overlaps across calendars counted once (no event details). */
  busyMinutes: number;
}

export interface FreeBusyResponse {
  calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }>;
}

/** Minutes the zone is ahead of UTC at an instant (negative for the Americas). */
export function tzOffsetMinutes(timeZone: string, at: number): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(at));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(at / 1000) * 1000) / 60_000);
}

/**
 * The UTC instant of a local wall-clock time: `minutes` after local midnight
 * of `date` (1440 = the next local midnight). DST-aware: the offset is taken
 * at the instant itself, not at midnight, so a window crossing a transition
 * is still exact. A wall time skipped by a spring-forward gap resolves to the
 * instant just after the gap.
 */
export function localToUtc(date: string, minutes: number, timeZone: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, minutes);
  let t = naive - tzOffsetMinutes(timeZone, naive) * 60_000;
  t = naive - tzOffsetMinutes(timeZone, t) * 60_000;
  return t;
}

/** Today's date (YYYY-MM-DD) in a time zone. */
export function todayIn(timeZone: string, now = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}

/** Total minutes covered by intervals clipped to [from, to), overlaps counted once. */
function coveredMinutes(blocks: [number, number][], from: number, to: number): number {
  const clipped = blocks.map(([s, e]) => [Math.max(s, from), Math.min(e, to)] as [number, number]).filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const b of clipped) {
    if (cur && b[0] <= cur[1]) cur[1] = Math.max(cur[1], b[1]);
    else {
      if (cur) total += cur[1] - cur[0];
      cur = [...b];
    }
  }
  if (cur) total += cur[1] - cur[0];
  return total / 60_000;
}

/**
 * Pure classification of a free/busy response (exported for tests).
 * Every requested calendar must be present without errors, or the day is unknown.
 */
export function classifyDay(data: FreeBusyResponse, opts: {
  date: string;
  timeZone: string;
  calendarIds: string[];
  holdCalendarIds?: string[];
  windowStart?: number;
  windowEnd?: number;
  busyThresholdMinutes?: number;
}): DayStatus {
  const { date, timeZone, calendarIds, holdCalendarIds = [], windowStart = 10, windowEnd = 24, busyThresholdMinutes = 60 } = opts;
  const from = localToUtc(date, windowStart * 60, timeZone);
  const to = localToUtc(date, windowEnd * 60, timeZone);
  const blocksOf = (id: string): [number, number][] | null => {
    const cal = data.calendars?.[id];
    if (!cal || (cal.errors && cal.errors.length)) return null;
    const out: [number, number][] = [];
    for (const b of cal.busy ?? []) {
      const s = Date.parse(b.start), e = Date.parse(b.end);
      if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
      out.push([s, e]);
    }
    return out;
  };
  const holds: [number, number][] = [];
  const other: [number, number][] = [];
  for (const id of holdCalendarIds) {
    const b = blocksOf(id);
    if (!b) return { date, status: 'unknown', busyMinutes: 0 };
    holds.push(...b);
  }
  for (const id of calendarIds) {
    const b = blocksOf(id);
    if (!b) return { date, status: 'unknown', busyMinutes: 0 };
    other.push(...b);
  }
  const busyMinutes = Math.round(coveredMinutes([...holds, ...other], from, to));
  if (coveredMinutes(holds, from, to) > 0) return { date, status: 'busy', busyMinutes };
  if (coveredMinutes(other, from, to) >= busyThresholdMinutes) return { date, status: holdCalendarIds.length ? 'tentative' : 'busy', busyMinutes };
  return { date, status: 'open', busyMinutes };
}

/**
 * Free/busy for the performance window (local hours windowStart to windowEnd)
 * of one local day. holdCalendarIds: confirmed bookings and blocked dates,
 * where any overlap means busy. calendarIds: other calendars (personal),
 * where combined busy time of at least the threshold means tentative, or busy
 * when no holds calendar is configured.
 */
export async function checkDay(opts: {
  date: string; // YYYY-MM-DD
  calendarIds: string[];
  holdCalendarIds?: string[];
  clientEmail: string;
  privateKey: string;
  timeZone?: string;
  windowStart?: number;
  windowEnd?: number;
  busyThresholdMinutes?: number;
}): Promise<DayStatus> {
  const timeZone = opts.timeZone ?? 'America/Los_Angeles';
  const token = await getAccessToken(opts.clientEmail, opts.privateKey);
  const ids = [...new Set([...(opts.holdCalendarIds ?? []), ...opts.calendarIds])];
  const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ timeMin: new Date(localToUtc(opts.date, 0, timeZone)).toISOString(), timeMax: new Date(localToUtc(opts.date, 1440, timeZone)).toISOString(), timeZone, items: ids.map((id) => ({ id })) }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`google_freebusy_${res.status}`);
  return classifyDay((await res.json()) as FreeBusyResponse, { ...opts, timeZone, calendarIds: opts.calendarIds.filter((id) => !(opts.holdCalendarIds ?? []).includes(id)) });
}
