/**
 * YouTube Data API v3 at build time. Cost per full refresh: about 3 quota units
 * (1 channel + ~2 playlist pages + 1 per 50 videos) out of 10,000 free/day.
 * The legacy channel RSS feeds return 404 as of 2026, so the API is required.
 */
export interface YtVideo {
  youtubeId: string;
  title: string;
  published: Date;
  views: number;
  likes: number;
  durationSec: number;
  embeddable: boolean;
}

const API = 'https://www.googleapis.com/youtube/v3';

async function get<T>(path: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`${API}/${path}?${new URLSearchParams(params)}`);
  if (!res.ok) throw new Error(`youtube_${path}_${res.status}`);
  return (await res.json()) as T;
}

const isoToSec = (iso: string) => {
  const m = iso.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const [, d, h, mi, s] = m.map((x) => Number(x ?? 0));
  return d * 86400 + h * 3600 + mi * 60 + s;
};

export async function fetchChannelVideos(apiKey: string, channelId: string, max = 150): Promise<YtVideo[]> {
  const ch = await get<{ items: { contentDetails: { relatedPlaylists: { uploads: string } } }[] }>('channels', { part: 'contentDetails', id: channelId, key: apiKey });
  const uploads = ch.items?.[0]?.contentDetails.relatedPlaylists.uploads;
  if (!uploads) return [];

  const ids: string[] = [];
  let pageToken = '';
  do {
    const page = await get<{ items: { contentDetails: { videoId: string } }[]; nextPageToken?: string }>('playlistItems', {
      part: 'contentDetails',
      playlistId: uploads,
      maxResults: '50',
      key: apiKey,
      ...(pageToken ? { pageToken } : {}),
    });
    ids.push(...page.items.map((i) => i.contentDetails.videoId));
    pageToken = page.nextPageToken ?? '';
  } while (pageToken && ids.length < max);

  const out: YtVideo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = await get<{
      items: {
        id: string;
        snippet: { title: string; publishedAt: string };
        statistics: { viewCount?: string; likeCount?: string };
        contentDetails: { duration: string };
        status: { embeddable: boolean; privacyStatus: string };
      }[];
    }>('videos', { part: 'snippet,statistics,contentDetails,status', id: ids.slice(i, i + 50).join(','), key: apiKey });
    for (const v of batch.items) {
      if (v.status.privacyStatus !== 'public') continue;
      out.push({
        youtubeId: v.id,
        title: v.snippet.title,
        published: new Date(v.snippet.publishedAt),
        views: Number(v.statistics.viewCount ?? 0),
        likes: Number(v.statistics.likeCount ?? 0),
        durationSec: isoToSec(v.contentDetails.duration),
        embeddable: v.status.embeddable,
      });
    }
  }
  return out;
}
