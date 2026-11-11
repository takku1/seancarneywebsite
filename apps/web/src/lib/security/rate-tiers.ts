/**
 * The API rate-limit policy: two tiers, each enforced in production by a
 * Cloudflare Rate Limiting binding declared in wrangler.jsonc. Cloudflare only
 * allows 10- or 60-second periods, so these numbers ARE the production limits;
 * the per-isolate fallback in src/middleware.ts (local dev) uses the same ones.
 * evals/rate-tiers.test.mjs fails if wrangler.jsonc and this file disagree.
 *
 * Keys are per route plus a pseudonymous client key, so each route has its own budget.
 */
export type RateTier = 'strict' | 'standard';

export const RATE_TIERS: Record<RateTier, { binding: string; max: number; periodSec: 10 | 60 }> = {
  /** Lead submission and admin routes: a person sends one inquiry, not three a minute. */
  strict: { binding: 'RATE_LIMITER_STRICT', max: 3, periodSec: 60 },
  /** Chat, date checks, beacons and reports. */
  standard: { binding: 'RATE_LIMITER', max: 20, periodSec: 60 },
};
