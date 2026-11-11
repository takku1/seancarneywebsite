/**
 * Worker entry (wrangler.jsonc "main"). Astro's handler serves every request;
 * the cron trigger applies lead retention and retries deliveries that have not completed yet.
 */
import astro from '@astrojs/cloudflare/entrypoints/server';
import { purgeLeads, retryOpenLeads } from './lib/inquiry/process';
import { errorCode } from './lib/security/errors';

interface Ctx { waitUntil(p: Promise<unknown>): void }

export default {
  fetch: astro.fetch,
  async scheduled(_controller: unknown, _env: unknown, ctx: Ctx) {
    ctx.waitUntil(
      (async () => {
        await purgeLeads(); // retention: resolved at 90 days, unresolved at 180
        // Bounded: up to 4 batches of 25 per run, least recently attempted first;
        // the rest waits for the next run (no cursor state between runs).
        for (let i = 0; i < 4; i++) {
          const r = await retryOpenLeads({ limit: 25 });
          if (!r.processed) break;
          console.info(JSON.stringify({ ts: new Date().toISOString(), kind: 'lead', event: 'lead_retry_batch', ...r }));
        }
      })().catch((e) => console.error(JSON.stringify({ ts: new Date().toISOString(), kind: 'lead', event: 'lead_retry_crashed', error: errorCode(e) }))),
    );
  },
};
