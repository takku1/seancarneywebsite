/**
 * Picks Scout's AI backend from env. No backend configured means guided mode:
 * the panel still works with scripted flows (date check, music, FAQ, inquiry).
 *
 *   SCOUT_PROVIDER=anthropic + ANTHROPIC_API_KEY (+ optional SCOUT_MODEL)
 *
 * To add another backend: implement ScoutProvider (providers/types.ts) and add
 * a case below. The UI, tools, knowledge and analytics do not change.
 */
import { SCOUT_PROVIDER, ANTHROPIC_API_KEY, SCOUT_MODEL } from 'astro:env/server';
import type { ScoutProvider } from './providers/types';
import { createAnthropicProvider } from './providers/anthropic';

let provider: ScoutProvider | null | undefined;

export function getScoutProvider(): ScoutProvider | null {
  if (provider !== undefined) return provider;
  const choice = (SCOUT_PROVIDER || (ANTHROPIC_API_KEY ? 'anthropic' : 'none')).toLowerCase();
  switch (choice) {
    case 'anthropic':
      provider = ANTHROPIC_API_KEY ? createAnthropicProvider(ANTHROPIC_API_KEY, SCOUT_MODEL || 'claude-opus-5-5') : null;
      break;
    default:
      provider = null;
  }
  return provider;
}
