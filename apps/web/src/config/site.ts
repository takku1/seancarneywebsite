/**
 * Site settings singleton. Mirrors the future Sanity "siteSettings" document.
 * Anything marked CONFIRM needs Sean's sign-off before launch.
 */
export const site = {
  name: 'Sean Carney',
  url: 'https://seancarneymusic.com',
  tagline: 'Live music for weddings and private events.',
  role: 'Singer and guitarist; solo, trio and full band',
  home: 'Los Angeles, California',
  email: {
    bookings: 'sean@seancarneymusic.com', // CONFIRM: dedicated bookings@ alias
    press: 'sean@seancarneymusic.com', // CONFIRM: press@ alias
    licensing: 'sean@seancarneymusic.com', // CONFIRM: sync/publisher contact
    management: 'sean@seancarneymusic.com',
  },
  /** CONFIRM: promise only what can be kept every time. */
  responseTime: 'within one business day',
  bookingSeason: 'Sean accepts a limited number of weddings and private events each season.',
  socials: [
    { id: 'instagram', label: 'Instagram', handle: '@seancarneyentertainment', url: 'https://www.instagram.com/seancarneyentertainment' },
    { id: 'youtube', label: 'YouTube', handle: '@seanshredseverything', url: 'https://youtube.com/channel/UCx8Os2NEcWuAIf2nlaH9-yw' },
    { id: 'facebook', label: 'Facebook', handle: 'Sean Carney Music', url: 'https://www.facebook.com/seancarneymusic2' },
  ],
  stats: { years: '15+', events: '1,000+', countries: '50+' },
} as const;

export type SocialId = (typeof site.socials)[number]['id'];
