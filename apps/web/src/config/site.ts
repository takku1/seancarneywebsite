/**
 * Site settings singleton. Mirrors the future Sanity "siteSettings" document.
 * Anything marked CONFIRM needs Sean's sign-off before launch.
 */
export const site = {
  name: 'Sean Carney',
  url: 'https://seancarneymusic.com',
  tagline: 'Music for Outlaws',
  role: 'Singer, guitarist and producer',
  home: 'Los Angeles, California',
  email: {
    bookings: 'sean@seancarneymusic.com', // CONFIRM: dedicated bookings@ alias
    press: 'sean@seancarneymusic.com', // CONFIRM: press@ alias
    licensing: 'sean@seancarneymusic.com', // CONFIRM: sync/publisher contact
    management: 'sean@seancarneymusic.com',
  },
  /** CONFIRM: promise only what can be kept every time. */
  responseTime: 'within one business day',
  bookingSeason: 'Sean accepts a limited number of private engagements each season.',
  socials: [
    { id: 'instagram', label: 'Instagram', handle: '@seanshredseverything', url: 'https://instagram.com/seanshredseverything' },
    { id: 'instagram', label: 'Instagram, weddings and events', handle: '@seancarneyentertainment', url: 'https://www.instagram.com/seancarneyentertainment' },
    { id: 'youtube', label: 'YouTube', handle: '@seanshredseverything', url: 'https://youtube.com/channel/UCx8Os2NEcWuAIf2nlaH9-yw' },
    { id: 'spotify', label: 'Spotify', handle: 'Sean Carney', url: 'https://open.spotify.com/artist/0uh9aOz14Plm26aE3gz823' },
    { id: 'facebook', label: 'Facebook', handle: 'Sean Carney Music', url: 'https://www.facebook.com/seancarneymusic2' },
    { id: 'soundcloud', label: 'SoundCloud', handle: 'seancarneymusic', url: 'https://soundcloud.com/seancarneymusic' },
  ],
  fan: {
    merch: 'https://www.redbubble.com/people/SeanCarneyMerch/shop',
  },
  /**
   * Off-site follows are the retention that compounds: Spotify followers get new
   * releases in their Release Radar, YouTube subscribers get uploads in their
   * feed. sub_confirmation=1 opens YouTube's subscribe dialog directly.
   */
  follow: {
    spotify: 'https://open.spotify.com/artist/0uh9aOz14Plm26aE3gz823',
    youtube: 'https://youtube.com/channel/UCx8Os2NEcWuAIf2nlaH9-yw?sub_confirmation=1',
  },
  stats: { years: '15+', events: '1,000+', countries: '50+' },
} as const;

export type SocialId = (typeof site.socials)[number]['id'];
