/**
 * Structured security event log (ASVS 16.2 / 16.3 / 16.4, OWASP A09).
 * One JSON line per event to Workers Logs: UTC timestamp, event, route and
 * a pseudonymous client key (salted daily hash of the IP, never the raw IP).
 * JSON encoding prevents log injection; values are truncated.
 */
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

export async function clientKey(ip: string | null | undefined): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  const data = new TextEncoder().encode(`${ip ?? 'unknown'}|${day}|sc`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function logSecurity(event: SecurityEvent, fields: Record<string, unknown> = {}): void {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) clean[k] = typeof v === 'string' ? v.slice(0, 300) : v;
  console.warn(JSON.stringify({ ts: new Date().toISOString(), kind: 'security', event, ...clean }));
}
