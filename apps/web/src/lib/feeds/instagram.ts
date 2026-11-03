/**
 * Instagram API with Instagram Login (professional account required; the old
 * Basic Display API was retired in Dec 2024). Long-lived tokens last 60 days
 * and must be refreshed (GET /refresh_access_token); see the workflow doc.
 */
export interface IgPost {
  id: string;
  caption: string;
  kind: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  image: string;
  url: string;
  date: Date;
  likes: number;
}

export async function fetchInstagram(accessToken: string, limit = 24): Promise<IgPost[]> {
  const fields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count';
  const res = await fetch(`https://graph.instagram.com/me/media?fields=${fields}&limit=${limit}&access_token=${encodeURIComponent(accessToken)}`);
  if (!res.ok) throw new Error(`instagram_${res.status}`);
  const data = (await res.json()) as {
    data: { id: string; caption?: string; media_type: IgPost['kind']; media_url?: string; thumbnail_url?: string; permalink: string; timestamp: string; like_count?: number }[];
  };
  return data.data
    .map((p) => ({
      id: p.id,
      caption: (p.caption ?? '').split('\n')[0].slice(0, 140),
      kind: p.media_type,
      image: (p.media_type === 'VIDEO' ? p.thumbnail_url : p.media_url) ?? '',
      url: p.permalink,
      date: new Date(p.timestamp),
      likes: p.like_count ?? 0,
    }))
    .filter((p) => p.image);
}
