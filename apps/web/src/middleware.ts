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
 * Rate limiting uses the Cloudflare Rate Limiting bindings `RATE_LIMITER_STRICT` /
 * `RATE_LIMITER` (wrangler.jsonc) in production, otherwise a per-isolate counter. Also add a
 * Cloudflare WAF rate rule on /api/* in production.
 */
import { defineMiddleware } from 'astro:middleware';
import { clientKey, logSecurity } from './lib/security/log';
import { exceeds } from './lib/security/body';
import { requireAuth } from './lib/security/auth';

interface RouteRule {
  methods: string[];
  /** Allowed request content types for bodies (prefix match). */
  types?: string[];
  limit: { max: number; windowSec: number };
  /** Which Cloudflare Rate Limiting binding enforces this route in production. */
  tier?: 'strict';
  /** Privileged route: requires the admin bearer token (404 otherwise, so it stays undiscoverable). */
  admin?: true;
  /** maxBodySize in bytes for POST bodies (default 16 KB). */
  maxBodySize?: number;
}

const JSON_ONLY = ['application/json'];
const RULES: [RegExp, RouteRule][] = [
  [/^\/api\/inquire$/, { methods: ['POST'], types: JSON_ONLY, tier: 'strict', limit: { max: 5, windowSec: 600 } }],
  [/^\/api\/scout$/, { methods: ['GET', 'POST'], types: JSON_ONLY, maxBodySize: 65536, limit: { max: 60, windowSec: 600 } }],
  [/^\/api\/scout\/trending$/, { methods: ['GET'], limit: { max: 60, windowSec: 600 } }],
  [/^\/api\/scout\/insights$/, { methods: ['GET'], tier: 'strict', admin: true, limit: { max: 10, windowSec: 600 } }],
  [/^\/api\/leads$/, { methods: ['GET', 'POST'], tier: 'strict', admin: true, limit: { max: 10, windowSec: 600 } }],
  [/^\/api\/availability$/, { methods: ['GET'], limit: { max: 30, windowSec: 600 } }],
  // sendBeacon posts text/plain; browsers post CSP reports as application/csp-report or reports+json.
  [/^\/api\/signal$/, { methods: ['POST'], types: ['text/plain', 'application/json'], maxBodySize: 4096, limit: { max: 60, windowSec: 600 } }],
  [/^\/api\/csp-report$/, { methods: ['POST'], types: ['application/csp-report', 'application/reports+json', 'application/json'], limit: { max: 30, windowSec: 600 } }],
];

const memory = new Map<string, { n: number; reset: number }>();

async function allowed(key: string, rule: RouteRule): Promise<boolean> {
  try {
    const mod = (await import('cloudflare:workers')) as { env?: Record<string, unknown> };
    const rl = mod.env?.[rule.tier === 'strict' ? 'RATE_LIMITER_STRICT' : 'RATE_LIMITER'] as { limit(o: { key: string }): Promise<{ success: boolean }> } | undefined;
    if (rl) return (await rl.limit({ key })).success;
  } catch {
    /* not on Workers (dev/build): fall through to memory */
  }
  const now = Date.now();
  const h = memory.get(key);
  if (!h || h.reset < now) {
    memory.set(key, { n: 1, reset: now + rule.limit.windowSec * 1000 });
    if (memory.size > 5000) memory.clear(); // bound memory per isolate
    return true;
  }
  h.n++;
  return h.n <= rule.limit.max;
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
    if (origin && hostOf(origin) !== url.host) {
      logSecurity('origin_rejected', { route: url.pathname, origin, who });
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
    return problem(429, 'rate_limited', { 'retry-after': String(rule.limit.windowSec) });
  }

  try {
    return await next();
  } catch (err) {
    return handleError(err, url.pathname, who);
  }
});

/** Last-resort handler (ASVS 16.5.4): log it, return a generic response, never a stack trace. */
function handleError(err: unknown, route: string, who: string): Response {
  logSecurity('unhandled_error', { route, message: err instanceof Error ? err.message : String(err), who });
  return problem(500, 'server_error');
}

/** Host of an Origin header; "null" or malformed origins yield '' (rejected as cross-origin). */
function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return '';
  }
}
