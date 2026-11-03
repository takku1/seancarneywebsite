/**
 * Media pipeline: one memoized build-time load that merges curated data
 * (src/data/videos.json, releases.json) with live platform data, then ranks it.
 *
 *   curated  -> clean titles, context (live / cover / original), notes, pins
 *   YouTube  -> every public upload with views, likes, duration, date
 *   Spotify  -> newest releases, most-played tracks
 *   Instagram-> latest posts
 *
 * Every source is optional. Missing keys or API errors fall back to curated
 * data and log a warning, so a build never fails because a platform is down.
 * Rules (pins, excludes, thresholds) live in src/data/feed-rules.json.
 * A daily scheduled rebuild keeps "newest" and view counts fresh.
 */
import { getCollection } from 'astro:content';
import { YOUTUBE_API_KEY, SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, INSTAGRAM_ACCESS_TOKEN } from 'astro:env/server';
import { fetchChannelVideos, type YtVideo } from './youtube';
import { fetchSpotify, type SpRelease, type SpTrack } from './spotify';
import { fetchInstagram, type IgPost } from './instagram';
import rules from '../../data/feed-rules.json';

export type VideoContext = 'original' | 'cover' | 'live' | 'session';

export interface Video {
  id: string;
  youtubeId: string;
  title: string;
  note?: string;
  context: VideoContext;
  published?: Date;
  views: number;
  likes: number;
  durationSec?: number;
  curated: boolean;
  order: number;
  scores: { best: number; event: number };
}

export interface Media {
  videos: Video[];
  releases: SpRelease[];
  topTracks: SpTrack[];
  instagram: IgPost[];
  sources: { youtube: boolean; spotify: boolean; instagram: boolean };
}

const LIVE_RE = /\b(live|reel|promo|performance|entertainment)\b|@/i;
const COVER_RE = /\bcover\b|#acousticcover/i;
const EVENT_BOOST_RE = new RegExp(rules.eventKeywords.join('|'), 'i');

function classify(title: string): VideoContext {
  if (LIVE_RE.test(title)) return 'live';
  if (COVER_RE.test(title)) return 'cover';
  return 'original';
}

/** "Sean Carney - "Stronger" Official Music Video #stronger" -> { title: Stronger, note: Official music video } */
function cleanTitle(raw: string): { title: string; note?: string } {
  let t = raw.replace(/#\w+/g, '').replace(/^\s*sean carney( (and|&) the (hustlers|scene))?\s*[-:|]\s*/i, '').trim();
  let note: string | undefined;
  const paren = t.match(/\((official[^)]*|live[^)]*|.*cover)\)/i);
  if (paren) {
    note = paren[1].replace(/^\w/, (c) => c.toUpperCase());
    t = t.replace(paren[0], '').trim();
  }
  const official = t.match(/\s+official (music|lyric) video\s*$/i);
  if (official) {
    note ??= `Official ${official[1].toLowerCase()} video`;
    t = t.replace(official[0], '').trim();
  }
  const coverOf = t.match(/^"?([^"]+)"?\s*-\s*(.+?)\s*cover\s*$/i);
  if (coverOf) return { title: coverOf[1].trim(), note: `Cover, ${coverOf[2].trim()}` };
  t = t.replace(/^"(.+?)"/, '$1').replace(/\s{2,}/g, ' ').replace(/[\s-]+$/, '');
  return { title: t, note };
}

function score(videos: Video[]): void {
  const maxViews = Math.max(1, ...videos.map((v) => v.views));
  const now = Date.now();
  for (const v of videos) {
    const pop = Math.log10(v.views + 1) / Math.log10(maxViews + 1);
    const ageDays = v.published ? (now - v.published.getTime()) / 86_400_000 : 365;
    const recency = Math.pow(0.5, ageDays / rules.recencyHalfLifeDays);
    const relevance = (v.context === 'live' ? 1 : v.context === 'cover' ? 0.7 : 0.45) + (EVENT_BOOST_RE.test(`${v.title} ${v.note ?? ''}`) ? 0.3 : 0);
    const curatedBoost = v.curated ? 0.05 : 0;
    v.scores = {
      best: 0.45 * pop + 0.25 * recency + 0.3 * Math.min(relevance, 1) + curatedBoost,
      event: 0.55 * Math.min(relevance, 1.3) + 0.3 * pop + 0.15 * recency,
    };
  }
}

async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<[T, boolean]> {
  try {
    return [await fn(), true];
  } catch (err) {
    console.warn(`[media] ${label} unavailable: ${(err as Error).message}. Using curated data.`);
    return [fallback, false];
  }
}

let cache: Promise<Media> | null = null;

export function loadMedia(): Promise<Media> {
  return (cache ??= (async () => {
    const curated = await getCollection('videos');
    const [yt, ytOk] = YOUTUBE_API_KEY ? await safe('YouTube', () => fetchChannelVideos(YOUTUBE_API_KEY!, rules.youtubeChannelId), [] as YtVideo[]) : [[] as YtVideo[], false];
    const [sp, spOk] =
      SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET
        ? await safe('Spotify', () => fetchSpotify(SPOTIFY_CLIENT_ID!, SPOTIFY_CLIENT_SECRET!, rules.spotifyArtistId), { releases: [], topTracks: [] })
        : [{ releases: [], topTracks: [] }, false];
    const [ig, igOk] = INSTAGRAM_ACCESS_TOKEN ? await safe('Instagram', () => fetchInstagram(INSTAGRAM_ACCESS_TOKEN!), [] as IgPost[]) : [[] as IgPost[], false];

    const exclude = new Set<string>(rules.excludeYoutubeIds as string[]);
    const byYt = new Map(yt.map((v) => [v.youtubeId, v]));
    const videos: Video[] = [];

    for (const c of curated) {
      if (exclude.has(c.data.youtubeId)) continue;
      const live = byYt.get(c.data.youtubeId);
      // When YouTube is connected, drop curated entries that were removed or made private.
      if (ytOk && !live) continue;
      videos.push({
        id: c.id,
        youtubeId: c.data.youtubeId,
        title: c.data.title,
        note: c.data.note,
        context: c.data.context,
        published: live?.published,
        views: live?.views ?? 0,
        likes: live?.likes ?? 0,
        durationSec: live?.durationSec,
        curated: true,
        order: c.data.order,
        scores: { best: 0, event: 0 },
      });
      byYt.delete(c.data.youtubeId);
    }

    // Uploads not in the curated list, filtered to what reads as professional.
    for (const v of byYt.values()) {
      if (exclude.has(v.youtubeId) || !v.embeddable) continue;
      if (v.durationSec < rules.minDurationSec || /#shorts/i.test(v.title)) continue;
      const { title, note } = cleanTitle(v.title);
      videos.push({
        id: v.youtubeId,
        youtubeId: v.youtubeId,
        title,
        note,
        context: classify(v.title),
        published: v.published,
        views: v.views,
        likes: v.likes,
        durationSec: v.durationSec,
        curated: false,
        order: 1000,
        scores: { best: 0, event: 0 },
      });
    }

    score(videos);
    return { videos, releases: sp.releases, topTracks: sp.topTracks, instagram: ig, sources: { youtube: ytOk, spotify: spOk, instagram: igOk } };
  })());
}

// ---------- selectors ----------
const dedupe = (list: Video[], taken: Set<string>, n: number) => {
  const out: Video[] = [];
  for (const v of list) {
    if (out.length >= n) break;
    if (taken.has(v.youtubeId)) continue;
    taken.add(v.youtubeId);
    out.push(v);
  }
  return out;
};

export const newest = (m: Media) =>
  [...m.videos].sort((a, b) => (b.published?.getTime() ?? 0) - (a.published?.getTime() ?? 0) || a.order - b.order);
export const mostWatched = (m: Media) => [...m.videos].sort((a, b) => b.views - a.views || a.order - b.order);
export const forEvents = (m: Media) => [...m.videos].sort((a, b) => b.scores.event - a.scores.event || a.order - b.order);
export const best = (m: Media) => [...m.videos].sort((a, b) => b.scores.best - a.scores.best || a.order - b.order);

export type Slot = { video: Video; reason: 'pinned' | 'best' | 'newest' | 'most_watched' | 'for_events' };

/**
 * Pick n videos for a placement. Pinned IDs (feed-rules.json "pins") come
 * first, then a strategy mix. Each placement gets a reason so captions and
 * analytics can say why a clip is there.
 */
export function pick(m: Media, placement: string, n: number, mix: Slot['reason'][] = ['for_events', 'newest', 'most_watched']): Slot[] {
  const taken = new Set<string>();
  const out: Slot[] = [];
  const pins = (rules.pins as Record<string, string[]>)[placement] ?? [];
  for (const id of pins) {
    const v = m.videos.find((x) => x.id === id || x.youtubeId === id);
    if (v && !taken.has(v.youtubeId) && out.length < n) {
      taken.add(v.youtubeId);
      out.push({ video: v, reason: 'pinned' });
    }
  }
  const lists: Record<Exclude<Slot['reason'], 'pinned'>, Video[]> = { best: best(m), newest: newest(m), most_watched: mostWatched(m), for_events: forEvents(m) };
  let i = 0;
  while (out.length < n && i < n * 4) {
    const reason = mix[i % mix.length] as Exclude<Slot['reason'], 'pinned'>;
    const [v] = dedupe(lists[reason], taken, 1);
    if (v) out.push({ video: v, reason });
    i++;
  }
  return out;
}

/** View counts only appear when they help: below the threshold they read as small. */
export function viewsLabel(v: Video): string | undefined {
  if (v.views < rules.showViewsAbove) return undefined;
  return `${v.views >= 1e6 ? `${(v.views / 1e6).toFixed(1)}M` : `${Math.round(v.views / 1000)}K`} views`;
}
