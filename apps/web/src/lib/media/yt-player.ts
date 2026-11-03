/**
 * Watch-progress for the click-to-load YouTube embeds, without loading the
 * YouTube IFrame API script (the CSP stays as strict as it is).
 *
 * With `enablejsapi=1&origin=<ours>` on the embed URL, the player speaks the
 * same postMessage protocol the official API uses: we send `listening`, it
 * replies with `infoDelivery` messages carrying currentTime, duration and
 * playerState (1 playing, 2 paused, 0 ended). This channel is not formally
 * documented by YouTube; if it ever changes, playback still works and only
 * these metrics stop arriving.
 *
 * Messages are accepted only from the youtube-nocookie origin AND from this
 * exact iframe's window, and only numeric fields are read.
 */
const ORIGIN = 'https://www.youtube-nocookie.com';

export interface PlayerHandlers {
  /** Fires on each update while info arrives. */
  onTime?: (currentTime: number, duration: number) => void;
  onState?: (state: number) => void;
}

/** Embed URL with the message channel enabled. `start` (seconds) resumes playback after a reload. */
export function embedUrl(id: string, start = 0): string {
  const p = new URLSearchParams({ autoplay: '1', rel: '0', modestbranding: '1', playsinline: '1', enablejsapi: '1', origin: location.origin });
  if (start > 0) p.set('start', String(Math.floor(start)));
  return `${ORIGIN}/embed/${encodeURIComponent(id)}?${p}`;
}

/** Send a player command (e.g. 'pauseVideo', 'playVideo') over the same channel. */
export function command(iframe: HTMLIFrameElement, func: string, args: unknown[] = []): void {
  iframe.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args, id: iframe.dataset.channel ?? '', channel: 'widget' }), ORIGIN);
}

export function watchPlayer(iframe: HTMLIFrameElement, h: PlayerHandlers): () => void {
  const channel = `sc-${Math.random().toString(36).slice(2, 10)}`;
  iframe.dataset.channel = channel;
  let heard = false;
  let lastState = -2;
  let duration = 0;

  const send = () => iframe.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: channel, channel: 'widget' }), ORIGIN);
  // The player ignores messages until it has loaded; keep saying hello until it answers (as the official API does).
  // Restarted on every load, so a reloaded iframe (e.g. re-attached after navigation) reconnects.
  let hello = 0;
  const startHello = () => {
    window.clearInterval(hello);
    heard = false;
    let tries = 0;
    hello = window.setInterval(() => {
      if (heard || ++tries > 40) return window.clearInterval(hello);
      send();
    }, 250);
  };
  startHello();
  iframe.addEventListener('load', startHello);

  const onMessage = (e: MessageEvent) => {
    if (e.origin !== ORIGIN || e.source !== iframe.contentWindow) return;
    let data: { event?: string; info?: unknown };
    try {
      data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
    } catch {
      return;
    }
    if (!data || typeof data !== 'object') return;
    heard = true;
    const info = data.info as Record<string, unknown> | number | null | undefined;
    if (data.event === 'onStateChange' && typeof info === 'number') {
      if (info !== lastState) h.onState?.((lastState = info));
      return;
    }
    if ((data.event === 'infoDelivery' || data.event === 'initialDelivery') && info && typeof info === 'object') {
      if (typeof info.playerState === 'number' && info.playerState !== lastState) h.onState?.((lastState = info.playerState));
      // Duration usually arrives once (initialDelivery); later updates carry only currentTime.
      if (typeof info.duration === 'number' && info.duration > 0) duration = info.duration;
      if (typeof info.currentTime === 'number' && duration > 0) h.onTime?.(info.currentTime, duration);
    }
  };
  window.addEventListener('message', onMessage);
  return () => {
    window.clearInterval(hello);
    iframe.removeEventListener('load', startHello);
    window.removeEventListener('message', onMessage);
  };
}
