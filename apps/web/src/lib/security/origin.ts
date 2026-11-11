/**
 * Origin policy for state-changing API requests (CSRF defense, ASVS 3.5).
 *
 * Browsers send `Origin` on every cross-origin request and on same-origin
 * POSTs, so a browser-only route can require it:
 * - `required`: the inquiry form and Scout. A missing Origin means a
 *   non-browser client; those routes have no non-browser use.
 * - `if-present`: analytics beacons and CSP reports (some user agents send
 *   them without Origin; losing them is harmless) and admin routes, which are
 *   called by scripts and protected by a bearer token instead.
 * Either way a present Origin must equal the request's own origin: scheme,
 * host and port (so http:// does not pass for https://). `null`, malformed
 * and cross-origin values are rejected.
 */
export type OriginPolicy = 'required' | 'if-present';
export type OriginVerdict = 'ok' | 'missing' | 'mismatch';

/** `expected` is the request URL's origin, e.g. `new URL(request.url).origin`. */
export function checkOrigin(origin: string | null, expected: string, policy: OriginPolicy): OriginVerdict {
  if (origin === null || origin === '') return policy === 'required' ? 'missing' : 'ok';
  let normalized = '';
  try {
    normalized = new URL(origin).origin; // "null" and garbage throw; opaque origins serialize as "null"
  } catch {
    /* rejected below */
  }
  return normalized !== '' && normalized !== 'null' && normalized === expected ? 'ok' : 'mismatch';
}
