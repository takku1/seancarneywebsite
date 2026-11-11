import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

/** Bundle a TS module; `astro:env/server` reads globalThis.__env, `cloudflare:workers` exposes globalThis.__cf. */
async function load(entry) {
  const stubs = {
    name: 'stubs',
    setup(b) {
      b.onResolve({filter: /^(astro:env\/server|cloudflare:workers)$/}, (a) => ({path: a.path, namespace: 'stub'}));
      b.onLoad({filter: /.*/, namespace: 'stub'}, (a) => ({
        contents: a.path === 'cloudflare:workers'
          ? 'export const env = globalThis.__cf ?? {};'
          : 'export const {GHL_WEBHOOK_URL,GHL_PRIVATE_TOKEN,GHL_LOCATION_ID,GHL_PIPELINE_ID,GHL_STAGE_NEW_ID,RESEND_API_KEY,INQUIRY_NOTIFY_EMAIL,INQUIRY_FROM_EMAIL,LOG_HASH_KEY} = globalThis.__env ?? {};',
        loader: 'js',
      }));
    },
  };
  const out = await build({entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node', plugins: [stubs], define: {'import.meta.env.DEV': 'false'}});
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
}

const {acceptLead, retryPending, listPending} = await load('src/lib/inquiry/deliver.ts');

function memoryKV({failPut = false} = {}) {
  const m = new Map();
  return {
    m,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { if (failPut) throw new Error('kv down'); m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({prefix}) { return {keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({name}))}; },
  };
}
const record = (id = 'SC-1') => ({leadId: id, channel: 'form', createdAt: '2026-11-10T00:00:00Z', inquiry: {email: 'couple@example.com', name: 'Ada Lovelace'}, lead: {tier: 'A'}, delivery: {crm: 'skipped', notify: 'skipped', confirm: 'skipped'}, attempts: 0});
const ok = () => async () => {};
const boom = (msg = 'down') => async () => { throw new Error(msg); };
function deps(over = {}) {
  const logs = [];
  const calls = {confirm: 0, crm: 0};
  return {
    logs, calls,
    d: {store: null, sendToCrm: null, notifyOwner: null, confirmVisitor: async () => { calls.confirm++; }, allowDryRun: false, log: (e, f) => logs.push({e, ...f}), ...over},
  };
}

test('CRM not connected yet: the lead is stored, accepted and queued for backfill', async () => {
  const store = memoryKV();
  const {d, calls} = deps({store, notifyOwner: ok()});
  const r = await acceptLead(record(), d);
  assert.equal(r.accepted, true);
  assert.equal(calls.confirm, 1);
  assert.ok(store.m.has('lead:SC-1'));
  assert.ok(store.m.has('pending:SC-1'));
  assert.deepEqual((await listPending(store)).map((p) => p.leadId), ['SC-1']);
});

test('nothing durable took the lead: not accepted, and no confirmation email is sent', async () => {
  const {d, calls, logs} = deps({sendToCrm: boom('crm 500'), notifyOwner: boom('resend 500')});
  const r = await acceptLead(record(), d);
  assert.equal(r.accepted, false);
  assert.equal(calls.confirm, 0);
  assert.equal(logs.at(-1).e, 'lead_undeliverable');
});

test('a failing lead store still accepts when the CRM takes the lead', async () => {
  const {d} = deps({store: memoryKV({failPut: true}), sendToCrm: ok()});
  assert.equal((await acceptLead(record(), d)).accepted, true);
});

test('owner notification alone counts as durable when there is no store or CRM', async () => {
  const {d} = deps({sendToCrm: boom(), notifyOwner: ok()});
  const r = await acceptLead(record(), d);
  assert.equal(r.accepted, true);
  assert.equal(r.delivery.crm, 'failed');
});

test('dry run only in development with nothing configured', async () => {
  assert.equal((await acceptLead(record(), deps({allowDryRun: true}).d)).accepted, true);
  assert.equal((await acceptLead(record(), deps({allowDryRun: false}).d)).accepted, false);
});

test('a repeated submission with the same event id is not delivered twice', async () => {
  const store = memoryKV();
  let crm = 0;
  const {d} = deps({store, sendToCrm: async () => { crm++; }});
  const first = await acceptLead(record('SC-1'), d, 'evt-1');
  const again = await acceptLead(record('SC-2'), d, 'evt-1');
  assert.equal(again.duplicate, true);
  assert.equal(again.leadId, first.leadId);
  assert.equal(crm, 1);
});

test('retry delivers queued leads once the CRM is connected, and clears the queue', async () => {
  const store = memoryKV();
  await acceptLead(record('SC-1'), deps({store}).d);
  await acceptLead(record('SC-2'), deps({store, sendToCrm: boom('timeout')}).d);
  const delivered = [];
  const res = await retryPending({store, sendToCrm: async (r) => { delivered.push(r.leadId); }, log: () => {}});
  assert.equal(res.delivered, 2);
  assert.deepEqual(delivered.sort(), ['SC-1', 'SC-2']);
  assert.equal(res.still.length, 0);
  assert.equal(JSON.parse(store.m.get('lead:SC-2')).attempts, 2);
});

test('lead logs never contain personal data', async () => {
  const {d, logs} = deps({store: memoryKV(), sendToCrm: boom('crm 500'), notifyOwner: ok()});
  await acceptLead(record(), d);
  const text = JSON.stringify(logs);
  assert.ok(!text.includes('couple@example.com') && !text.includes('Ada'), text);
});

test('pipeline: a webhook answering 500 is a failed delivery, not a success', async () => {
  globalThis.__env = {GHL_WEBHOOK_URL: 'https://hooks.example/lead'};
  globalThis.__cf = {};
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('nope', {status: 500});
  const errors = [];
  const realError = console.error;
  console.error = (line) => errors.push(line);
  try {
    const {processInquiry} = await load('src/lib/inquiry/process.ts');
    const i = {name: 'Ada Lovelace', email: 'couple@example.com', event_type: 'wedding', location: 'Malibu', budget: 'discuss', role: 'couple', format: 'unsure', moments: [], sms_consent: false, attribution: {}, experiments: {}};
    const r = await processInquiry(i, 'form');
    assert.equal(r.accepted, false);
    assert.match(errors.join('\n'), /webhook_500/);
    assert.ok(!errors.join('\n').includes('couple@example.com'));
  } finally {
    globalThis.fetch = realFetch;
    console.error = realError;
  }
});
