/**
 * Browser storage for module code (GDPR Art. 17 eviction path). The only other
 * writers are the pre-paint inline scripts (consent, A/B assignment) and the
 * attribution module, which use the same `sc_` namespace. `clearSiteData()` removes every `sc_` key and is
 * wired to the "Clear data saved in this browser" control on /privacy.
 * Inventory: docs/security/SECURITY.md §4.
 */
export const PREFIX = 'sc_';

type Area = 'session' | 'local';
const area = (a: Area): Storage => (a === 'session' ? sessionStorage : localStorage);
const named = (key: string) => (key.startsWith(PREFIX) ? key : PREFIX + key);

export function getItem(key: string, where: Area = 'session'): string | null {
  try {
    return area(where).getItem(named(key));
  } catch {
    return null; // storage blocked (private mode, policy)
  }
}

export function setItem(key: string, value: string, where: Area = 'session'): void {
  try {
    area(where).setItem(named(key), value); // soc2-ignore: PRIV003 - namespaced sc_ key, evicted by clearSiteData()
  } catch {
    /* storage blocked or full */
  }
}

export function removeItem(key: string, where: Area = 'session'): void {
  try {
    area(where).removeItem(named(key));
  } catch {
    /* noop */
  }
}

/** Remove every sc_* key from session and local storage. Returns how many were removed. */
export function clearSiteData(): number {
  let n = 0;
  for (const where of ['session', 'local'] as const) {
    try {
      const s = area(where);
      for (const k of Object.keys(s)) if (k.startsWith(PREFIX)) { s.removeItem(k); n++; }
    } catch {
      /* noop */
    }
  }
  return n;
}
