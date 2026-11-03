/**
 * California (CCPA/CPRA) handling.
 * - Plausible (cookieless) loads for everyone; GA4, Clarity and Meta only after consent.
 * - Advertising signals (Meta, GA4 ad storage) stay off when the browser sends
 *   Global Privacy Control or the visitor opts out on /privacy.
 */
import { getItem, setItem, removeItem } from '../storage';

const OPT_OUT = 'sc_ad_optout';

export function adTrackingAllowed(): boolean {
  try {
    if ((navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return false;
    return getItem(OPT_OUT, 'local') !== '1';
  } catch {
    return false;
  }
}

export function setAdOptOut(optOut: boolean): void {
  if (optOut) setItem(OPT_OUT, '1', 'local');
  else removeItem(OPT_OUT, 'local');
}
