/**
 * POST /api/scout/inquire   { "token": "<signed draft>" }
 *
 * The visitor's Send click on an inquiry Scout prepared. The model can only
 * prepare a draft (lib/scout/draft.ts); this route, reached by a click in the
 * chat panel, is the only way a Scout inquiry becomes a lead. The draft's
 * signature proves it came from this server unchanged; it is re-validated,
 * then submitted with its stable idempotency key, so repeated clicks or
 * retries create one lead. Middleware: same-origin required, strict tier.
 */
import type { APIRoute } from 'astro';
import { inquirySchema } from '../../../lib/inquiry/schema';
import { processInquiry } from '../../../lib/inquiry/process';
import { verifyDraft } from '../../../lib/scout/draft';
import { draftSecret } from '../../../lib/scout/draft-secret';
import { logSecurity } from '../../../lib/security/log';

export const prerender = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export const POST: APIRoute = async ({ request, locals }) => {
  const secret = draftSecret();
  if (!secret) return json(503, { ok: false, error: 'unavailable' });

  let token: unknown;
  try {
    token = ((await request.json()) as { token?: unknown }).token;
  } catch {
    return json(400, { ok: false, error: 'invalid_json' });
  }

  const draft = await verifyDraft(token, secret);
  if (!draft.ok) {
    if (draft.error !== 'expired') logSecurity('bad_signature', { route: '/api/scout/inquire', reason: draft.error });
    return json(draft.error === 'expired' ? 410 : 400, { ok: false, error: draft.error });
  }
  const parsed = inquirySchema.safeParse(draft.inquiry);
  if (!parsed.success) return json(422, { ok: false, error: 'validation' });

  const cf = (locals as { cfContext?: { waitUntil(p: Promise<unknown>): void } }).cfContext;
  const { accepted, leadId, tier } = await processInquiry(parsed.data, 'scout', {
    defer: cf ? (p) => cf.waitUntil(p) : undefined,
    idempotencyKey: draft.key,
  });
  if (!accepted) return json(503, { ok: false, error: 'delivery_failed' });
  return json(200, { ok: true, leadId, tier });
};

export const ALL: APIRoute = () => json(405, { ok: false, error: 'method_not_allowed' });
