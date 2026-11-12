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
    /** Rooms: file stem of a single-ink logo in src/assets/logos/ (media-library.json). Other credits: simple-icons slug. */
    logo: z.string().optional(),
    /** A logo is shown only once Sean approves it (recorded in 14-decision-register.md). */
    logoApproved: z.boolean().default(false),
    headline: z.boolean().default(false),
    order: z.number().default(100),
    /**
     * Rooms only: Sean's own account of playing there (setting, formats, a moment).
     * A venue page is indexed by search engines only once this exists, so thin pages never ship as SEO.
     */
    story: z.string().optional(),
  }),
});

const testimonials = defineCollection({
  loader: file('src/data/testimonials.json'),
  schema: z.object({
    quote: z.string(),
    name: z.string().optional(),
    role: z.string(),
    eventType: z.enum(['wedding', 'corporate', 'estate', 'gala', 'destination', 'celebration']),
    /** Where the quote was published or received (provenance), e.g. "Bark review, 2023-12-21". */
    source: z.string().min(3),
    /**
     * A name is displayed only when consent is 'granted', and 'granted' requires a
     * recorded approval: who confirmed, when, and what they agreed to. A bare flag
     * is not evidence. Register: docs/current/14-decision-register.md.
     */
    consent: z.enum(['granted', 'pending']).default('pending'),
    approval: z.object({ by: z.string().min(2), on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), scope: z.string().min(3) }).optional(),
    featured: z.boolean().default(false),
  }).refine((t) => t.consent !== 'granted' || !!t.approval, { message: "consent 'granted' needs an approval record { by, on, scope }", path: ['approval'] }),
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
          href: z.string().regex(/^\/(?!\/)/).optional(),
          linkLabel: z.string().optional(),
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

const songbook = defineCollection({
  loader: file('src/data/songbook.json'),
  schema: z.object({ genre: z.string(), order: z.number(), songs: z.array(z.object({ title: z.string(), artist: z.string() })) }),
});

const faqs = defineCollection({
  loader: file('src/data/faqs.json'),
  schema: z.object({
    q: z.string(),
    a: z.string(),
    scope: z.array(z.string()).default(['all']),
  }),
});

export const collections = { credits, testimonials, videos, events, repertoire, songbook, faqs };
