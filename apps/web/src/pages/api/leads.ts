/**
 * Lead reconciliation   (header: authorization: Bearer <SCOUT_ADMIN_TOKEN>)
 *
 *   GET  /api/leads[?cursor=&limit=]   open leads (CRM not yet taken, or Sean not yet
 *                                      notified) and per-state counts; no personal data
 *   POST /api/leads                    one retry batch; body (optional JSON):
 *                                      { "limit": 25, "reopen": true }
 *                                      reopen puts abandoned deliveries back in the queue.
 *                                      Repeat until "processed" is 0; a lead is retried at
 *                                      most once per 10 minutes, so each call reaches new ones.
 *
 * The same retry runs on a cron every 15 minutes (src/worker.ts).
 * Auth: the admin gate in src/middleware.ts (requireAuth) runs before this handler.
 */
import type { APIRoute } from 'astro';
import { openLeads, retryOpenLeads } from '../../lib/inquiry/process';

export const prerender = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const num = (v: unknown) => (typeof v === 'number' || typeof v === 'string') && Number.isFinite(Number(v)) ? Number(v) : undefined;
const cursorOf = (v: unknown) => (typeof v === 'string' && v.length <= 200 ? v : null);

export const GET: APIRoute = async ({ url }) => {
  const page = await openLeads({ limit: num(url.searchParams.get('limit')), cursor: cursorOf(url.searchParams.get('cursor')) });
  return page ? json(200, page) : json(503, { ok: false, error: 'lead_store_unavailable' });
};

export const POST: APIRoute = async ({ request }) => {
  let body: Record<string, unknown> = {};
  try {
    const text = await request.text();
    if (text.trim()) body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return json(400, { ok: false, error: 'invalid_json' });
  }
  return json(200, await retryOpenLeads({ limit: num(body.limit), reopen: body.reopen === true }));
};
