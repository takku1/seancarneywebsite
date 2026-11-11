/**
 * Lead reconciliation   (header: authorization: Bearer <SCOUT_ADMIN_TOKEN>)
 *
 *   GET  /api/leads   leads the CRM has not taken yet (IDs, times, outcomes; no personal data)
 *   POST /api/leads   re-send those leads to the CRM, e.g. once SHA-BAM is connected
 *
 * Auth: the admin gate in src/middleware.ts (requireAuth) runs before this handler.
 */
import type { APIRoute } from 'astro';
import { pendingLeads, retryPendingLeads } from '../../lib/inquiry/process';

export const prerender = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export const GET: APIRoute = async () => {
  const pending = await pendingLeads();
  return pending ? json(200, { pending }) : json(503, { ok: false, error: 'lead_store_unavailable' });
};

export const POST: APIRoute = async () => json(200, await retryPendingLeads());
