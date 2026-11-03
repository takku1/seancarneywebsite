/**
 * Anonymous demand signals: question intents, unmatched-question samples (gap
 * finder) and checked dates. No visitor IDs, no IPs, personal data scrubbed.
 *
 * Storage: Cloudflare KV binding SCOUT_KV when present (declare it in
 * wrangler.jsonc). Without it every call is a no-op and reads return empty,
 * so the site behaves exactly as before. KV is eventually consistent and
 * these are best-effort counters, which is fine for "most asked".
 */
import { intentById, intentByFaq, scrub } from './intents';
import { isoWeek } from '../analytics/retention';

interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

async function kv(): Promise<KV | null> {
  try {
    const mod = (await import('cloudflare:workers')) as { env?: Record<string, unknown> };
    return (mod.env?.SCOUT_KV as KV | undefined) ?? null;
  } catch {
    return null;
  }
}

const day = (d = new Date()) => d.toISOString().slice(0, 10);
const TTL = 60 * 60 * 24 * 120; // keep 120 days

const SAFE_FIELD = /^[a-z0-9][a-z0-9:._-]{0,79}$/i;

async function bump(store: KV, key: string, field: string, by = 1, ttl = TTL) {
  // Prototype-pollution safe: keys must match an allowlist (no leading underscores),
  // and counters live on a null-prototype object.
  if (!SAFE_FIELD.test(field)) return;
  const cur = Object.assign(Object.create(null), JSON.parse((await store.get(key)) ?? '{}')) as Record<string, number>;
  cur[field] = (cur[field] ?? 0) + by;
  await store.put(key, JSON.stringify(cur), { expirationTtl: ttl });
}

export async function recordQuestion(intents: string[], rawText: string, page?: string): Promise<void> {
  const store = await kv();
  if (!store) return;
  const key = `q:${day()}`;
  if (intents.length) {
    for (const id of intents) await bump(store, key, page ? `${id}@${page}` : id);
  } else if (rawText.trim().length > 8 && /\?|^(how|what|when|where|who|why|can|do|does|is|are|will|would)\b/i.test(rawText.trim())) {
    // Gap finder: keep a rolling sample of scrubbed, unmatched questions.
    const gk = `gaps:${day()}`;
    const list = JSON.parse((await store.get(gk)) ?? '[]') as string[];
    if (list.length < 100) {
      list.push(scrub(rawText));
      await store.put(gk, JSON.stringify(list), { expirationTtl: TTL });
    }
  }
}

/** Returns false once today's AI-turn budget is spent. No storage = no cap (rate limits still apply). */
export async function consumeDailyBudget(limit: number): Promise<boolean> {
  const store = await kv();
  if (!store || !limit) return true;
  const key = `usage:${day()}`;
  const n = Number((await store.get(key)) ?? 0) + 1;
  await store.put(key, String(n), { expirationTtl: 60 * 60 * 48 });
  return n <= limit;
}

/** Anonymous demand: which cities want shows, how many want merch. */
const COHORT = /^20\d{2}-W(0[1-9]|[1-4]\d|5[0-3])$/;
const RETENTION_TTL = 60 * 60 * 24 * 400; // a cohort's 12-week curve stays readable for over a year

/** Retention cohort beacon: one anonymous "+1" per visitor per week since their first visit. */
export async function recordVisit(cohort: string, week: number): Promise<void> {
  if (!COHORT.test(cohort) || !Number.isInteger(week) || week < 0 || week > 12) return;
  const store = await kv();
  if (!store) return;
  await bump(store, `ret:${cohort}`, `w${week}`, 1, RETENTION_TTL);
}

/** Cohort table for the last `weeks` first-visit weeks: size (w0) and % returning in each later week. */
async function retention(store: KV, weeks = 12) {
  const out: { cohort: string; size: number; returning: Record<string, number>; rate: Record<string, string> }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < weeks; i++) {
    const cohort = isoWeek(new Date(Date.now() - i * 7 * 864e5));
    if (seen.has(cohort)) continue;
    seen.add(cohort);
    const v = await store.get(`ret:${cohort}`);
    if (!v) continue;
    const counts = JSON.parse(v) as Record<string, number>;
    const size = counts.w0 ?? 0;
    const returning: Record<string, number> = {};
    const rate: Record<string, string> = {};
    for (let w = 1; w <= 12; w++) {
      const n = counts[`w${w}`];
      if (n === undefined) continue;
      returning[`w${w}`] = n;
      rate[`w${w}`] = size ? `${Math.round((n / size) * 1000) / 10}%` : 'n/a';
    }
    out.push({ cohort, size, returning, rate });
  }
  return out;
}

export async function recordFaqOpen(faqId: string, page?: string): Promise<void> {
  const intent = intentByFaq.get(faqId);
  if (!intent) return;
  const store = await kv();
  if (!store) return;
  await bump(store, `q:${day()}`, page ? `${intent.id}@${page}` : intent.id);
}

export async function recordDateCheck(date: string, status: string): Promise<void> {
  const store = await kv();
  if (!store || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  await bump(store, `dates:${date.slice(0, 7)}`, `${date}|${status}`);
}

async function lastDays<T>(store: KV, prefix: string, days: number, init: T, merge: (acc: T, v: string) => T): Promise<T> {
  let acc = init;
  const now = Date.now();
  const keys = Array.from({ length: days }, (_, i) => `${prefix}:${day(new Date(now - i * 86_400_000))}`);
  const values = await Promise.all(keys.map((k) => store.get(k)));
  for (const v of values) if (v) acc = merge(acc, v);
  return acc;
}

/** Intent counts over the window, optionally weighted toward a page. */
export async function trending(days = 14, page?: string): Promise<{ id: string; question: string; faq?: string; count: number }[]> {
  const store = await kv();
  if (!store) return [];
  const counts = await lastDays(store, 'q', days, {} as Record<string, number>, (acc, v) => {
    for (const [k, n] of Object.entries(JSON.parse(v) as Record<string, number>)) {
      const [id, p] = k.split('@');
      // Same-page asks count double so each page surfaces its own top questions.
      acc[id] = (acc[id] ?? 0) + n * (page && p === page ? 2 : 1);
    }
    return acc;
  });
  return Object.entries(counts)
    .map(([id, count]) => ({ id, count, question: intentById.get(id)?.question ?? id, faq: intentById.get(id)?.faq }))
    .filter((x) => intentById.has(x.id))
    .sort((a, b) => b.count - a.count);
}

export async function insights(days = 30) {
  const store = await kv();
  if (!store) return { connected: false };
  const gaps = await lastDays(store, 'gaps', days, [] as string[], (acc, v) => acc.concat(JSON.parse(v) as string[]));
  const months = [...new Set(Array.from({ length: 13 }, (_, i) => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + i - 1); return d.toISOString().slice(0, 7); }))];
  const dateDemand: Record<string, number> = {};
  for (const m of months) {
    const v = await store.get(`dates:${m}`);
    if (!v) continue;
    for (const [k, n] of Object.entries(JSON.parse(v) as Record<string, number>)) {
      const [date] = k.split('|');
      dateDemand[date] = (dateDemand[date] ?? 0) + n;
    }
  }
  return {
    connected: true,
    topQuestions: (await trending(days)).slice(0, 15),
    gaps: gaps.slice(-100).reverse(),
    // Week-N retention by first-visit week. size = new visitors that week; rate.wN = share seen again N weeks later.
    retention: await retention(store),
    hotDates: Object.entries(dateDemand).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([date, checks]) => ({ date, checks })),
  };
}
