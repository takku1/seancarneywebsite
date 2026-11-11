/**
 * GET /api/availability?date=YYYY-MM-DD
 * -> { ok, status: 'open' | 'tentative' | 'busy' | 'unknown' | 'past' }
 *
 * Reads Sean's Google Calendar(s) via free/busy only. Never returns event
 * details. Answers are indicative ("looks open"), never a confirmed hold.
 * Without credentials, or when any calendar can't be read, it returns
 * 'unknown' and the form simply stays quiet. Rules: lib/integrations/availability.ts.
 */
import type { APIRoute } from 'astro';
import { availabilityFor } from '../../lib/integrations/availability';
import { recordDateCheck } from '../../lib/scout/signals';

export const prerender = false;

const json = (body: unknown, maxAge = 0) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json', 'cache-control': maxAge ? `public, max-age=${maxAge}` : 'no-store' },
  });

export const GET: APIRoute = async ({ url }) => {
  const date = url.searchParams.get('date') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return json({ ok: false, error: 'bad_date' });
  const status = await availabilityFor(date);
  if (status === 'past' || status === 'unknown') return json({ ok: true, status });
  void recordDateCheck(date, status).catch(() => undefined);
  // Short edge cache: repeated checks for popular dates stay fast and cheap.
  return json({ ok: true, status }, 300);
};
