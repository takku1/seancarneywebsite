import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { file } from 'astro/loaders';

/**
 * Content model. Each collection mirrors a planned Sanity document type so the
 * loader can be swapped for a Sanity loader without touching components.
 * Local JSON lives in src/data/.
 */

const credits = defineCollection({
  loader: file('src/data/credits.json'),
  schema: z.object({
    name: z.string(),
    detail: z.string().optional(),
    category: z.enum(['sync', 'broadcast', 'chart', 'room', 'venue', 'client', 'endorsement']),
    year: z.number().optional(),
    date: z.coerce.date().optional(),
    /** simple-icons slug for the monochrome mark, when one exists. */
    logo: z.string().optional(),
    /** CONFIRM per brand before launch (current live site already shows these marks). */
    logoApproved: z.boolean().default(false),
    headline: z.boolean().default(false),
    order: z.number().default(100),
  }),
});

const testimonials = defineCollection({
  loader: file('src/data/testimonials.json'),
  schema: z.object({
    quote: z.string(),
    name: z.string().optional(),
    role: z.string(),
    eventType: z.enum(['wedding', 'corporate', 'estate', 'gala', 'destination', 'celebration']),
    /** 'granted' required before a name is displayed */
    consent: z.enum(['granted', 'pending']).default('pending'),
    featured: z.boolean().default(false),
  }),
});

const videos = defineCollection({
  loader: file('src/data/videos.json'),
  schema: z.object({
    title: z.string(),
    youtubeId: z.string(),
    context: z.enum(['cover', 'live', 'session']),
    note: z.string().optional(),
    order: z.number().default(100),
  }),
});

const events = defineCollection({
  loader: file('src/data/events.json'),
  schema: ({ image }) =>
    z.object({
      slug: z.string(),
      label: z.string(),
      navLabel: z.string(),
      seoTitle: z.string(),
      seoDescription: z.string(),
      headline: z.string(),
      intro: z.string(),
      image: image(),
      imageAlt: z.string(),
      formType: z.string(),
      /** Page sections, in order. Each event type composes its own page. */
      blocks: z.array(
        z.object({
          type: z.enum(['timeline', 'columns', 'program', 'steps', 'feature', 'film', 'repertoire', 'clients', 'specs', 'checklist', 'statement', 'testimonials', 'stages', 'reach', 'faq']),
          title: z.string().optional(),
          body: z.string().optional(),
          note: z.string().optional(),
          story: z.string().optional(),
          caption: z.string().optional(),
          alt: z.string().optional(),
          image: image().optional(),
          items: z.array(z.union([z.string(), z.object({ title: z.string().optional(), body: z.string().optional(), k: z.string().optional(), v: z.string().optional() })])).optional(),
          ids: z.array(z.string()).optional(),
          eventType: z.string().optional(),
          strict: z.boolean().optional(),
          limit: z.number().optional(),
          playlist: z.string().optional(),
          solo: z.array(z.string()).optional(),
          band: z.array(z.string()).optional(),
        }),
      ),
      order: z.number(),
    }),
});

/** Songs by moment of the day. A sample: full lists and requests come with the proposal. */
const repertoire = defineCollection({
  loader: file('src/data/repertoire.json'),
  schema: z.object({
    moment: z.string(),
    note: z.string(),
    order: z.number(),
    songs: z.array(z.object({ title: z.string(), artist: z.string() })),
  }),
});

const faqs = defineCollection({
  loader: file('src/data/faqs.json'),
  schema: z.object({
    q: z.string(),
    a: z.string(),
    scope: z.array(z.string()).default(['all']),
  }),
});

export const collections = { credits, testimonials, videos, events, repertoire, faqs };
