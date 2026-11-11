/**
 * Transcript integrity. The conversation history lives in the visitor's tab
 * (no server-side chat storage), so the server signs each transcript it returns
 * and refuses any history it didn't sign. This stops forged assistant turns or
 * fake tool results from being replayed into the model (prompt injection via
 * history, OWASP LLM01; memory poisoning, OWASP ASI06).
 *
 * SCOUT_SIGNING_KEY: any long random string (e.g. `openssl rand -hex 32`).
 * Required in production: without it /api/scout serves guided mode only (no
 * AI). In development, signing is skipped and a warning is logged once;
 * `verifyTranscript` accepts unsigned history only when told it is development.
 */
let warned = false;
const enc = new TextEncoder();

async function hmac(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signTranscript(transcript: unknown[], key?: string): Promise<string | undefined> {
  if (!key) {
    if (!warned) console.warn('[scout] SCOUT_SIGNING_KEY not set: transcripts are unsigned (dev only).');
    warned = true;
    return undefined;
  }
  return hmac(key, JSON.stringify(transcript));
}

export async function verifyTranscript(transcript: unknown[], sig: string, key?: string, opts: { allowUnsigned?: boolean } = {}): Promise<boolean> {
  if (!key) return opts.allowUnsigned === true; // fail closed unless explicitly development
  if (!sig || sig.length !== 64) return false;
  const expected = await hmac(key, JSON.stringify(transcript));
  // Constant-time comparison.
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

/** Text the visitor typed (not assistant output, not tool results). */
export function visitorText(transcript: unknown[], current: string): string {
  const parts: string[] = [current];
  for (const m of transcript as { role?: string; content?: unknown }[]) {
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') parts.push(m.content);
    else if (Array.isArray(m.content)) for (const b of m.content as { type?: string; text?: string }[]) if (b.type === 'text' && b.text && !b.text.startsWith('<context')) parts.push(b.text);
  }
  return parts.join('\n');
}
