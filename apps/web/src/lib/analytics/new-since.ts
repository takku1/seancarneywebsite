/**
 * "New since your last visit": a reason for returning visitors to keep going.
 *
 * Mark up any item with its publish date:
 *   <li data-published="2026-11-01T00:00:00Z"> ... <span data-new-slot></span> ... </li>
 * On a returning visit, items published after the previous visit get a "New"
 * badge (in the slot if present, otherwise appended). First visits show nothing,
 * since everything is new. Local only: dates never leave the browser.
 * Emits new_since_seen { count } once per page when there is something new.
 */
import { previousVisit } from './retention';
import { track } from './track';

export function markNewSinceLastVisit(): void {
  const prev = previousVisit();
  if (!prev) return;
  let count = 0;
  for (const el of document.querySelectorAll<HTMLElement>('[data-published]')) {
    const t = Date.parse(el.dataset.published!);
    if (!Number.isFinite(t) || t <= prev.getTime() || t > Date.now()) continue;
    if (el.querySelector('.new-badge')) continue;
    const badge = document.createElement('span');
    badge.className = 'new-badge';
    badge.textContent = 'New';
    (el.querySelector('[data-new-slot]') ?? el).append(badge);
    el.classList.add('is-new');
    count++;
  }
  if (count) track('new_since_seen', { count });
}
