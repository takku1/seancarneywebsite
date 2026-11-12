/**
 * schema.org JSON-LD builders. Structured facts are what search engines and AI
 * assistants quote when someone asks for "live music for a Malibu wedding", so
 * every page states them explicitly.
 */
import { site } from '../../config/site';

const ID = {
  person: `${site.url}/#sean-carney`,
  band: `${site.url}/#the-scene`,
  website: `${site.url}/#website`,
  service: `${site.url}/#booking`,
};

/** Sean, the performer. */
export function personSchema() {
  return {
    '@type': 'Person',
    '@id': ID.person,
    name: site.performerName,
    url: site.url,
    image: `${site.url}/og/default.jpg`,
    jobTitle: 'Wedding and private event musician',
    description:
      'Los Angeles singer and guitarist leading a live-music house for luxury weddings and private events: solo for ceremonies, duo for cocktails and dinner, and his full band, The SCENE, for receptions.',
    homeLocation: { '@type': 'Place', name: site.home },
    email: `mailto:${site.email.bookings}`,
    sameAs: site.socials.map((s) => s.url),
    knowsAbout: ['Wedding ceremony music', 'Cocktail hour music', 'Wedding reception bands', 'Private event entertainment'],
    memberOf: { '@type': 'MusicGroup', '@id': ID.band, name: 'Sean Carney and The SCENE' },
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
    name: 'Live music for weddings and private events',
    serviceType: 'Wedding and event live music',
    description: 'Solo, duo, and full-band live music for weddings, corporate evenings, charity galas, private estates and destination events.',
    provider: { '@id': ID.person },
    areaServed: areaServed.map((name) => ({ '@type': 'Place', name })),
    url: `${site.url}/weddings`,
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

export function graph(...nodes: object[]) {
  return { '@context': 'https://schema.org', '@graph': nodes };
}
