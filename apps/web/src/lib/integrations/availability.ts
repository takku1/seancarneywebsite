/**
 * Date availability, shared by GET /api/availability and Scout's
 * check_availability tool, so both answer the same way.
 *
 * Indicative only ("looks open"); Sean confirms every date personally.
 * States: open | tentative | busy | unknown | past (see DayState in
 * google-calendar.ts). "Past" uses today's date in AVAILABILITY_TIMEZONE, not
 * UTC, so a Pacific visitor's "today" is never reported as past in the evening.
 */
import { GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY, GOOGLE_CALENDAR_IDS, GOOGLE_HOLD_CALENDAR_IDS, AVAILABILITY_TIMEZONE } from 'astro:env/server';
import { checkDay, todayIn, type DayState } from './google-calendar';
import { errorCode } from '../security/errors';

export type Availability = DayState | 'past';

const ids = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export async function availabilityFor(date: string): Promise<Availability> {
  const timeZone = AVAILABILITY_TIMEZONE || 'America/Los_Angeles';
  if (date < todayIn(timeZone)) return 'past';
  const calendarIds = ids(GOOGLE_CALENDAR_IDS);
  const holdCalendarIds = ids(GOOGLE_HOLD_CALENDAR_IDS);
  if (!GOOGLE_SA_EMAIL || !GOOGLE_SA_PRIVATE_KEY || (!calendarIds.length && !holdCalendarIds.length)) return 'unknown';
  try {
    const day = await checkDay({ date, calendarIds, holdCalendarIds, clientEmail: GOOGLE_SA_EMAIL, privateKey: GOOGLE_SA_PRIVATE_KEY, timeZone });
    if (day.status === 'unknown') console.warn(JSON.stringify({ ts: new Date().toISOString(), kind: 'config', event: 'availability_calendar_error' }));
    return day.status;
  } catch (e) {
    console.warn(JSON.stringify({ ts: new Date().toISOString(), kind: 'config', event: 'availability_failed', error: errorCode(e) }));
    return 'unknown';
  }
}
