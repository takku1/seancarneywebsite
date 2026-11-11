/**
 * The site's video player: one YouTube session at a time, inline in its tile,
 * docked to a persistent mini-player when the visitor scrolls away or browses
 * to another page (the dock lives in a transition:persist container, so with
 * the client router playback never stops).
 *
 * - Chrome 133+: the iframe is moved with moveBefore(), keeping playback state
 *   (scroll-docking and navigation are seamless).
 * - Other browsers: moving an iframe reloads it, so we only dock on navigation
 *   and resume from the last known timestamp.
 *
 * Emits video_play, video_progress (25/50/75/90), video_complete, video_watch
 * (seconds actually watched, when the session ends), up_next_*, player_dock,
 * player_undock, player_close. Dispatches sc:video-state in-page so other UI
 * (the fan prompt) never interrupts a playing video.
 */
import { track } from '../analytics/track';
import { navigate } from 'astro:transitions/client';
import { command, embedUrl, watchPlayer } from './yt-player';

const MILESTONES = [25, 50, 75, 90];
const UP_NEXT_SECONDS = 8;
type MoveCapable = Element & { moveBefore?: (node: Node, child: Node | null) => void };
export const canMove = typeof (Element.prototype as MoveCapable).moveBefore === 'function';

interface Session {
  id: string;
  title: string;
  location: string;
  sourcePath: string;
  tile: HTMLElement | null;
  /** The tile's thumbnail + play button, restored when the video leaves the tile. */
  original: Node[];
  iframe: HTMLIFrameElement | HTMLMediaElement;
  stop: () => void;
  t: number;
  playing: boolean;
  ended: boolean;
  docked: boolean;
  seconds: number;
  max: number;
  hit: Set<number>;
  io?: IntersectionObserver;
}

let cur: Session | null = null;
let wantBack = false; // "Back to video" pressed on another page: re-attach after navigating
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function move(parent: Element, node: Element): void {
  const resume = node instanceof HTMLMediaElement && !node.paused;
  const p = parent as MoveCapable;
  if (canMove && node.isConnected) p.moveBefore!(node, null);
  else parent.append(node);
  if (resume && node instanceof HTMLMediaElement && node.paused) void node.play().catch(() => {});
}

const dock = () => {
  const el = document.querySelector<HTMLElement>('[data-dock]');
  return el && {
    el,
    slot: el.querySelector<HTMLElement>('[data-dock-slot]')!,
    title: el.querySelector<HTMLElement>('[data-dock-title]')!,
    back: el.querySelector<HTMLButtonElement>('[data-dock-back]')!,
  };
};

const signal = (s: Session) => {
  const playing = s.playing && !s.ended;
  for (const tile of document.querySelectorAll<HTMLElement>('[data-media-id]')) {
    const active = tile.dataset.mediaId === s.id && playing;
    tile.classList.toggle('is-current', active);
    tile.querySelector('[data-audio-play]')?.setAttribute('aria-pressed', String(active));
  }
  dispatchEvent(new CustomEvent('sc:video-state', { detail: { id: s.id, playing } }));
};

function flush(s: Session): void {
  if (s.seconds >= 3) track('video_watch', { video_id: s.id, title: s.title, location: s.location, seconds: Math.round(s.seconds), max_percent: s.max, completed: s.ended });
  s.seconds = 0;
}
addEventListener('pagehide', () => cur && flush(cur));

/** Put the tile's thumbnail back (the video is elsewhere or finished). */
function restoreTile(s: Session, state?: 'docked'): void {
  const tile = s.tile;
  if (!tile?.isConnected) return;
  for (const n of [...tile.childNodes]) if (n !== s.iframe) n.remove();
  tile.prepend(...s.original);
  tile.classList.remove('is-playing');
  tile.classList.toggle('is-docked', state === 'docked');
}

function showDock(s: Session): void {
  const d = dock();
  if (!d) return;
  d.title.textContent = s.title;
  d.back.hidden = !s.tile?.isConnected && s.sourcePath === location.pathname;
  d.el.hidden = false;
  d.el.classList.toggle('audio-only', s.iframe instanceof HTMLAudioElement);
  requestAnimationFrame(() => d.el.classList.add('in'));
}

function hideDock(): void {
  const d = dock();
  if (!d) return;
  d.el.classList.remove('in');
  d.el.hidden = true;
}

function dockSession(s: Session, reason: 'scroll' | 'navigate'): void {
  const d = dock();
  if (!d || s.docked || s.ended) return;
  const reload = !canMove && s.iframe instanceof HTMLIFrameElement;
  move(d.slot, s.iframe);
  if (reload) s.iframe.src = embedUrl(s.id, s.t); // re-attached iframes reload: resume where it was
  s.docked = true;
  restoreTile(s, 'docked');
  showDock(s);
  track('player_dock', { video_id: s.id, reason, seamless: !reload });
}

function undock(s: Session): void {
  if (s.iframe instanceof HTMLAudioElement) return; // recordings stay in the listening dock
  if (!s.docked || !s.tile?.isConnected) return;
  for (const n of [...s.tile.childNodes]) n.remove();
  move(s.tile, s.iframe);
  if (!canMove && s.iframe instanceof HTMLIFrameElement) s.iframe.src = embedUrl(s.id, s.t);
  s.tile.classList.add('is-playing');
  s.tile.classList.remove('is-docked');
  s.docked = false;
  hideDock();
  track('player_undock', { video_id: s.id });
}

/** End the session: stop playback, restore the tile, close the dock. */
export function close(reason = 'close'): void {
  const s = cur;
  if (!s) return;
  cur = null;
  flush(s);
  s.stop();
  if (s.iframe instanceof HTMLMediaElement) { s.iframe.pause(); s.iframe.removeAttribute('src'); s.iframe.load(); }
  s.io?.disconnect();
  s.iframe.remove();
  s.playing = false;
  signal(s);
  restoreTile(s);
  hideDock();
  if (reason === 'close') track('player_close', { video_id: s.id });
}

export function pause(): void {
  if (cur?.iframe instanceof HTMLMediaElement) cur.iframe.pause();
  else if (cur) command(cur.iframe, 'pauseVideo');
}

function observeTile(s: Session): void {
  s.io?.disconnect();
  if (!s.tile || s.iframe instanceof HTMLAudioElement || (!canMove && s.iframe instanceof HTMLIFrameElement)) return;
  s.io = new IntersectionObserver(
    ([en]) => {
      if (cur !== s) return;
      if (!en.isIntersecting && s.playing && !s.docked) dockSession(s, 'scroll');
      else if (en.intersectionRatio > 0.6 && s.docked) undock(s);
    },
    { threshold: [0, 0.6] },
  );
  s.io.observe(s.tile);
}

function nextTile(tile: HTMLElement | null): HTMLElement | undefined {
  const scope = tile?.closest<HTMLElement>('[data-rail], section');
  if (!tile || !scope) return;
  const all = [...scope.querySelectorAll<HTMLElement>('[data-yt]')];
  return all.slice(all.indexOf(tile) + 1)[0];
}

function inView(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < innerHeight && document.visibilityState === 'visible';
}

/** "Up next" over the finished tile: countdown when on screen, otherwise a click. */
function offerNext(s: Session): void {
  const tile = s.tile;
  const next = nextTile(tile);
  if (!tile?.isConnected || !next || tile.querySelector('.yt-next')) return;
  const title = next.dataset.title || 'Next video';
  const box = document.createElement('div');
  box.className = 'yt-next';
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'Up next');
  const p = document.createElement('p');
  p.className = 'yt-next-title';
  const lab = document.createElement('span');
  lab.textContent = 'Up next';
  p.append(lab, document.createTextNode(title));
  const acts = document.createElement('div');
  acts.className = 'yt-next-acts';
  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'yt-next-play';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'yt-next-cancel';
  cancel.textContent = 'Cancel';
  const live = document.createElement('span');
  live.className = 'visually-hidden';
  live.setAttribute('aria-live', 'polite');
  acts.append(play, cancel);
  box.append(p, acts, live);
  tile.append(box);

  const auto = inView(tile);
  let left = UP_NEXT_SECONDS;
  const label = () => (play.textContent = auto && left > 0 ? `Play now · ${left}` : 'Play now');
  label();
  live.textContent = auto ? `Up next: ${title}. Playing in ${UP_NEXT_SECONDS} seconds.` : `Up next: ${title}.`;
  track('up_next_shown', { from: s.id, to: next.dataset.yt, auto });

  let timer = 0;
  const go = (how: 'auto' | 'click') => {
    window.clearInterval(timer);
    box.remove();
    track('up_next_play', { from: s.id, to: next.dataset.yt, how });
    next.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'nearest', inline: 'center' });
    play_(next);
  };
  if (auto) {
    timer = window.setInterval(() => {
      left--;
      label();
      if (left <= 0) go('auto');
    }, 1000);
  }
  play.addEventListener('click', () => go('click'));
  cancel.addEventListener('click', () => {
    window.clearInterval(timer);
    box.remove();
    track('up_next_cancel', { from: s.id });
  });
}

function onEnded(s: Session): void {
  track('video_complete', { video_id: s.id, title: s.title, location: s.location, seconds: Math.round(s.seconds) });
  flush(s);
  if (s.docked) {
    // Finished in the mini-player: carry on with the next video if its tile is on this page.
    const next = nextTile(s.tile);
    if (next) {
      track('up_next_play', { from: s.id, to: next.dataset.yt, how: 'dock' });
      play_(next, true);
    } else window.setTimeout(() => cur === s && close('ended'), 4000);
  } else {
    offerNext(s);
  }
}

/** Start a video from its tile (or straight into the dock when continuing a docked session). */
function play_(tile: HTMLElement, intoDock = false): void {
  const id = tile.dataset.yt;
  if (!id) return;
  if (cur?.tile === tile && !cur.ended) {
    if (cur.docked) undock(cur);
    return;
  }
  if (cur) close('replaced');
  document.querySelector<HTMLVideoElement>('[data-hero-video]')?.pause();

  const iframe = document.createElement('iframe');
  iframe.src = embedUrl(id);
  iframe.title = tile.dataset.title || 'YouTube video';
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  iframe.allowFullscreen = true;

  const s: Session = {
    id,
    title: tile.dataset.title || 'Video',
    location: tile.dataset.location || '',
    sourcePath: location.pathname,
    tile,
    original: [...tile.childNodes],
    iframe,
    stop: () => undefined,
    t: 0,
    playing: false,
    ended: false,
    docked: false,
    seconds: 0,
    max: 0,
    hit: new Set(),
  };
  cur = s;

  const d = dock();
  if (intoDock && d) {
    d.slot.replaceChildren(iframe);
    s.docked = true;
    restoreTile(s, 'docked');
    showDock(s);
  } else {
    tile.replaceChildren(iframe);
    tile.classList.add('is-playing');
  }
  track('video_play', { video_id: id, title: s.title, location: s.location });

  let prevT = -1;
  s.stop = watchPlayer(iframe, {
    onState: (state) => {
      s.playing = state === 1;
      if (state === 1) s.ended = false;
      signal(s);
      if (state === 0 && !s.ended) {
        s.ended = true;
        s.max = 100;
        signal(s);
        onEnded(s);
      }
    },
    onTime: (t, dur) => {
      // Count real watching only: forward steps under 2s while playing (seeks add nothing).
      if (s.playing && prevT >= 0 && t > prevT && t - prevT < 2) s.seconds += t - prevT;
      prevT = t;
      s.t = t;
      const pct = Math.min(100, Math.floor((t / dur) * 100));
      s.max = Math.max(s.max, pct);
      for (const m of MILESTONES) {
        if (pct >= m && !s.hit.has(m)) {
          s.hit.add(m);
          track('video_progress', { video_id: id, title: s.title, location: s.location, percent: m });
        }
      }
    },
  });
  observeTile(s);
}
export const play = (tile: HTMLElement) => play_(tile);

/** Native films and acoustic recordings share the existing persistent session. */
export function playNative(tile: HTMLElement, intoDock = false): void {
  const src = tile.dataset.mediaSrc;
  const id = tile.dataset.mediaId;
  if (!src?.startsWith('/media/') || !id) return;
  if (cur?.tile === tile && !cur.ended) {
    if (cur.iframe instanceof HTMLMediaElement) void cur.iframe.play().catch(() => {});
    return;
  }
  if (cur) close('replaced');
  document.querySelector<HTMLVideoElement>('[data-hero-video]')?.pause();
  const audio = tile.dataset.mediaType === 'audio';
  const media = document.createElement(audio ? 'audio' : 'video');
  media.src = src;
  media.controls = true;
  media.preload = 'metadata';
  media.setAttribute('aria-label', tile.dataset.title || 'Sean Carney live');
  if (media instanceof HTMLVideoElement) { media.playsInline = true; media.poster = tile.dataset.poster || ''; }
  const s: Session = {
    id, title: tile.dataset.title || 'Sean Carney live', location: tile.dataset.location || '',
    sourcePath: location.pathname, tile, original: [...tile.childNodes], iframe: media,
    stop: () => undefined, t: 0, playing: false, ended: false, docked: false, seconds: 0, max: 0, hit: new Set(),
  };
  cur = s;
  const d = dock();
  if ((audio || intoDock) && d) { d.slot.replaceChildren(media); s.docked = true; showDock(s); }
  else { tile.replaceChildren(media); tile.classList.add('is-playing'); }
  const events = new AbortController();
  const options = { signal: events.signal };
  s.stop = () => events.abort();
  const state = () => { s.playing = !media.paused; if(s.playing) s.ended = false; signal(s); };
  media.addEventListener('play', state, options);
  media.addEventListener('pause', state, options);
  media.addEventListener('ended', () => { s.ended = true; s.playing = false; signal(s); track('video_complete', {video_id: id, location: s.location}); }, options);
  media.addEventListener('timeupdate', () => {
    const t = media.currentTime;
    if(s.playing && t > s.t && t - s.t < 2) s.seconds += t - s.t;
    s.t = t;
    if(!Number.isFinite(media.duration) || media.duration <= 0) return;
    const percent = Math.floor(t / media.duration * 100);
    s.max = Math.max(s.max, percent);
    for(const milestone of MILESTONES) if(percent >= milestone && !s.hit.has(milestone)) {
      s.hit.add(milestone); track('video_progress', {video_id: id, location: s.location, percent: milestone});
    }
  }, options);
  media.addEventListener('error', () => {
    close('error');
    const message = document.createElement('p');
    message.className = 'media-error'; message.setAttribute('role', 'status');
    message.textContent = 'This recording could not load. Please try playing it again.';
    tile.append(message);
  }, { once: true, signal: events.signal });
  observeTile(s);
  void media.play().catch(() => { /* Native controls remain available when autoplay is blocked. */ });
  track('video_play', { video_id: id, title: s.title, location: s.location, kind: audio ? 'audio' : 'video' });
}

/** Dock control: back to the video in its tile (scrolling or navigating there). */
export async function back(): Promise<void> {
  const s = cur;
  if (!s) return;
  if (s.tile?.isConnected) {
    s.tile.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
    if (!(s.iframe instanceof HTMLAudioElement) && (canMove || s.iframe instanceof HTMLVideoElement)) window.setTimeout(() => cur === s && undock(s), reduceMotion() ? 0 : 450);
    return;
  }
  if (s.sourcePath !== location.pathname) {
    wantBack = true;
    await navigate(s.sourcePath);
  }
}

// ---------- router integration ----------
// Leaving the page: hand the video to the persistent dock before the DOM is swapped.
document.addEventListener('astro:before-swap', () => {
  if (!cur) return;
  if (cur.ended) close('navigate');
  else if (!cur.docked) dockSession(cur, 'navigate');
});
// New page: reconnect the session to its tile if this page has it.
document.addEventListener('astro:page-load', () => {
  const s = cur;
  if (!s) return;
  const tile = [...document.querySelectorAll<HTMLElement>('[data-yt], [data-media-id]')].find((t) => (t.dataset.yt || t.dataset.mediaId) === s.id) ?? null;
  s.tile = tile;
  if (tile) {
    s.original = [...tile.childNodes];
    tile.classList.add('is-docked');
    observeTile(s);
  } else s.io?.disconnect();
  if (s.docked) showDock(s);
  signal(s);
  if (wantBack && tile) {
    wantBack = false;
    tile.scrollIntoView({ block: 'center' });
    undock(s);
  }
});
