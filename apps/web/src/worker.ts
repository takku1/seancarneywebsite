/**
 * Worker entry (wrangler.jsonc "main"). Astro's handler serves every request;
 * the cron trigger retries lead deliveries that have not completed yet.
 */
import astro from '@astrojs/cloudflare/entrypoints/server';
import { retryOpenLeads } from './lib/inquiry/process';

interface Ctx { waitUntil(p: Promise<unknown>): void }

export default {
  fetch: astro.fetch,
  async scheduled(_controller: unknown, _env: unknown, ctx: Ctx) {
    ctx.waitUntil(
      (async () => {
        // Bounded: up to 4 batches of 25 per run; the rest waits for the next run.
        let cursor: string | null = null;
        for (let i = 0; i < 4; i++) {
          const r = await retryOpenLeads({ cursor, limit: 25 });
          if (r.processed) console.info(JSON.stringify({ ts: new Date().toISOString(), kind: 'lead', event: 'lead_retry_batch', ...r }));
          cursor = r.nextCursor;
          if (!cursor) break;
        }
      })().catch((e) => console.error(JSON.stringify({ ts: new Date().toISOString(), kind: 'lead', event: 'lead_retry_crashed', error: String(e).slice(0, 160) }))),
    );
  },
};
