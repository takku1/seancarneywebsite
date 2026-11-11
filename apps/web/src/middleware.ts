/**
 * API security middleware (runs on the Worker for on-demand /api/* routes;
 * prerendered pages are untouched). Implements, per route:
 *   - HTTP method allowlist, 405 otherwise              (ASVS 4.1.4)
 *   - same-origin check on state-changing requests      (ASVS 3.5.1, CSRF)
 *   - Content-Type allowlist                            (ASVS 3.5.1, 4.1.1)
 *   - per-client rate limits                            (ASVS 2.4.1, OWASP LLM10)
 *   - last-resort error handler, generic response       (ASVS 16.5.1, 16.5.4, OWASP A10)
 *   - structured security event logging                 (ASVS 16.3.3)
 *
 * Rate limiting: each route has a tier (lib/security/rate-tiers.ts: strict 3/min,
 * standard 20/min), enforced by the matching Cloudflare Rate Limiting binding in
 * production and by a per-isolate counter with the same numbers elsewhere. Also
 * add a Cloudflare WAF rate rule on /api/* in production.
 */
import { defineMiddleware } from 'astro:middleware';
import { clientKey, logSecurity } from './lib/security/log';
import { exceeds } from './lib/security/body';
import { requireAuth } from './lib/security/auth';
import { checkOrigin, type OriginPolicy } from './lib/security/origin';
import { errorCode } from './lib/security/errors';
import { RATE_TIERS, type RateTier } from './lib/security/rate-tiers';

interface RouteRule {
  methods: string[];
  /** Allowed request content types for bodies (prefix match). */
  types?: string[];
  /** Rate-limit tier (lib/security/rate-tiers.ts). */
  tier: RateTier;
  /** Privileged route: requires the admin bearer token (404 otherwise, so it stays undiscoverable). */
  admin?: true;
  /** maxBodySize in bytes for POST bodies (default 16 KB). */
  maxBodySize?: number;
  /** POST Origin policy (lib/security/origin.ts); default 'if-present'. Browser-only routes use 'required'. */
  origin?: OriginPolicy;
}

const JSON_ONLY = ['application/json'];
const RULES: [RegExp, RouteRule][] = [
  [/^\/api\/inquire$/, { methods: ['POST'], types: JSON_ONLY, origin: 'required', tier: 'strict' }],
  [/^\/api\/scout$/, { methods: ['GET', 'POST'], types: JSON_ONLY, origin: 'required', maxBodySize: 65536, tier: 'standard' }],
  // The visitor's Send click on a Scout-prepared inquiry: browser-only, and it creates a lead.
  [/^\/api\/scout\/inquire$/, { methods: ['POST'], types: JSON_ONLY, origin: 'required', maxBodySize: 32768, tier: 'strict' }],
  [/^\/api\/scout\/trending$/, { methods: ['GET'], tier: 'standard' }],
  [/^\/api\/scout\/insights$/, { methods: ['GET'], tier: 'strict', admin: true }],
  [/^\/api\/leads$/, { methods: ['GET', 'POST'], tier: 'strict', admin: true }],
  [/^\/api\/availability$/, { methods: ['GET'], tier: 'standard' }],
  // sendBeacon posts text/plain; browsers post CSP reports as application/csp-report or reports+json.
  [/^\/api\/signal$/, { methods: ['POST'], types: ['text/plain', 'application/json'], maxBodySize: 4096, tier: 'standard' }],
  [/^\/api\/csp-report$/, { methods: ['POST'], types: ['application/csp-report', 'application/reports+json', 'application/json'], tier: 'standard' }],
];

const memory = new Map<string, { n: number; reset: number }>();

let lastLimiterAlert = 0;
/** Alert-level config log, at most once a minute per isolate. */
function limiterAlert(event: 'rate_limiter_unbound' | 'rate_limiter_error', binding: string, code?: string) {
  if (Date.now() - lastLimiterAlert < 60_000) return;
  lastLimiterAlert = Date.now();
  console.error(JSON.stringify({ ts: new Date().toISOString(), kind: 'config', event, binding, ...(code ? { error: code } : {}) }));
}

/**
 * Production uses the tier's Cloudflare binding (a global limit). If it is
 * missing or errors, requests fall back to a per-isolate counter with the
 * same numbers and an alert is logged. Deliberately not fail-closed: for the
 * inquiry route that would turn real leads away during a platform outage,
 * while Turnstile, the honeypot and timing checks still apply.
 */
async function allowed(key: string, rule: RouteRule): Promise<boolean> {
  const { binding } = RATE_TIERS[rule.tier];
  let rl: { limit(o: { key: string }): Promise<{ success: boolean }> } | undefined;
  try {
    const mod = (await import('cloudflare:workers')) as { env?: Record<string, unknown> };
    rl = mod.env?.[binding] as typeof rl;
  } catch {
    /* not on Workers (build tooling): fall through to memory */
  }
  if (rl) {
    try {
      return (await rl.limit({ key })).success;
    } catch (e) {
      limiterAlert('rate_limiter_error', binding, errorCode(e));
    }
  } else if (!import.meta.env.DEV) {
    limiterAlert('rate_limiter_unbound', binding);
  }
  const now = Date.now();
  const h = memory.get(key);
  if (!h || h.reset < now) {
    memory.set(key, { n: 1, reset: now + RATE_TIERS[rule.tier].periodSec * 1000 });
    if (memory.size > 5000) memory.clear(); // bound memory per isolate
    return true;
  }
  h.n++;
  return h.n <= RATE_TIERS[rule.tier].max;
}

const DEFAULT_MAX_BODY = 16 * 1024;

const problem = (status: number, error: string, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify({ ok: false, error }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);
  if (!url.pathname.startsWith('/api/')) return next();

  const entry = RULES.find(([re]) => re.test(url.pathname));
  if (!entry) return next(); // unknown API path: let routing 404
  const [, rule] = entry;
  const req = context.request;
  const method = req.method.toUpperCase();
  const ip = req.headers.get('cf-connecting-ip');
  const who = await clientKey(ip);

  if (method === 'OPTIONS' || !rule.methods.includes(method)) {
    logSecurity('method_rejected', { route: url.pathname, method, who });
    return problem(405, 'method_not_allowed', { allow: rule.methods.join(', ') });
  }

  if (method === 'POST') {
    const origin = req.headers.get('origin');
    const verdict = checkOrigin(origin, url.origin, rule.origin ?? 'if-present');
    if (verdict !== 'ok') {
      logSecurity('origin_rejected', { route: url.pathname, origin: origin ?? '(none)', reason: verdict, who });
      return problem(403, 'forbidden');
    }
    const type = (req.headers.get('content-type') ?? '').toLowerCase();
    if (rule.types && !rule.types.some((t) => type.startsWith(t))) {
      logSecurity('content_type_rejected', { route: url.pathname, type, who });
      return problem(415, 'unsupported_media_type');
    }
    // Bound request size before any handler reads the body (OWASP API4).
    // A declared length is checked up front; an undeclared (streamed) body is
    // measured on a copy, stopping as soon as it passes the limit.
    const max = rule.maxBodySize ?? DEFAULT_MAX_BODY;
    const length = req.headers.get('content-length');
    const tooLarge = length !== null ? !(Number(length) <= max) : await exceeds(req, max);
    if (tooLarge) {
      logSecurity('body_too_large', { route: url.pathname, bytes: length ?? 'streamed', who });
      return problem(413, 'payload_too_large');
    }
  }

  if (rule.admin && !requireAuth(req)) {
    if (req.headers.has('authorization')) logSecurity('auth_failed', { route: url.pathname, who });
    return new Response('Not found', { status: 404 });
  }

  // Cloudflare always sets cf-connecting-ip in production; without it (local dev)
  // every request would share one bucket, so limits apply only when it's present.
  if (ip && !(await allowed(`${url.pathname}:${who}`, rule))) {
    logSecurity('rate_limited', { route: url.pathname, who });
    return problem(429, 'rate_limited', { 'retry-after': String(RATE_TIERS[rule.tier].periodSec) });
  }

  try {
    return await next();
  } catch (err) {
    return handleError(err, url.pathname, who);
  }
});

/** Last-resort handler (ASVS 16.5.4): log it, return a generic response, never a stack trace. */
function handleError(err: unknown, route: string, who: string): Response {
  logSecurity('unhandled_error', { route, code: errorCode(err), who });
  return problem(500, 'server_error');
}
