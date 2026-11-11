/**
 * The key that signs Scout inquiry drafts: SCOUT_SIGNING_KEY (required in
 * production, where AI mode is off without it). Development without a key
 * uses a random per-process key, so drafts still round-trip locally.
 */
import { SCOUT_SIGNING_KEY } from 'astro:env/server';

let devKey: string | undefined;

export function draftSecret(): string | null {
  if (SCOUT_SIGNING_KEY) return SCOUT_SIGNING_KEY;
  if (!import.meta.env.DEV) return null;
  devKey ??= crypto.randomUUID() + crypto.randomUUID();
  return devKey;
}
