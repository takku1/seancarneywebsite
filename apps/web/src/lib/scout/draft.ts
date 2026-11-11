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
 * Each draft carries an idempotency key that identifies one SUBMISSION, not
 * one event: a keyed hash of every business detail of the inquiry plus the
 * UTC day the draft was prepared.
 * - Retries, double-clicks and repeated sends of the same draft: same key,
 *   one lead (the key is fixed inside the signed draft).
 * - The same details prepared again the same day: same key, one lead.
 * - Anything changed (budget, guests, format, message...) or a later day:
 *   a new key, so a planner's follow-up reaches Sean as a new lead rather
 *   than being swallowed as a duplicate of the original.
 * The chat panel also offers Send only on the latest prepared draft, so a
 * model re-preparing with reworded details can't produce two sendable cards.
 *
 * Drafts are bearer tokens for 30 minutes: never log them or send them to
 * analytics (they are only held in the visitor's own tab).
 */
const enc = new TextEncoder();
export const DRAFT_TTL_MS = 30 * 60_000;

async function hmacHex(secret: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const b64url = (s: string) => btoa(String.fromCharCode(...enc.encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

/** The minimum a draft needs; every other business field also counts toward its key. */
export interface DraftIdentity {
  email: string;
  event_type: string;
  event_date?: string;
  location: string;
}

/**
 * The details that make up an inquiry's content. Attribution, experiments and
 * the page are context, not content, so they don't change the key.
 */
const CONTENT_FIELDS = ['name', 'email', 'phone', 'company', 'role', 'event_type', 'event_date', 'date_flexible', 'location', 'guests', 'format', 'moments', 'budget', 'message'] as const;
const DAY_MS = 86_400_000;

function normalize(v: unknown): unknown {
  if (typeof v === 'string') return v.trim().toLowerCase().replace(/\s+/g, ' ');
  if (Array.isArray(v)) return [...v].map(normalize).sort();
  return v ?? null;
}

/** Idempotency key for one submission: every business detail plus the UTC day it was prepared (see header). */
export async function inquiryKey(i: DraftIdentity, secret: string, preparedAt: number): Promise<string> {
  const content = CONTENT_FIELDS.map((f) => [f, normalize((i as unknown as Record<string, unknown>)[f])]);
  const day = Math.floor(preparedAt / DAY_MS);
  return `scout-${(await hmacHex(secret, `inquiry-key|${day}|${JSON.stringify(content)}`)).slice(0, 32)}`;
}

export async function signDraft<I extends DraftIdentity>(inquiry: I, secret: string, now = Date.now()): Promise<string> {
  const body = b64url(JSON.stringify({ v: 1, inquiry, key: await inquiryKey(inquiry, secret, now), exp: now + DRAFT_TTL_MS }));
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
