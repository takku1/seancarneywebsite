/**
 * Scout inquiry drafts: the model prepares, the visitor sends (OWASP LLM06
 * excessive agency).
 *
 * `submit_inquiry` never creates a lead. It returns a signed draft that the
 * chat panel shows with a Send button; only that click (POST
 * /api/scout/inquire) submits. The signature (HMAC with SCOUT_SIGNING_KEY)
 * proves the draft came from this server unchanged, and it expires after 30
 * minutes.
 *
 * Each draft carries a stable idempotency key derived from the inquiry itself
 * (keyed hash of email, event type, date and location), not a per-call UUID:
 * repeated clicks, network retries, and the model preparing the same inquiry
 * twice all map to one lead.
 */
const enc = new TextEncoder();
export const DRAFT_TTL_MS = 30 * 60_000;

async function hmacHex(secret: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const b64url = (s: string) => btoa(String.fromCharCode(...enc.encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

/** The fields that make two inquiries "the same inquiry". */
export interface DraftIdentity {
  email: string;
  event_type: string;
  event_date?: string;
  location: string;
}

/** Stable, server-controlled idempotency key for one inquiry. */
export async function inquiryKey(i: DraftIdentity, secret: string): Promise<string> {
  const norm = [i.email.trim().toLowerCase(), i.event_type, (i.event_date ?? '').trim(), i.location.trim().toLowerCase().replace(/\s+/g, ' ')].join('|');
  return `scout-${(await hmacHex(secret, `inquiry-key|${norm}`)).slice(0, 32)}`;
}

export async function signDraft<I extends DraftIdentity>(inquiry: I, secret: string, now = Date.now()): Promise<string> {
  const body = b64url(JSON.stringify({ v: 1, inquiry, key: await inquiryKey(inquiry, secret), exp: now + DRAFT_TTL_MS }));
  return `${body}.${await hmacHex(secret, `draft|${body}`)}`;
}

export type DraftResult<I> = { ok: true; inquiry: I; key: string } | { ok: false; error: 'malformed' | 'bad_signature' | 'expired' };

export async function verifyDraft<I>(token: unknown, secret: string, now = Date.now()): Promise<DraftResult<I>> {
  if (typeof token !== 'string' || token.length > 20_000) return { ok: false, error: 'malformed' };
  const dot = token.lastIndexOf('.');
  if (dot < 1) return { ok: false, error: 'malformed' };
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmacHex(secret, `draft|${body}`);
  // Constant-time comparison.
  let diff = sig.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ (sig.charCodeAt(i) || 0);
  if (diff !== 0) return { ok: false, error: 'bad_signature' };
  let parsed: { v?: number; inquiry?: I; key?: string; exp?: number };
  try {
    parsed = JSON.parse(unb64url(body));
  } catch {
    return { ok: false, error: 'malformed' };
  }
  if (parsed.v !== 1 || !parsed.inquiry || typeof parsed.key !== 'string' || typeof parsed.exp !== 'number') return { ok: false, error: 'malformed' };
  if (now > parsed.exp) return { ok: false, error: 'expired' };
  return { ok: true, inquiry: parsed.inquiry, key: parsed.key };
}
