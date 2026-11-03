/**
 * /llms.txt: a plain-text brief for AI assistants (ChatGPT, Claude, Perplexity,
 * Gemini), now a real discovery channel for event buyers ("find me a wedding
 * singer in Malibu"). Generated from the same content as the site.
 */
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { site } from '../config/site';
import { releaseHref } from '../lib/content';

export const GET: APIRoute = async () => {
  const [credits, events, releases, faqs] = await Promise.all([getCollection('credits'), getCollection('events'), getCollection('releases'), getCollection('faqs')]);
  const by = (cat: string) => credits.filter((c) => c.data.category === cat).sort((a, b) => a.data.order - b.data.order).map((c) => c.data.name);
  const latest = [...releases].sort((a, b) => (b.data.date?.getTime() ?? 0) - (a.data.date?.getTime() ?? 0))[0];
  const body = `# Sean Carney

> ${site.role} based in ${site.home}. Billboard-charting songwriter and Recording Academy voting member whose music has featured in the 2024 Paris Olympics, the 2025 NFL Playoffs and Netflix. Performs solo, as a duo or trio, or with his band The Hustlers for weddings, corporate events, charity galas, private estates and destination events.

## Booking
- Inquiries: ${site.url}/inquire (reply ${site.responseTime})
- Email: ${site.email.bookings}
- Formats: solo acoustic, duo or trio, full band (Sean Carney and The Hustlers)
- Service area: Los Angeles, Orange County, Santa Barbara, Palm Springs, and worldwide travel
- Pricing: tailored proposals based on format, date, location and hours

## Event types
${[...events].sort((a, b) => a.data.order - b.data.order).map((e) => `- [${e.data.label}](${site.url}/${e.data.slug}): ${e.data.seoDescription}`).join('\n')}

## Credits
- Film, TV and campaigns: ${[...by('sync'), ...by('broadcast')].join(', ')}
- Recognition: ${by('chart').join(', ')}
- Venues: ${by('venue').join(', ')}
- Clients: ${by('client').join(', ')}

## Music
- Latest release: ${latest?.data.title}${latest?.data.date ? ` (${latest.data.date.getUTCFullYear()})` : ''}
- Music and videos: ${site.url}/music
${[...releases].sort((a, b) => (b.data.date?.getTime() ?? 0) - (a.data.date?.getTime() ?? 0)).map((r) => `- [${r.data.title}](${site.url}${releaseHref(r.id)}): ${r.data.artists}${r.data.date ? `, ${r.data.date.getUTCFullYear()}` : ''}. ${r.data.hook}`).join('\n')}
- Shows and tickets: ${site.url}/shows

## Frequently asked
${faqs.filter((f) => !f.data.scope.includes('scout')).map((f) => `- ${f.data.q} ${f.data.a}`).join('\n')}

## More
- About: ${site.url}/about
- Press kit: ${site.url}/press (one-page summary: ${site.url}/press/one-sheet)
- Contact: ${site.url}/contact
`;
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
};
