/**
 * First-party retention, no identifiers.
 *
 * The browser keeps a tiny visit record (first visit date, last visit time,
 * visit count) in the `sc_` namespace, cleared by the /privacy "Clear data"
 * control like everything else. From it:
 *  - every analytics event carries visitor_type (new | returning) and
 *    visit_bucket (1 | 2 | 3-5 | 6+), so any metric splits by loyalty;
 *  - once per visitor per week, an anonymous beacon adds 1 to the cohort
 *    table ret:<first-visit ISO week>.w<weeks since first visit> in KV.
 *    w0 is the cohort's size; wN / w0 is week-N retention. No ID, IP or
 *    page is sent, only "2026-W45" and a number.
 *  - previousVisit() powers "New since your last visit".
 */
import { getItem, setItem } from '../storage';

interface VisitRecord { first: string; last: string; n: number; reported: number[] }
interface SessionInfo { visitor_type: 'new' | 'returning'; visit_n: number; visit_bucket: string; prev?: string; days_since_last?: number }

const REC = 'visits';
const SES = 'visit_session';
const MAX_WEEK = 12;

function read<T>(key: string, where: 'local' | 'session'): T | null {
  try {
    const v = getItem(key, where);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

/** ISO-8601 week label, e.g. "2026-W45". */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 864e5 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const bucket = (n: number) => (n <= 1 ? '1' : n === 2 ? '2' : n <= 5 ? '3-5' : '6+');

/** Call once per page load. Starts a visit when this tab has no session yet (started: true). */
export function startVisit(): (SessionInfo & { started: boolean }) | null {
  const existing = read<SessionInfo>(SES, 'session');
  if (existing) return { ...existing, started: false };

  const now = new Date();
  const rec = read<VisitRecord>(REC, 'local');
  const next: VisitRecord = rec
    ? { ...rec, last: now.toISOString(), n: rec.n + 1, reported: rec.reported ?? [] }
    : { first: now.toISOString().slice(0, 10), last: now.toISOString(), n: 1, reported: [] };

  const info: SessionInfo = {
    visitor_type: rec ? 'returning' : 'new',
    visit_n: next.n,
    visit_bucket: bucket(next.n),
    ...(rec ? { prev: rec.last, days_since_last: Math.floor((now.getTime() - Date.parse(rec.last)) / 864e5) } : {}),
  };

  // Cohort beacon: once per visitor per week since first visit.
  const week = Math.floor((now.getTime() - Date.parse(next.first)) / (7 * 864e5));
  const report = week >= 0 && week <= MAX_WEEK && !next.reported.includes(week);
  if (report) next.reported = [...next.reported, week].slice(-MAX_WEEK - 1);

  setItem(REC, JSON.stringify(next), 'local');
  setItem(SES, JSON.stringify(info), 'session');
  // Storage blocked (some private modes): no stable record, so count nothing rather than over-count.
  if (!read<SessionInfo>(SES, 'session') || !read<VisitRecord>(REC, 'local')) return null;

  if (report) {
    try {
      navigator.sendBeacon?.('/api/signal', JSON.stringify({ type: 'visit', cohort: isoWeek(new Date(next.first)), week }));
    } catch {
      /* best effort */
    }
  }
  return { ...info, started: true };
}

/** Props merged into every analytics event. */
export function retentionProps(): Record<string, string> {
  const s = read<SessionInfo>(SES, 'session');
  return s ? { visitor_type: s.visitor_type, visit_bucket: s.visit_bucket } : {};
}

/** When this visitor was last here before the current visit (undefined on a first visit). */
export function previousVisit(): Date | undefined {
  const s = read<SessionInfo>(SES, 'session');
  return s?.prev ? new Date(s.prev) : undefined;
}
