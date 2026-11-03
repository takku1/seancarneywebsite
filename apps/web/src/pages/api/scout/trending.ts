/**
 * GET /api/scout/trending?page=/weddings
 * Live "most asked" questions from anonymous signals, weighted toward the
 * current page. Falls back to an editorial default per page when there is no
 * data yet (or no storage), so the UI always has something sensible.
 */
import type { APIRoute } from 'astro';
import { trending } from '../../../lib/scout/signals';
import { INTENTS, intentById } from '../../../lib/scout/intents';

export const prerender = false;

const DEFAULTS: Record<string, string[]> = {
  '/weddings': ['availability', 'first_dance', 'ceremony', 'price'],
  '/corporate': ['availability', 'insurance', 'custom_song', 'sound'],
  '/estate': ['privacy', 'volume', 'availability', 'formats'],
  '/galas': ['availability', 'formats', 'sound', 'price'],
  '/destination': ['travel', 'availability', 'lead_time', 'price'],
  default: ['availability', 'music_style', 'formats', 'price'],
};

export const GET: APIRoute = async ({ url }) => {
  const page = url.searchParams.get('page') ?? undefined;
  const live = (await trending(14, page).catch(() => [])).filter((t) => t.count >= 3);
  const fallback = (DEFAULTS[page ?? ''] ?? DEFAULTS.default).map((id) => intentById.get(id)!).filter(Boolean);
  const seen = new Set<string>();
  const items = [...live.map((t) => ({ ...t, source: 'live' as const })), ...fallback.map((i) => ({ id: i.id, question: i.question, faq: i.faq, count: 0, source: 'default' as const }))]
    .filter((x) => !seen.has(x.id) && seen.add(x.id))
    .slice(0, 4);
  // FAQ ordering for the page: live counts per FAQ id.
  const faqRank = Object.fromEntries(live.filter((t) => t.faq).map((t) => [t.faq!, t.count]));
  return new Response(JSON.stringify({ items, faqRank, intents: INTENTS.length }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' },
  });
};
