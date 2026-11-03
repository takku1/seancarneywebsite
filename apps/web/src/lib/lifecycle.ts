/**
 * Page lifecycle for the client router (astro:transitions ClientRouter).
 *
 * With the router, a component's bundled <script> runs once per full load, but
 * pages are swapped in without reloading. Anything that binds to page DOM must
 * therefore run per page:
 *
 *   onPage(() => {
 *     const io = new IntersectionObserver(...);
 *     return () => io.disconnect();   // optional cleanup, runs before the next swap
 *   });
 *
 * - Runs as soon as the DOM is ready on a full load (not at window `load`,
 *   which is when Astro fires the first `astro:page-load`), then after every
 *   client navigation. A per-body guard makes the two paths run setup once.
 * - Works on pages without the router (bare pages like /links): it simply
 *   runs once.
 * - Element-level double binding is prevented with bindOnce().
 * - Page-specific scripts pass `when`: once loaded, a script's setup would
 *   otherwise run on every later page too. With `when`, setup runs only on
 *   pages containing that selector (e.g. onPage(setup, '[data-inquiry]')).
 */
type Cleanup = void | (() => void);

export function onPage(setup: () => Cleanup, when?: string): void {
  let lastBody: HTMLElement | null = null;
  let cleanup: Cleanup;
  const run = () => {
    if (!document.body || document.body === lastBody) return;
    lastBody = document.body;
    if (when && !document.querySelector(when)) return;
    try {
      cleanup = setup();
    } catch (err) {
      console.error('[onPage]', err);
    }
  };
  document.addEventListener('astro:before-swap', () => {
    if (typeof cleanup === 'function') {
      try {
        cleanup();
      } catch {
        /* never block navigation */
      }
    }
    cleanup = undefined;
  });
  document.addEventListener('astro:page-load', run);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
}

/** True the first time it is called for an element+key; marks the element so later calls are no-ops. */
export function bindOnce(el: HTMLElement, key = 'bound'): boolean {
  const attr = `scBound${key[0].toUpperCase()}${key.slice(1)}`;
  if (el.dataset[attr]) return false;
  el.dataset[attr] = '1';
  return true;
}

/** Fires before the router leaves the current page (not on full unloads; use pagehide for those). */
export function onLeavePage(fn: () => void): void {
  document.addEventListener('astro:before-preparation', fn);
}
