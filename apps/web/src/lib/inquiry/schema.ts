/**
 * Inquiry contract shared by the form (client) and the API (server).
 * Field names are stable: the CRM mapping and analytics depend on them.
 */
import { z } from 'astro/zod';

export const EVENT_TYPES = [
  { value: 'wedding', label: 'Wedding' },
  { value: 'corporate', label: 'Corporate event' },
  { value: 'brand', label: 'Brand activation or launch' },
  { value: 'estate', label: 'Private or estate event' },
  { value: 'gala', label: 'Charity gala' },
  { value: 'destination', label: 'Destination event' },
  { value: 'other', label: 'Something else' },
] as const;

export const GUESTS = ['Under 50', '50 to 150', '150 to 300', '300 to 1,000', 'Over 1,000'] as const;

export const FORMATS = [
  { value: 'solo', label: 'Solo acoustic' },
  { value: 'small', label: 'Duo' },
  { value: 'band', label: 'Full band, The Scene' },
  { value: 'unsure', label: 'Not sure yet' },
] as const;

export const MOMENTS = ['Ceremony', 'Cocktail hour', 'Dinner', 'Dancing', 'Featured performance', 'After-party'] as const;

/** Bands are deliberately wide; "discuss" keeps high-net-worth clients comfortable. */
export const BUDGETS = [
  { value: 'under_5k', label: 'Under $5,000' },
  { value: '5k_10k', label: '$5,000 to $10,000' },
  { value: '10k_20k', label: '$10,000 to $20,000' },
  { value: '20k_40k', label: '$20,000 to $40,000' },
  { value: '40k_plus', label: '$40,000 and above' },
  { value: 'discuss', label: 'Prefer to discuss' },
] as const;

export const ROLES = [
  { value: 'couple', label: 'Couple or family' },
  { value: 'planner', label: 'Planner or coordinator' },
  { value: 'corporate', label: 'Company or agency' },
  { value: 'venue', label: 'Venue' },
  { value: 'other', label: 'Other' },
] as const;

const values = <T extends readonly { value: string }[]>(arr: T) => arr.map((a) => a.value) as [T[number]['value'], ...T[number]['value'][]];

export const inquirySchema = z.object({
  event_type: z.enum(values(EVENT_TYPES)),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  date_flexible: z.boolean().default(false),
  location: z.string().trim().min(2, 'Add a city or venue').max(160),
  guests: z.enum(GUESTS).optional(),
  format: z.enum(values(FORMATS)).default('unsure'),
  moments: z.array(z.enum(MOMENTS)).default([]),
  budget: z.enum(values(BUDGETS)),
  name: z.string().trim().min(2, 'Add your name').max(120),
  email: z.string().trim().pipe(z.email('Add a valid email').max(200)),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  role: z.enum(values(ROLES)),
  company: z.string().trim().max(160).optional().or(z.literal('')),
  message: z.string().trim().max(3000).optional().or(z.literal('')),
  sms_consent: z.boolean().default(false),
  // Context
  attribution: z.record(z.string(), z.string()).default({}),
  experiments: z.record(z.string(), z.string()).default({}),
  page: z.string().max(300).optional(),
  // Ads measurement (Meta CAPI dedupe); ads_ok mirrors the browser's consent + opt-out state
  event_id: z.uuid().optional(),
  ads_ok: z.boolean().optional(),
  // Anti-spam
  website: z.string().max(500).optional(), // honeypot: checked in the handler so bots get a silent "success"
  started_at: z.number().optional(),
  turnstile_token: z.string().optional(),
});

export type Inquiry = z.infer<typeof inquirySchema>;

/**
 * Lead tiering so Sean answers the highest-value inquiries first.
 * Signals: budget band, lead time, planner involvement, format, guest count.
 * Weights are a starting point; recalibrate against booked revenue after 90 days.
 */
export function scoreLead(i: Inquiry, now = new Date()): { score: number; tier: 'A' | 'B' | 'C'; signals: string[] } {
  let score = 0;
  const signals: string[] = [];
  const budgetPts: Record<string, number> = { under_5k: 0, '5k_10k': 15, '10k_20k': 30, '20k_40k': 40, '40k_plus': 50, discuss: 25 };
  score += budgetPts[i.budget] ?? 0;
  signals.push(`budget:${i.budget}`);

  if (i.role === 'planner' || i.role === 'venue') {
    score += 15;
    signals.push('trade_referrer');
  }
  if (i.role === 'corporate') {
    score += 10;
    signals.push('corporate');
  }
  if (i.format === 'band') {
    score += 10;
    signals.push('full_band');
  }
  if (i.guests && ['150 to 300', '300 to 1,000', 'Over 1,000'].includes(i.guests)) {
    score += 5;
    signals.push('large_event');
  }
  if (i.event_date) {
    const days = (Date.parse(i.event_date) - now.getTime()) / 86_400_000;
    if (days < 0) signals.push('date_in_past');
    else if (days < 30) {
      score += 5;
      signals.push('urgent_under_30d');
    } else if (days <= 540) {
      score += 10;
      signals.push('ideal_lead_time');
    }
  }
  const tier = score >= 55 ? 'A' : score >= 30 ? 'B' : 'C';
  return { score, tier, signals };
}
