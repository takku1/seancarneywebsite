/**
 * Spotify Web API (client credentials) at build time: newest releases and
 * most-played tracks for the artist. Free; create an app at
 * developer.spotify.com and use its client ID/secret.
 */
export interface SpRelease {
  spotifyId: string;
  title: string;
  kind: 'album' | 'single' | 'compilation';
  date: Date;
  cover?: string;
  url: string;
}
export interface SpTrack {
  spotifyId: string;
  title: string;
  album: string;
  cover?: string;
  url: string;
  popularity: number;
}

async function token(id: string, secret: string): Promise<string> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { authorization: `Basic ${btoa(`${id}:${secret}`)}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`spotify_token_${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function api<T>(t: string, path: string): Promise<T> {
  const res = await fetch(`https://api.spotify.com/v1${path}`, { headers: { authorization: `Bearer ${t}` } });
  if (!res.ok) throw new Error(`spotify_${path}_${res.status}`);
  return (await res.json()) as T;
}

/** Spotify dates can be "2026", "2026-08" or "2026-08-14". */
const parseDate = (d: string) => new Date(d.length === 4 ? `${d}-01-01` : d.length === 7 ? `${d}-01` : d);

export async function fetchSpotify(id: string, secret: string, artistId: string): Promise<{ releases: SpRelease[]; topTracks: SpTrack[] }> {
  const t = await token(id, secret);
  const [albums, top] = await Promise.all([
    api<{ items: { id: string; name: string; album_type: SpRelease['kind']; release_date: string; images: { url: string }[]; external_urls: { spotify: string } }[] }>(
      t,
      `/artists/${artistId}/albums?include_groups=album,single&market=US&limit=30`,
    ),
    api<{ tracks: { id: string; name: string; popularity: number; album: { name: string; images: { url: string }[] }; external_urls: { spotify: string } }[] }>(
      t,
      `/artists/${artistId}/top-tracks?market=US`,
    ).catch(() => ({ tracks: [] })),
  ]);
  return {
    releases: albums.items
      .map((a) => ({ spotifyId: a.id, title: a.name, kind: a.album_type, date: parseDate(a.release_date), cover: a.images[0]?.url, url: a.external_urls.spotify }))
      .sort((a, b) => b.date.getTime() - a.date.getTime()),
    topTracks: top.tracks.map((x) => ({ spotifyId: x.id, title: x.name, album: x.album.name, cover: x.album.images[1]?.url ?? x.album.images[0]?.url, url: x.external_urls.spotify, popularity: x.popularity })),
  };
}
