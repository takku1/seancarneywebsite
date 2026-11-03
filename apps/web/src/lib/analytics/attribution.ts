/**
 * First-touch / last-touch attribution, stored client-side and sent with every
 * inquiry so the CRM knows which channel produced which booking.
 *
 * Captures: utm_*, click IDs (gclid, gbraid, wbraid, fbclid, ttclid, msclkid,
 * li_fat_id), external referrer, landing page, session page count.
 */
const FIRST = 'sc_attr_first';
const LAST = 'sc_attr_last';
const SESSION = 'sc_attr_session';

const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;
const CLICK_IDS = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'ttclid', 'msclkid', 'li_fat_id'] as const;

export interface Touch {
  ts: string;
  landing: string;
  referrer?: string;
  channel: string;
  [k: string]: string | undefined;
}

interface SessionState {
  pages: number;
  landing: string;
  started: string;
}

function read<T>(store: Storage, key: string): T | null {
  try {
    const v = store.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

function write(store: Storage, key: string, value: unknown): void {
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or blocked storage: attribution degrades gracefully */
  }
}

/** Rough channel grouping that mirrors GA4 default channel logic closely enough for a CRM. */
function channelFor(params: URLSearchParams, referrer: string): string {
  const medium = (params.get('utm_medium') || '').toLowerCase();
  const source = (params.get('utm_source') || '').toLowerCase();
  if (params.get('gclid') || params.get('gbraid') || params.get('wbraid') || /cpc|ppc|paid/.test(medium)) return 'paid_search';
  if (params.get('fbclid') || params.get('ttclid') || /paid_social|social_paid/.test(medium)) return 'paid_social';
  if (/email|newsletter/.test(medium)) return 'email';
  if (/theknot|weddingwire|gigsalad|thebash|zola/.test(source + referrer)) return 'directory';
  if (/instagram|facebook|tiktok|youtube|linkedin|t\.co|twitter|threads/.test(source + referrer)) return 'organic_social';
  if (/chatgpt|openai|perplexity|claude|gemini|copilot/.test(source + referrer)) return 'ai_assistant';
  if (/google\.|bing\.|duckduckgo|yahoo\.|ecosia/.test(referrer)) return 'organic_search';
  if (medium === 'referral' || referrer) return 'referral';
  if (source) return 'other_campaign';
  return 'direct';
}

export function captureAttribution(): void {
  const params = new URLSearchParams(location.search);
  const ref = document.referrer && !document.referrer.includes(location.hostname) ? document.referrer : '';
  const hasCampaign = UTM.some((k) => params.get(k)) || CLICK_IDS.some((k) => params.get(k));

  const touch: Touch = {
    ts: new Date().toISOString(),
    landing: location.pathname + location.search,
    referrer: ref ? new URL(ref).hostname : undefined,
    channel: channelFor(params, ref),
  };
  for (const k of [...UTM, ...CLICK_IDS]) {
    const v = params.get(k);
    if (v) touch[k] = v.slice(0, 200);
  }

  if (!read<Touch>(localStorage, FIRST)) write(localStorage, FIRST, touch);
  if (hasCampaign || ref) write(localStorage, LAST, touch);

  const s = read<SessionState>(sessionStorage, SESSION);
  write(sessionStorage, SESSION, s ? { ...s, pages: s.pages + 1 } : { pages: 1, landing: touch.landing, started: touch.ts });
}

/** Flat key/value map, ready for a CRM custom-field webhook. */
export function getAttribution(): Record<string, string> {
  const first = read<Touch>(localStorage, FIRST);
  const last = read<Touch>(localStorage, LAST) || first;
  const session = read<SessionState>(sessionStorage, SESSION);
  const out: Record<string, string> = {};
  const add = (prefix: string, t: Touch | null) => {
    if (!t) return;
    for (const [k, v] of Object.entries(t)) if (v) out[`${prefix}_${k}`] = String(v);
  };
  add('first', first);
  add('last', last);
  if (session) {
    out.session_pages = String(session.pages);
    out.session_landing = session.landing;
    out.session_seconds = String(Math.round((Date.now() - Date.parse(session.started)) / 1000));
  }
  return out;
}
