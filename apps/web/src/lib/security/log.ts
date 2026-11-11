/**
 * Structured security event log (ASVS 16.2 / 16.3 / 16.4, OWASP A09).
 * One JSON line per event to Workers Logs: UTC timestamp, event, route and
 * a pseudonymous client key (keyed daily HMAC of the IP, never the raw IP).
 * JSON encoding prevents log injection; values are truncated.
 */
import { LOG_HASH_KEY } from 'astro:env/server';

export type SecurityEvent =
  | 'rate_limited'
  | 'body_too_large'
  | 'origin_rejected'
  | 'method_rejected'
  | 'content_type_rejected'
  | 'bad_signature'
  | 'turnstile_failed'
  | 'honeypot'
  | 'auth_failed'
  | 'validation_failed'
  | 'csp_violation'
  | 'unhandled_error';

let hmacKey: Promise<CryptoKey> | undefined;

/**
 * HMAC key for client pseudonyms. LOG_HASH_KEY keeps pseudonyms stable across
 * Worker instances for the day; without it, a random per-instance key is used
 * (still unlinkable to the IP, only less correlatable across instances).
 */
function key(): Promise<CryptoKey> {
  hmacKey ??= (async () => {
    const secret = LOG_HASH_KEY ? new TextEncoder().encode(LOG_HASH_KEY) : crypto.getRandomValues(new Uint8Array(32));
    return crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  })();
  return hmacKey;
}

/** Pseudonymous client key: HMAC-SHA-256(secret, ip|day), truncated. Never the raw IP. */
export async function clientKey(ip: string | null | undefined): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  const mac = await crypto.subtle.sign('HMAC', await key(), new TextEncoder().encode(`${ip ?? 'unknown'}|${day}`));
  return [...new Uint8Array(mac)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function logSecurity(event: SecurityEvent, fields: Record<string, unknown> = {}): void {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) clean[k] = typeof v === 'string' ? v.slice(0, 300) : v;
  console.warn(JSON.stringify({ ts: new Date().toISOString(), kind: 'security', event, ...clean }));
}
