/**
 * Scout's tools, provider-neutral: JSON Schema specs plus executors. Any AI
 * backend adapter maps these specs to its own tool format and calls execute().
 * Every tool result also yields an optional UI card for the chat panel.
 */
import { z } from 'astro/zod';
import { GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY, GOOGLE_CALENDAR_IDS, AVAILABILITY_TIMEZONE } from 'astro:env/server';
import { checkDay } from '../integrations/google-calendar';
import { inquirySchema, EVENT_TYPES, BUDGETS, ROLES, FORMATS, GUESTS } from '../inquiry/schema';
import { labelOf } from '../inquiry/process';
import { signDraft } from './draft';
import { draftSecret } from './draft-secret';
import { loadKnowledge, type CatalogItem } from './knowledge';
import { errorCode } from '../security/errors';

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** The only places Scout can send someone. Never external URLs. */
export const SITE_PAGES: Record<string, string> = {
  '/inquire': 'Send an inquiry',
  '/private-events': 'Private events',
  '/weddings': 'Weddings',
  '/corporate': 'Corporate and brand',
  '/estate': 'Private and estate',
  '/galas': 'Charity galas',
  '/destination': 'Destination events',
  '/repertoire': 'Repertoire',
  '/planners': 'For planners',
  '/venues': 'Venues',
  '/about': 'About Sean',
  '/the-scene': 'Meet The Scene',
  '/custom-song': 'Your custom wedding song',
  '/videos': 'Watch SCE live',
  '/contact': 'Contact',
};

export type Card =
  | { kind: 'link'; href: string; label: string }
  | { kind: 'availability'; date: string; status: string }
  | { kind: 'media'; items: CatalogItem[] }
  | { kind: 'inquiry'; leadId: string; tier: string }
  /** A prepared inquiry the visitor sends with a click (lib/scout/draft.ts). Nothing is sent until then. */
  | { kind: 'inquiry_confirm'; token: string; summary: { name: string; email: string; event: string; date: string; location: string } };

export interface ToolContext {
  attribution: Record<string, string>;
  experiments: Record<string, string>;
  page?: string;
  /** Everything the visitor typed this conversation (for grounding checks). */
  visitorText?: string;
}

export interface ToolOutcome {
  /** JSON string returned to the model. */
  result: string;
  isError?: boolean;
  card?: Card;
}

const enumOf = (list: readonly { value: string }[]) => list.map((x) => x.value);

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'check_availability',
    description:
      "Check whether a date looks open on Sean's calendar. Returns open, busy, past or unknown. Indicative only; never present it as a confirmed booking.",
    input_schema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'Event date, YYYY-MM-DD. Resolve relative dates using today from the context tag.' } },
      required: ['date'],
      additionalProperties: false,
    },
  },
  {
    name: 'show_media',
    description: 'Show the visitor up to three videos or releases as playable cards in the chat. Use ids exactly as listed in the catalog, e.g. "video:reel-2025".',
    input_schema: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 } },
      required: ['ids'],
      additionalProperties: false,
    },
  },
  {
    name: 'open_page',
    description: 'Offer the visitor a button to a page on this site when it would help (event details, press kit, the inquiry form). Only these pages exist.',
    input_schema: {
      type: 'object',
      properties: { page: { type: 'string', enum: Object.keys(SITE_PAGES) } },
      required: ['page'],
      additionalProperties: false,
    },
  },
  {
    name: 'submit_inquiry',
    description:
      'Prepare a booking inquiry for the visitor to send. Only call after reading the details back and getting a clear yes; set visitor_confirmed to true. It does NOT send anything: the visitor sees the details with a Send button and the inquiry goes to Sean only when they press it. Returns prepared: true, or the fields that need fixing. Never say the inquiry has been sent.',
    input_schema: {
      type: 'object',
      properties: {
        visitor_confirmed: { type: 'boolean' },
        event_type: { type: 'string', enum: enumOf(EVENT_TYPES) },
        event_date: { type: 'string', description: 'YYYY-MM-DD, or empty string if flexible/unknown' },
        date_flexible: { type: 'boolean' },
        location: { type: 'string', description: 'City or venue' },
        guests: { type: 'string', enum: [...GUESTS] },
        format: { type: 'string', enum: enumOf(FORMATS) },
        budget: { type: 'string', enum: enumOf(BUDGETS) },
        name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        role: { type: 'string', enum: enumOf(ROLES) },
        company: { type: 'string' },
        message: { type: 'string', description: 'Short summary of anything else they shared' },
      },
      required: ['visitor_confirmed', 'event_type', 'location', 'budget', 'name', 'email', 'role'],
      additionalProperties: false,
    },
  },
];

export async function executeTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const args = (input ?? {}) as Record<string, unknown>;
  try {
    switch (name) {
      case 'check_availability': {
        const date = String(args.date ?? '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { result: JSON.stringify({ error: 'date must be YYYY-MM-DD' }), isError: true };
        if (date < new Date().toISOString().slice(0, 10)) return { result: JSON.stringify({ date, status: 'past' }), card: { kind: 'availability', date, status: 'past' } };
        if (!GOOGLE_SA_EMAIL || !GOOGLE_SA_PRIVATE_KEY || !GOOGLE_CALENDAR_IDS) {
          return { result: JSON.stringify({ date, status: 'unknown', note: 'Calendar not connected. Offer to send an inquiry so Sean can confirm.' }) };
        }
        const day = await checkDay({
          date,
          calendarIds: GOOGLE_CALENDAR_IDS.split(',').map((s) => s.trim()).filter(Boolean),
          clientEmail: GOOGLE_SA_EMAIL,
          privateKey: GOOGLE_SA_PRIVATE_KEY,
          timeZone: AVAILABILITY_TIMEZONE || 'America/Los_Angeles',
        });
        return { result: JSON.stringify({ date, status: day.status }), card: { kind: 'availability', date, status: day.status } };
      }
      case 'show_media': {
        const { catalog } = await loadKnowledge();
        const ids = Array.isArray(args.ids) ? args.ids.map(String).slice(0, 3) : [];
        const items = ids.map((id) => catalog.get(id)).filter((x): x is CatalogItem => !!x);
        if (!items.length) return { result: JSON.stringify({ error: 'No matching catalog ids. Use ids exactly as listed.' }), isError: true };
        return { result: JSON.stringify({ shown: items.map((i) => i.title) }), card: { kind: 'media', items } };
      }
      case 'open_page': {
        const page = String(args.page ?? '');
        if (!SITE_PAGES[page]) return { result: JSON.stringify({ error: 'Unknown page' }), isError: true };
        return { result: JSON.stringify({ offered: page }), card: { kind: 'link', href: page, label: SITE_PAGES[page] } };
      }
      case 'submit_inquiry': {
        if (args.visitor_confirmed !== true) {
          return { result: JSON.stringify({ error: 'Read the details back and get a clear yes before submitting.' }), isError: true };
        }
        // Excessive agency guard (OWASP LLM06 / ASI02): the email and name must be
        // things the visitor actually typed, so injected text or a hallucination
        // can never create a lead on someone else's behalf.
        const said = (ctx.visitorText ?? '').toLowerCase();
        const email = String(args.email ?? '').toLowerCase().trim();
        const firstName = String(args.name ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
        if (!email || !said.includes(email) || !firstName || !said.includes(firstName)) {
          return { result: JSON.stringify({ error: 'Ask the visitor to type their name and email in the chat before submitting.' }), isError: true };
        }
        const parsed = inquirySchema.safeParse({
          ...args,
          event_date: args.event_date ?? '',
          date_flexible: Boolean(args.date_flexible) || !args.event_date,
          format: args.format ?? 'unsure',
          moments: [],
          sms_consent: false,
          attribution: ctx.attribution,
          experiments: ctx.experiments,
          page: ctx.page ? `${ctx.page} (scout)` : 'scout',
        });
        if (!parsed.success) {
          return { result: JSON.stringify({ error: 'Some details need fixing', fields: z.flattenError(parsed.error).fieldErrors }), isError: true };
        }
        // The model prepares; the visitor sends. Nothing is submitted here: the panel shows
        // this signed draft with a Send button, and only that click reaches POST /api/scout/inquire.
        const secret = draftSecret();
        if (!secret) return { result: JSON.stringify({ error: 'Inquiries cannot be prepared in chat right now. Point the visitor to the inquiry form.' }), isError: true };
        const d = parsed.data;
        const token = await signDraft(d, secret);
        return {
          result: JSON.stringify({ prepared: true, note: 'Shown to the visitor with a Send button. Nothing is sent until they press it. Tell them to press Send when ready; do not say it has been sent.' }),
          card: { kind: 'inquiry_confirm', token, summary: { name: d.name, email: d.email, event: labelOf(EVENT_TYPES, d.event_type), date: d.event_date || 'Flexible', location: d.location } },
        };
      }
      default:
        return { result: JSON.stringify({ error: `Unknown tool ${name}` }), isError: true };
    }
  } catch (err) {
    console.warn('[scout] tool error', name, errorCode(err));
    return { result: JSON.stringify({ error: 'Tool unavailable right now' }), isError: true };
  }
}
