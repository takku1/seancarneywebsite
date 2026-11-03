/**
 * POST /api/csp-report: Content-Security-Policy violation reports (ASVS 3.4.7).
 * Accepts both the legacy report-uri format and the Reporting API format.
 * Logged as structured security events; no visitor data is stored.
 */
import type { APIRoute } from 'astro';
import { logSecurity } from '../../lib/security/log';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const raw = JSON.parse((await request.text()).slice(0, 20_000)) as unknown;
    const reports = Array.isArray(raw) ? raw.map((r) => (r as { body?: unknown }).body ?? r) : [(raw as { 'csp-report'?: unknown })['csp-report'] ?? raw];
    for (const r of reports.slice(0, 10) as Record<string, unknown>[]) {
      logSecurity('csp_violation', {
        directive: String(r['effective-directive'] ?? r.effectiveDirective ?? r['violated-directive'] ?? ''),
        blocked: String(r['blocked-uri'] ?? r.blockedURL ?? ''),
        page: String(r['document-uri'] ?? r.documentURL ?? '').split('?')[0],
        disposition: String(r.disposition ?? 'report'),
      });
    }
  } catch {
    /* malformed report: ignore */
  }
  return new Response(null, { status: 204 });
};
