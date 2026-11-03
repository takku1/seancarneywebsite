/**
 * Scout chat endpoint.
 *   GET  /api/scout          -> { mode: 'ai' | 'guided' }
 *   POST /api/scout          -> one conversational turn (AI mode)
 *
 * Guardrails: message length cap, transcript size cap, per-isolate rate limit
 * (add a Cloudflare WAF rate-limit rule on /api/scout for production), turn
 * cap per conversation, and graceful degradation to guided mode on any error.
 */
import type { APIRoute } from 'astro';
import { getScoutProvider } from '../../lib/scout';
import { matchIntents } from '../../lib/scout/intents';
import { recordQuestion, recordDateCheck, consumeDailyBudget } from '../../lib/scout/signals';
import { SCOUT_SIGNING_KEY, SCOUT_DAILY_LIMIT } from 'astro:env/server';
import { signTranscript, verifyTranscript, visitorText } from '../../lib/scout/integrity';
import { logSecurity } from '../../lib/security/log';

export const prerender = false;

const MAX_TEXT = 1000;
const MAX_TRANSCRIPT_BYTES = 150_000;
const MAX_USER_TURNS = 20;
const RATE = { windowMs: 10 * 60_000, max: 40 };
const hits = new Map<string, { n: number; reset: number }>();

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

function limited(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || h.reset < now) {
    hits.set(ip, { n: 1, reset: now + RATE.windowMs });
    return false;
  }
  h.n++;
  return h.n > RATE.max;
}

export const GET: APIRoute = () => {
  const p = getScoutProvider();
  return json(200, { mode: p ? 'ai' : 'guided' });
};

export const POST: APIRoute = async ({ request }) => {
  const provider = getScoutProvider();
  if (!provider) return json(200, { ok: false, mode: 'guided' });

  const ip = request.headers.get('cf-connecting-ip') ?? 'local';
  if (limited(ip)) return json(429, { ok: false, error: 'rate_limited', reply: "I'm getting a lot of questions at once. Give it a minute, or send the details through the inquiry form." });

  let body: { text?: unknown; transcript?: unknown; page?: unknown; attribution?: unknown; experiments?: unknown; newContext?: unknown; twang?: unknown };
  try {
    body = await request.json();
  } catch {
    return json(400, { ok: false, error: 'invalid_json' });
  }

  const text = String(body.text ?? '').trim().slice(0, MAX_TEXT);
  if (!text) return json(400, { ok: false, error: 'empty' });
  const transcript = Array.isArray(body.transcript) ? body.transcript : [];
  // Integrity (OWASP LLM01 / ASI06): the browser holds the transcript, so it is
  // HMAC-signed. A forged or edited history is discarded, never sent to the model.
  if (transcript.length && !(await verifyTranscript(transcript, typeof (body as { sig?: unknown }).sig === 'string' ? (body as { sig: string }).sig : '', SCOUT_SIGNING_KEY))) {
    logSecurity('bad_signature', { route: '/api/scout', turns: transcript.length });
    return json(200, { ok: false, error: 'bad_signature', reset: true, reply: "Let's start fresh. What can I help you with?" });
  }
  if (JSON.stringify(transcript).length > MAX_TRANSCRIPT_BYTES) return json(413, { ok: false, error: 'too_long', reset: true });
  const validRoles = transcript.every((m) => m && typeof m === 'object' && ['user', 'assistant'].includes((m as { role?: string }).role ?? ''));
  if (!validRoles) return json(400, { ok: false, error: 'bad_transcript', reset: true });
  // Visitor turns = user messages carrying text (tool-result messages don't count).
  const userTurns = transcript.filter((m) => {
    const { role, content } = m as { role: string; content: unknown };
    return role === 'user' && (typeof content === 'string' || (Array.isArray(content) && content.some((b) => (b as { type?: string }).type === 'text')));
  }).length;
  if (userTurns >= MAX_USER_TURNS) return json(200, { ok: true, reply: "We've covered a lot. Let's get this to Sean directly so he can take it from here.", cards: [], transcript, handoff: true });

  // The page path goes into the <context> tag, so it must be a plain site path:
  // anything else (quotes, angle brackets, spoofed attributes) falls back to undefined.
  const page = typeof body.page === 'string' && /^\/[a-z0-9/_-]{0,119}$/i.test(body.page) ? body.page : undefined;
  const asRecord = (v: unknown) => (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).slice(0, 40).map(([k, val]) => [k, String(val).slice(0, 200)])) : {});
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const twang = [0, 1, 2].includes(Number(body.twang)) ? Number(body.twang) : 1;
  const contextTag = transcript.length === 0 || body.newContext ? `<context today="${today}" page="${page ?? '/'}" twang="${twang}" />` : '';

  // Unbounded consumption (OWASP LLM10): daily cap on AI turns, then guided mode.
  if (!(await consumeDailyBudget(Number(SCOUT_DAILY_LIMIT || 1500)))) {
    return json(200, { ok: false, mode: 'guided', error: 'daily_limit', reply: "I'm in quick mode for the rest of today. These options still work." });
  }

  // Demand signals (anonymous, best-effort, never blocks the reply).
  const intents = matchIntents(text);
  const signal = recordQuestion(intents, text, page).catch(() => undefined);

  try {
    const out = await provider.run({ transcript, text, contextTag, tools: { attribution: asRecord(body.attribution), experiments: asRecord(body.experiments), page, visitorText: visitorText(transcript, text) } });
    for (const c of out.cards) if (c.kind === 'availability') void recordDateCheck(c.date, c.status).catch(() => undefined);
    await signal;
    const sig = await signTranscript(out.transcript, SCOUT_SIGNING_KEY);
    return json(200, { ok: true, reply: out.reply, cards: out.cards, transcript: out.transcript, sig, toolCalls: out.toolCalls, intents, handoff: out.stop === 'limit', model: provider.model });
  } catch (err) {
    console.warn('[scout]', (err as Error).message);
    await signal;
    return json(200, { ok: false, mode: 'guided', error: 'provider_error', reply: "I lost the trail for a second. You can keep going with the quick options below, or use the inquiry form." });
  }
};
