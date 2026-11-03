/**
 * Content queries shared by pages. Swap internals for Sanity GROQ later; the
 * return shapes are the contract the components depend on.
 */
import { getCollection, type CollectionEntry } from 'astro:content';
import appearanceRows from '../data/appearances.json';
import { loadMedia, newest } from './feeds/media';

export const fmtMonth = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
export const fmtDay = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export async function headlineCredits() {
  return (await getCollection('credits', (c) => c.data.headline)).sort((a, b) => a.data.order - b.data.order);
}

export async function creditsBy(category: CollectionEntry<'credits'>['data']['category']) {
  return (await getCollection('credits', (c) => c.data.category === category)).sort((a, b) => a.data.order - b.data.order);
}

/** Each release has its own smart-link page. */
export const releaseHref = (id: string) => `/music/${id}`;

export type Platform = { id: string; name: string; verb: string; icon?: 'spotify' | 'youtube' | 'soundcloud' };
/** Name a streaming/store link by its host, so labels and analytics stay consistent. */
export function platformOf(link: { label: string; url: string }, upcoming = false): Platform {
  const host = new URL(link.url).hostname.replace(/^www\./, '');
  if (host.endsWith('spotify.com')) return { id: 'spotify', name: 'Spotify', verb: 'Play', icon: 'spotify' };
  if (host === 'music.apple.com') return { id: 'apple_music', name: 'Apple Music', verb: 'Play' };
  if (host.endsWith('bandcamp.com')) return { id: 'bandcamp', name: 'Bandcamp', verb: 'Buy' };
  if (host.includes('youtube.com') || host === 'youtu.be') return { id: 'youtube', name: link.label === 'YouTube' ? 'YouTube' : link.label, verb: 'Watch', icon: 'youtube' };
  if (host.endsWith('soundcloud.com')) return { id: 'soundcloud', name: 'SoundCloud', verb: 'Play', icon: 'soundcloud' };
  // DistroKid HyperFollow is a pre-save before release and a "listen everywhere" page after it.
  if (host === 'distrokid.com' || /pre-?save/i.test(link.label)) return upcoming ? { id: 'presave', name: 'Pre-save', verb: 'Save' } : { id: 'all_platforms', name: 'All platforms', verb: 'Listen' };
  return { id: host.split('.')[0] ?? 'other', name: link.label, verb: 'Open' };
}

export async function featuredRelease() {
  const all = await getCollection('releases');
  return all.find((r) => r.data.featured) ?? all[0];
}

export interface FeedItem {
  date: Date;
  kind: 'Release' | 'Placement' | 'Press' | 'Appearance' | 'Video';
  title: string;
  detail?: string;
  href: string;
  external: boolean;
}

/** The dated "Latest" feed: newest releases, placements, press and public appearances. */
/** Public dates. The data file stays empty until shows are announced, so skip the lookup (and Astro's empty-collection warning). */
async function publicAppearances() {
  if (appearanceRows.length === 0) return [];
  return getCollection('appearances', (a) => a.data.visibility !== 'hidden');
}

export async function latestFeed(limit = 4): Promise<FeedItem[]> {
  const [releases, credits, press, appearances] = await Promise.all([
    getCollection('releases', (r) => !!r.data.date),
    getCollection('credits', (c) => !!c.data.date),
    getCollection('press', (p) => !!p.data.date),
    publicAppearances(),
  ]);
  const items: FeedItem[] = [
    ...releases.map((r) => ({ date: r.data.date!, kind: 'Release' as const, title: r.data.title, detail: r.data.artists, href: releaseHref(r.id), external: false })),
    ...credits.map((c) => ({ date: c.data.date!, kind: 'Placement' as const, title: c.data.name, detail: c.data.detail, href: '/about#credits', external: false })),
    ...press.map((p) => ({ date: p.data.date!, kind: 'Press' as const, title: p.data.outlet, detail: p.data.headline, href: p.data.url, external: true })),
    ...appearances.map((a) => ({ date: a.data.date, kind: 'Appearance' as const, title: a.data.visibility === 'anonymized' ? 'Private event' : a.data.venue, detail: a.data.city, href: '/shows', external: false })),
  ];
  // Auto items from the media pipeline: new Spotify releases and new uploads.
  const media = await loadMedia();
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
  const known = new Set(items.filter((i) => i.kind === 'Release').map((i) => norm(i.title)));
  for (const r of media.releases.slice(0, 4)) {
    if (known.has(norm(r.title))) continue;
    items.push({ date: r.date, kind: 'Release', title: r.title, detail: r.kind === 'single' ? 'New single' : 'New album', href: r.url, external: true });
  }
  if (media.sources.youtube) {
    for (const v of newest(media).slice(0, 2)) {
      if (!v.published) continue;
      items.push({ date: v.published, kind: 'Video', title: v.title, detail: v.note, href: `https://www.youtube.com/watch?v=${v.youtubeId}`, external: true });
    }
  }
  return items.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, limit);
}

export async function appearancesSplit(now = new Date()) {
  const all = (await publicAppearances()).sort((a, b) => a.data.date.getTime() - b.data.date.getTime());
  return {
    upcoming: all.filter((a) => a.data.date >= now),
    recent: all.filter((a) => a.data.date < now).reverse().slice(0, 12),
  };
}

export async function eventTypes() {
  return (await getCollection('events')).sort((a, b) => a.data.order - b.data.order);
}

export async function faqsFor(scope: string) {
  return (await getCollection('faqs')).filter((f) => f.data.scope.includes(scope));
}
