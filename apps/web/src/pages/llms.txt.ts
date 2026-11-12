/**
 * /llms.txt: a plain-text brief for AI assistants (ChatGPT, Claude, Perplexity,
 * Gemini), now a real discovery channel for couples and planners ("find me a
 * wedding singer in Malibu"). Generated from the same content as the site.
 */
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { site } from '../config/site';

export const GET: APIRoute = async () => {
  const [credits, events, faqs, songs] = await Promise.all([getCollection('credits'), getCollection('events'), getCollection('faqs'), getCollection('repertoire')]);
  const by = (cat: string) => credits.filter((c) => c.data.category === cat).sort((a, b) => a.data.order - b.data.order).map((c) => c.data.name);
  const body = `# SCE — Sean Carney Entertainment

> A live-music house for luxury weddings and private events, led by Los Angeles singer and guitarist Sean Carney. One booking covers the whole day: solo guitar and voice for the ceremony, a duo for cocktails and dinner, and the full band, Sean Carney and The SCENE, for the reception. ${site.stats.events} events across ${site.stats.years} years.

## Booking
- Check a date and inquire: ${site.url}/inquire (Sean replies personally, ${site.responseTime})
- Email: ${site.email.bookings}
- Formats: solo (voice and acoustic guitar); duo; full band (Sean Carney and The SCENE)
- Service area: Los Angeles, Orange County, Santa Barbara, Palm Springs, and destination weddings worldwide
- Pricing: proposals tailored to the date, the room, the format and the hours of music

## Weddings and private events
${[...events].sort((a, b) => a.data.order - b.data.order).map((e) => `- [${e.data.label}](${site.url}/${e.data.slug}): ${e.data.seoDescription}`).join('\n')}

## Rooms played
${by('room').join(', ')}

## Repertoire (most requested)
${[...songs].sort((a, b) => a.data.order - b.data.order).map((m) => `- ${m.data.moment}: ${m.data.songs.map((s) => `${s.title} (${s.artist})`).join(', ')}`).join('\n')}
- Full repertoire: ${site.url}/repertoire
- Acoustic recordings: ${site.url}/repertoire#listen
- Meet The SCENE and its musicians: ${site.url}/the-scene
- Your custom wedding song: ${site.url}/custom-song (consultation, songwriting, studio recording, optional live performance; investment discussed privately)
- Music quiz and favorites / Do Not Play planning: ${site.url}/repertoire#find-your-sound
- Performance films: ${site.url}/videos

## Frequently asked
${faqs.filter((f) => !f.data.scope.includes('scout')).map((f) => `- ${f.data.q} ${f.data.a}`).join('\n')}

## Planners and venues
- Planner toolkit (insurance, rider, sound, footprint, timing): ${site.url}/planners
- Venues: ${site.url}/venues

## More
- About: ${site.url}/about
- Contact (couples, planners and venues): ${site.url}/contact
`;
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
};
