/**
 * Zero-config instrumentation. Mark up, don't wire up:
 *
 *   <a data-track="cta_click" data-track-location="hero" data-track-label="inquire">
 *   <section data-section="credits">
 *
 * Emits:
 *   cta_click / any data-track name   (delegated clicks, props from data-track-*)
 *   outbound_click                    (host + label)
 *   contact_click                     (mailto: / tel:)
 *   section_view                      (50% visible, once per page)
 *   scroll_depth                      (25/50/75/100 via sentinels, no scroll listeners)
 *   engaged_time                      (foreground seconds, sent on pagehide)
 *   web_vital                         (LCP, INP, CLS, FCP, TTFB with rating)
 */
import { track } from './track';
import { onPage, onLeavePage } from '../lifecycle';

function propsFrom(el: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(el.dataset)) {
    if (k.startsWith('track') && k !== 'track' && v) {
      const key = k.slice(5).replace(/^[A-Z]/, (c) => c.toLowerCase()).replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
      out[key] = v;
    }
  }
  return out;
}

function onClick(e: MouseEvent): void {
  const target = e.target as HTMLElement | null;
  const el = target?.closest<HTMLElement>('[data-track]');
  if (el?.dataset.track) track(el.dataset.track, propsFrom(el));

  const a = target?.closest<HTMLAnchorElement>('a[href]');
  if (!a) return;
  const href = a.getAttribute('href') || '';
  if (href.startsWith('mailto:') || href.startsWith('tel:')) {
    track('contact_click', { method: href.startsWith('tel:') ? 'phone' : 'email', location: a.dataset.trackLocation });
    return;
  }
  try {
    const url = new URL(a.href);
    if (url.host && url.host !== location.host) {
      track('outbound_click', { host: url.host, label: (a.textContent || '').trim().slice(0, 60) });
    }
  } catch {
    /* ignore malformed */
  }
}

function sectionViews(): () => void {
  const seen = new Set<string>();
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        const id = (en.target as HTMLElement).dataset.section!;
        if (en.isIntersecting && !seen.has(id)) {
          seen.add(id);
          track('section_view', { section: id });
          io.unobserve(en.target);
        }
      }
    },
    { threshold: 0.5 },
  );
  document.querySelectorAll<HTMLElement>('[data-section]').forEach((s) => io.observe(s));
  return () => io.disconnect();
}

function scrollDepth(): () => void {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:absolute;inset:0 auto auto 0;width:1px;height:100%;pointer-events:none;';
  document.body.style.position ||= 'relative';
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      track('scroll_depth', { percent: Number((en.target as HTMLElement).dataset.pct) });
      io.unobserve(en.target);
    }
  });
  for (const pct of [25, 50, 75, 100]) {
    const s = document.createElement('div');
    s.dataset.pct = String(pct);
    s.style.cssText = `position:absolute;left:0;top:calc(${pct}% - 2px);width:1px;height:1px;`;
    host.appendChild(s);
    io.observe(s);
  }
  document.body.appendChild(host);
  return () => io.disconnect();
}

/** Foreground seconds per page. Flushed on unload and when the client router leaves the page. */
function engagedTime(): { reset: () => void; flush: () => void } {
  let active = document.visibilityState === 'visible' ? performance.now() : 0;
  let total = 0;
  let sent = false;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (active) total += performance.now() - active;
      active = 0;
    } else active = performance.now();
  });
  const flush = () => {
    if (sent) return;
    sent = true;
    if (active) total += performance.now() - active;
    const seconds = Math.round(total / 1000);
    if (seconds >= 3) track('engaged_time', { seconds, bucket: seconds < 15 ? '<15s' : seconds < 60 ? '15-60s' : seconds < 180 ? '1-3m' : '3m+' });
  };
  const reset = () => {
    total = 0;
    sent = false;
    active = document.visibilityState === 'visible' ? performance.now() : 0;
  };
  addEventListener('pagehide', flush);
  return { reset, flush };
}

async function webVitals(): Promise<void> {
  const { onLCP, onINP, onCLS, onFCP, onTTFB } = await import('web-vitals');
  const send = (m: { name: string; value: number; rating: string }) =>
    track('web_vital', { metric: m.name, value: Math.round(m.name === 'CLS' ? m.value * 1000 : m.value), rating: m.rating });
  onLCP(send);
  onINP(send);
  onCLS(send);
  onFCP(send);
  onTTFB(send);
}

export function startAutotrack(): void {
  // Once per full load.
  document.addEventListener('click', onClick, { capture: true });
  const engaged = engagedTime();
  onLeavePage(engaged.flush);
  // Vitals are low priority: load the module when the browser is idle.
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback || ((cb: () => void) => setTimeout(cb, 1500));
  idle(() => void webVitals());

  // Per page (every page the client router swaps in).
  let first = true;
  onPage(() => {
    if (!first) {
      engaged.reset();
      // Plausible, GA4 (enhanced measurement) and Clarity count history navigations themselves; the Meta pixel does not.
      (window.dataLayer ||= []).push({ event: 'virtual_page_view', path: location.pathname });
      window.fbq?.('track', 'PageView');
    }
    first = false;
    const stopSections = sectionViews();
    const stopScroll = scrollDepth();
    return () => {
      stopSections();
      stopScroll();
    };
  });
}
