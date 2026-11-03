/**
 * One tracking call, every destination.
 *
 * track('inquiry_submit', { event_type: 'wedding' }) fans out to:
 *  - window.dataLayer   (GTM-compatible, always on, also our debug log)
 *  - Plausible          (cookieless source of truth)
 *  - GA4 gtag           (only if configured)
 *  - Microsoft Clarity  (custom event + session tags for replay filtering)
 *  - Meta Pixel         (only if configured AND not opted out / GPC)
 *
 * Every event automatically carries active experiment variants and the
 * visitor's loyalty (visitor_type, visit_bucket) so any metric can be cut by
 * test arm or by new vs returning.
 */
import { getExperimentProps } from './experiments';
import { retentionProps } from './retention';

export type Props = Record<string, string | number | boolean | undefined>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    plausible?: ((event: string, opts?: { props?: Props; revenue?: unknown }) => void) & { q?: unknown[] };
    gtag?: (...args: unknown[]) => void;
    clarity?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
    __scDebug?: boolean;
  }
}

/** Events that map to a Meta standard event. */
const META_MAP: Record<string, string> = {
  inquiry_submit: 'Lead', // carries event_id, deduped with the server-side Conversions API
  inquiry_start: 'InitiateCheckout',
  // generate_lead (thanks page) is a GA4 recommended event only; mapping it to Lead too double-counted every inquiry in Meta.
  // Fan funnel: list signups and release-page views give ad delivery a real signal.
  notify_signup: 'CompleteRegistration',
  release_view: 'ViewContent',
};

function clean(props: Props): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(props)) if (v !== undefined && v !== '') out[k] = v;
  return out;
}

export function track(name: string, props: Props = {}): void {
  const payload = clean({ ...getExperimentProps(), ...retentionProps(), path: location.pathname, ...props });
  try {
    (window.dataLayer ||= []).push({ event: name, ...payload });
    window.plausible?.(name, { props: payload });
    window.gtag?.('event', name, payload);
    if (window.clarity) {
      window.clarity('event', name);
      for (const [k, v] of Object.entries(payload)) if (k.startsWith('exp_')) window.clarity('set', k, String(v));
    }
    const meta = META_MAP[name];
    // event_id dedupes the pixel event against the server-side Conversions API event.
    if (meta && window.fbq) window.fbq('track', meta, payload, payload.event_id ? { eventID: String(payload.event_id) } : undefined);
    if (window.__scDebug) console.info('%c[track]', 'color:#c9a074', name, payload);
    // In-page signal for UI that reacts to engagement (e.g. the fan-list prompt). Never leaves the page.
    window.dispatchEvent(new CustomEvent('sc:track', { detail: { name, props: payload } }));
  } catch {
    /* analytics must never break the page */
  }
}

/** True when ad measurement is allowed: consent granted, no opt-out, no GPC. Mirrors when the pixel may load. */
export function adsAllowed(): boolean {
  try {
    if ((navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return false;
    return localStorage.getItem('sc_consent') === 'granted' && localStorage.getItem('sc_ad_optout') !== '1';
  } catch {
    return false;
  }
}

/** Shared id for one conversion, sent to both the pixel and the Conversions API. */
export const newEventId = (): string => (crypto.randomUUID ? crypto.randomUUID() : '');

/** Unified identify-ish tagging for session replay filters. */
export function tagSession(key: string, value: string): void {
  try {
    window.clarity?.('set', key, value);
  } catch {
    /* noop */
  }
}
