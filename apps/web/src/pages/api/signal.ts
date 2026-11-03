/**
 * POST /api/signal  { type: 'faq_open', id, page } | { type: 'visit', cohort: '2026-W45', week: 0-12 }
 * Lightweight, anonymous signals (sent with navigator.sendBeacon). No identifiers.
 */
import type { APIRoute } from 'astro';
import { recordFaqOpen, recordQuestion, recordVisit } from '../../lib/scout/signals';
import { matchIntents } from '../../lib/scout/intents';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = JSON.parse(await request.text()) as { type?: string; id?: string; page?: string; text?: string; cohort?: unknown; week?: unknown };
    if (body.type === 'visit' && typeof body.cohort === 'string' && typeof body.week === 'number') await recordVisit(body.cohort, body.week);
    // Guided-mode questions typed into Scout (no AI): same heuristic intent + gap logging.
    if (body.type === 'question' && typeof body.text === 'string') { const t = body.text.slice(0, 500); await recordQuestion(matchIntents(t), t, body.page?.slice(0, 120)); }
    if (body.type === 'faq_open' && typeof body.id === 'string') await recordFaqOpen(body.id.slice(0, 60), body.page?.slice(0, 120));
  } catch {
    /* ignore malformed beacons */
  }
  return new Response(null, { status: 204 });
};
