import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';

/**
 * Scout's submit_inquiry tool through the real pipeline (tools → process →
 * deliver), with Astro/Cloudflare virtual modules stubbed and D1 backed by
 * real SQLite. Guards the request-scoped background delivery: a stalled CRM
 * must not hold Scout's reply.
 */
const stubs = {
  name: 'stubs',
  setup(b) {
    b.onResolve({filter: /^(astro:env\/server|cloudflare:workers|astro:content)$/}, (a) => ({path: a.path, namespace: 'stub'}));
    b.onLoad({filter: /.*/, namespace: 'stub'}, (a) => ({
      contents: a.path === 'cloudflare:workers' ? 'export const env = globalThis.__cf ?? {};'
        : a.path === 'astro:content' ? 'export const getCollection = async () => [];'
        : 'const e = globalThis.__env ?? {}; export const {GHL_WEBHOOK_URL,GHL_PRIVATE_TOKEN,GHL_LOCATION_ID,GHL_PIPELINE_ID,GHL_STAGE_NEW_ID,RESEND_API_KEY,INQUIRY_NOTIFY_EMAIL,INQUIRY_FROM_EMAIL,LOG_HASH_KEY,GOOGLE_SA_EMAIL,GOOGLE_SA_PRIVATE_KEY,GOOGLE_CALENDAR_IDS,AVAILABILITY_TIMEZONE} = e;',
      loader: 'js',
    }));
  },
};
const out = await build({entryPoints: ['src/lib/scout/tools.ts'], bundle: true, write: false, format: 'esm', platform: 'node', plugins: [stubs], define: {'import.meta.env.DEV': 'false'}, logLevel: 'error'});

function d1() {
  const db = new DatabaseSync(':memory:');
  return {
    raw: db,
    prepare(sql) {
      return {bind(...v) {
        return {
          async run() { return {meta: {changes: Number(db.prepare(sql).run(...v).changes)}}; },
          async first() { return db.prepare(sql).get(...v) ?? null; },
          async all() { return {results: db.prepare(sql).all(...v)}; },
        };
      }};
    },
  };
}

test('an inquiry taken by Scout is accepted at once; a stalled CRM delivers in the background', {timeout: 10_000}, async () => {
  const db = d1();
  globalThis.__cf = {LEADS_DB: db};
  globalThis.__env = {GHL_WEBHOOK_URL: 'https://hooks.example/lead'};
  const realFetch = globalThis.fetch;
  let release;
  globalThis.fetch = () => new Promise((resolve) => { release = () => resolve(new Response('ok')); }); // the CRM stalls
  const quiet = console.info;
  console.info = () => {};
  try {
    const {executeTool} = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
    const deferred = [];
    const ctx = {attribution: {}, experiments: {}, page: '/weddings', visitorText: 'I am Ada, ada@example.com', defer: (p) => deferred.push(p)};
    const args = {visitor_confirmed: true, name: 'Ada Lovelace', email: 'ada@example.com', event_type: 'wedding', location: 'Malibu', budget: 'discuss', role: 'couple'};

    const outcome = await executeTool('submit_inquiry', args, ctx); // would hang here if delivery were inline
    const result = JSON.parse(outcome.result);
    assert.equal(result.ok, true, outcome.result);
    assert.equal(deferred.length >= 1, true, 'delivery was handed to waitUntil');
    const row = db.raw.prepare('SELECT crm FROM leads WHERE lead_id = ?').get(result.leadId);
    assert.equal(row.crm, 'pending', 'stored and accepted while the CRM is still in flight');

    release();
    await Promise.all(deferred);
    assert.equal(db.raw.prepare('SELECT crm FROM leads WHERE lead_id = ?').get(result.leadId).crm, 'delivered');
  } finally {
    globalThis.fetch = realFetch;
    console.info = quiet;
  }
});
