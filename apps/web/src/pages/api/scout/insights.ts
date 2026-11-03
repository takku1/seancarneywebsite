/**
 * GET /api/scout/insights   (header: authorization: Bearer <SCOUT_ADMIN_TOKEN>)
 * Sean's demand dashboard data: top questions (30 days), unanswered-question
 * samples (scrubbed), and the most-checked event dates.
 */
import type { APIRoute } from 'astro';
import { insights } from '../../../lib/scout/signals';

// Auth: the admin gate in src/middleware.ts (requireAuth) runs before this handler.
export const prerender = false;

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify(await insights(30), null, 2), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
};
