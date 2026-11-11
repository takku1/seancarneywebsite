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
 * Either way a present Origin must match the request host exactly; `null`,
 * malformed and cross-origin values are rejected.
 */
export type OriginPolicy = 'required' | 'if-present';
export type OriginVerdict = 'ok' | 'missing' | 'mismatch';

export function checkOrigin(origin: string | null, host: string, policy: OriginPolicy): OriginVerdict {
  if (origin === null || origin === '') return policy === 'required' ? 'missing' : 'ok';
  let originHost = '';
  try {
    originHost = new URL(origin).host; // "null" and garbage throw, leaving ''
  } catch {
    /* rejected below */
  }
  return originHost && originHost === host ? 'ok' : 'mismatch';
}
