/**
 * Content queries shared by pages. Swap internals for Sanity GROQ later; the
 * return shapes are the contract the components depend on.
 */
import { getCollection, type CollectionEntry } from 'astro:content';

export async function creditsBy(category: CollectionEntry<'credits'>['data']['category']) {
  return (await getCollection('credits', (c) => c.data.category === category)).sort((a, b) => a.data.order - b.data.order);
}

/** The rooms Sean has played, for typeset proof (home, About, galas). */
export const rooms = () => creditsBy('room');

export async function eventTypes() {
  return (await getCollection('events')).sort((a, b) => a.data.order - b.data.order);
}

/** Everything except weddings: the "Private events" section. */
export async function privateEventTypes() {
  return (await eventTypes()).filter((e) => e.data.slug !== 'weddings');
}

export async function faqsFor(scope: string) {
  return (await getCollection('faqs')).filter((f) => f.data.scope.includes(scope));
}

export async function repertoire() {
  return (await getCollection('repertoire')).sort((a, b) => a.data.order - b.data.order);
}
