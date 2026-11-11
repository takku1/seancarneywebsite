/**
 * The one rule for whether Scout runs with AI. Both GET /api/scout (which the
 * panel asks before offering AI chat) and POST /api/scout use it, so the panel
 * never offers a mode the server will refuse.
 */
export type ScoutMode =
  | { mode: 'ai' }
  | { mode: 'guided'; reason: 'no_provider' | 'signing_key_missing' };

export function resolveScoutMode(o: { hasProvider: boolean; hasSigningKey: boolean; dev: boolean }): ScoutMode {
  if (!o.hasProvider) return { mode: 'guided', reason: 'no_provider' };
  // Browser-held history can't be trusted unsigned: production requires the key; development may run without.
  if (!o.hasSigningKey && !o.dev) return { mode: 'guided', reason: 'signing_key_missing' };
  return { mode: 'ai' };
}
