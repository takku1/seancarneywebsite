/**
 * schema.org JSON-LD builders. Structured facts are what search engines and AI
 * assistants quote when someone asks "who is Sean Carney" or "live music for a
 * Malibu wedding", so every page states them explicitly.
 */
import { site } from '../../config/site';

const ID = {
  person: `${site.url}/#sean-carney`,
  band: `${site.url}/#the-hustlers`,
  website: `${site.url}/#website`,
  service: `${site.url}/#booking`,
};

export function personSchema(credits: string[] = []) {
  return {
    '@type': ['Person', 'MusicGroup'],
    '@id': ID.person,
    name: site.name,
    url: site.url,
    image: `${site.url}/og/default.jpg`,
    jobTitle: site.role,
    description:
      'Los Angeles singer, guitarist and producer. Billboard-charting songwriter whose music has featured in the 2024 Paris Olympics, the 2025 NFL Playoffs, Netflix and national campaigns.',
    genre: ['Rock', 'Americana', 'Cinematic rock', 'Country rock'],
    homeLocation: { '@type': 'Place', name: site.home },
    email: `mailto:${site.email.bookings}`,
    sameAs: site.socials.map((s) => s.url),
    knowsAbout: credits,
    member: { '@type': 'MusicGroup', '@id': ID.band, name: 'The Hustlers' },
  };
}

export function websiteSchema() {
  return { '@type': 'WebSite', '@id': ID.website, url: site.url, name: site.name, publisher: { '@id': ID.person } };
}

/** The bookable service: drives local/service-intent results. */
export function serviceSchema(areaServed: string[] = ['Los Angeles', 'Orange County', 'Santa Barbara', 'Palm Springs', 'Worldwide']) {
  return {
    '@type': 'Service',
    '@id': ID.service,
    name: 'Live music for weddings, corporate events, galas and private estates',
    serviceType: 'Live music entertainment',
    provider: { '@id': ID.person },
    areaServed: areaServed.map((name) => ({ '@type': 'Place', name })),
    url: `${site.url}/private-events`,
  };
}

export function breadcrumbSchema(items: { name: string; path: string }[]) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: `${site.url}${it.path}` })),
  };
}

export function faqSchema(faqs: { q: string; a: string }[]) {
  return {
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
}

/** A release. `url` is the release's own page on this site; `sameAs` are its streaming/store pages. */
export function albumSchema(r: { title: string; kind: string; date?: Date; url?: string; image?: string; description?: string; sameAs?: string[] }) {
  const isAlbum = r.kind === 'album' || r.kind === 'ep';
  return {
    '@type': isAlbum ? 'MusicAlbum' : 'MusicRecording',
    ...(r.url ? { '@id': `${r.url}#release` } : {}),
    name: r.title,
    byArtist: { '@id': ID.person },
    ...(isAlbum ? { albumProductionType: 'https://schema.org/StudioAlbum', albumReleaseType: r.kind === 'ep' ? 'https://schema.org/EPRelease' : 'https://schema.org/AlbumRelease' } : {}),
    ...(r.date ? { datePublished: r.date.toISOString().slice(0, 10) } : {}),
    ...(r.url ? { url: r.url } : {}),
    ...(r.image ? { image: r.image } : {}),
    ...(r.description ? { description: r.description } : {}),
    ...(r.sameAs?.length ? { sameAs: r.sameAs } : {}),
  };
}

export function eventSchema(e: { title: string; date: Date; venue: string; city: string; url?: string }) {
  return {
    '@type': 'MusicEvent',
    name: e.title,
    startDate: e.date.toISOString(),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: { '@type': 'Place', name: e.venue, address: e.city },
    performer: { '@id': ID.person },
    ...(e.url ? { url: e.url, offers: { '@type': 'Offer', url: e.url } } : {}),
  };
}

export function graph(...nodes: object[]) {
  return { '@context': 'https://schema.org', '@graph': nodes };
}
