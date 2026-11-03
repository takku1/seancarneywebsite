/**
 * GET /api/availability?date=YYYY-MM-DD
 * -> { ok, status: 'open' | 'busy' | 'unknown' }
 *
 * Reads Sean's Google Calendar(s) via free/busy only. Never returns event
 * details. Answers are indicative ("looks open"), never a confirmed hold.
 * Without credentials it returns 'unknown' and the form simply stays quiet.
 */
import type { APIRoute } from 'astro';
import { GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY, GOOGLE_CALENDAR_IDS, AVAILABILITY_TIMEZONE } from 'astro:env/server';
import { checkDay } from '../../lib/integrations/google-calendar';
import { recordDateCheck } from '../../lib/scout/signals';

export const prerender = false;

const json = (body: unknown, maxAge = 0) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json', 'cache-control': maxAge ? `public, max-age=${maxAge}` : 'no-store' },
  });

export const GET: APIRoute = async ({ url }) => {
  const date = url.searchParams.get('date') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ ok: false, error: 'bad_date' });

  const today = new Date().toISOString().slice(0, 10);
  if (date < today) return json({ ok: true, status: 'past' });

  if (!GOOGLE_SA_EMAIL || !GOOGLE_SA_PRIVATE_KEY || !GOOGLE_CALENDAR_IDS) return json({ ok: true, status: 'unknown' });

  try {
    const day = await checkDay({
      date,
      calendarIds: GOOGLE_CALENDAR_IDS.split(',').map((s) => s.trim()).filter(Boolean),
      clientEmail: GOOGLE_SA_EMAIL,
      privateKey: GOOGLE_SA_PRIVATE_KEY,
      timeZone: AVAILABILITY_TIMEZONE || 'America/Los_Angeles',
    });
    void recordDateCheck(date, day.status).catch(() => undefined);
    // Short edge cache: repeated checks for popular dates stay fast and cheap.
    return json({ ok: true, status: day.status }, 300);
  } catch (err) {
    console.warn('[availability]', (err as Error).message);
    return json({ ok: true, status: 'unknown' });
  }
};
