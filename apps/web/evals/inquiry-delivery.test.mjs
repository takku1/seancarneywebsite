import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
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

const {acceptLead, retryOpen, listOpen, reopenAbandoned, MAX_ATTEMPTS} = await load('src/lib/inquiry/deliver.ts');

/**
 * Cloudflare D1's API over real SQLite. Every call yields to the event loop
 * first, so concurrent callers genuinely interleave between statements.
 */
function d1({failOn} = {}) {
  const db = new DatabaseSync(':memory:');
  const tick = () => new Promise((r) => setImmediate(r));
  return {
    raw: db,
    prepare(sql) {
      return {
        bind(...v) {
          const guard = () => { if (failOn && failOn.test(sql)) throw new Error('d1 unavailable'); };
          return {
            async run() { await tick(); guard(); return {meta: {changes: Number(db.prepare(sql).run(...v).changes)}}; },
            async first() { await tick(); guard(); return db.prepare(sql).get(...v) ?? null; },
            async all() { await tick(); guard(); return {results: db.prepare(sql).all(...v)}; },
          };
        },
      };
    },
  };
}
const row = (db, id) => db.raw.prepare('SELECT * FROM leads WHERE lead_id = ?').get(id);
const count = (db) => Number(db.raw.prepare('SELECT COUNT(*) AS n FROM leads').get().n);

let seq = 0;
const record = (id = `SC-${++seq}`, createdAt = new Date(Date.UTC(2026, 10, 10, 0, 0, seq)).toISOString()) =>
  ({leadId: id, channel: 'form', createdAt, inquiry: {email: 'couple@example.com', name: 'Ada Lovelace'}, lead: {tier: 'A'}});
const ok = () => async () => {};
const boom = (msg = 'down') => async () => { throw new Error(msg); };
const NOW = () => new Date(Date.UTC(2026, 10, 10, 12));
function deps(over = {}) {
  const logs = [];
  const calls = {confirm: 0};
  return {logs, calls, d: {db: null, sendToCrm: null, notifyOwner: null, confirmVisitor: async () => { calls.confirm++; }, allowDryRun: false, log: (e, f) => logs.push({e, ...f}), now: NOW, ...over}};
}

// ── Acceptance ──────────────────────────────────────────────────────────────

test('CRM not connected yet: the lead is stored, accepted and listed for backfill', async () => {
  const db = d1();
  const {d, calls} = deps({db, notifyOwner: ok()});
  const r = await acceptLead(record('SC-a'), d);
  assert.equal(r.accepted, true);
  assert.equal(calls.confirm, 1);
  assert.equal(row(db, 'SC-a').crm, 'skipped');
  assert.deepEqual((await listOpen(db)).leads.map((l) => l.leadId), ['SC-a']);
});

test('nothing durable took the lead: not accepted, and no confirmation email is sent', async () => {
  const {d, calls, logs} = deps({sendToCrm: boom('crm 500'), notifyOwner: boom('resend 500')});
  const r = await acceptLead(record(), d);
  assert.equal(r.accepted, false);
  assert.equal(calls.confirm, 0);
  assert.equal(logs.at(-1).e, 'lead_undeliverable');
});

test('an unavailable database still accepts when the CRM takes the lead', async () => {
  const {d, logs} = deps({db: d1({failOn: /./}), sendToCrm: ok()});
  assert.equal((await acceptLead(record(), d)).accepted, true);
  assert.ok(logs.some((l) => l.e === 'lead_store_failed'));
});

test('owner notification alone counts as durable when there is no store and the CRM fails', async () => {
  const {d} = deps({sendToCrm: boom(), notifyOwner: ok()});
  const r = await acceptLead(record(), d);
  assert.equal(r.accepted, true);
  assert.equal(r.delivery.crm, 'failed');
});

test('dry run only in development with nothing configured', async () => {
  assert.equal((await acceptLead(record(), deps({allowDryRun: true}).d)).accepted, true);
  assert.equal((await acceptLead(record(), deps({allowDryRun: false}).d)).accepted, false);
});

// ── Idempotency ─────────────────────────────────────────────────────────────

test('a repeated submission with the same event id is not delivered twice', async () => {
  const db = d1();
  let crm = 0;
  const {d} = deps({db, sendToCrm: async () => { crm++; }});
  const first = await acceptLead(record('SC-b1'), d, 'evt-1');
  const again = await acceptLead(record('SC-b2'), d, 'evt-1');
  assert.equal(again.duplicate, true);
  assert.equal(again.leadId, first.leadId);
  assert.equal(crm, 1);
  assert.equal(count(db), 1);
});

test('two simultaneous submissions with the same event id create one lead and one delivery', async () => {
  const db = d1();
  let crm = 0, notify = 0;
  const {d} = deps({db, sendToCrm: async () => { crm++; }, notifyOwner: async () => { notify++; }});
  const results = await Promise.all(Array.from({length: 5}, (_, n) => acceptLead(record(`SC-c${n}`), d, 'evt-same')));
  assert.equal(new Set(results.map((r) => r.leadId)).size, 1, 'all callers get the same lead id');
  assert.equal(results.filter((r) => !r.duplicate).length, 1);
  assert.equal(count(db), 1);
  assert.equal(crm, 1);
  assert.equal(notify, 1);
});

// ── Recovery ────────────────────────────────────────────────────────────────

test('a lead whose outcome write failed is still found by recovery', async () => {
  const db = d1({failOn: /^UPDATE leads SET crm = \?, crm_error/});
  const {d, logs} = deps({db, sendToCrm: boom('crm 500'), notifyOwner: ok()});
  assert.equal((await acceptLead(record('SC-d'), d)).accepted, true);
  assert.ok(logs.some((l) => l.e === 'lead_state_write_failed'));
  assert.equal(row(db, 'SC-d').crm, 'pending', 'the row keeps its initial pending state');
  assert.deepEqual((await listOpen(db)).leads.map((l) => l.leadId), ['SC-d']);
});

test('retry backfills the CRM once it is connected, and the lead leaves the open list', async () => {
  const db = d1();
  await acceptLead(record('SC-e1'), deps({db, notifyOwner: ok()}).d);
  await acceptLead(record('SC-e2'), deps({db, sendToCrm: boom('timeout'), notifyOwner: ok()}).d);
  const sent = [];
  const res = await retryOpen({db, sendToCrm: async (r) => { sent.push(r.leadId); }, notifyOwner: ok(), log: () => {}});
  assert.equal(res.crmDelivered, 2);
  assert.deepEqual(sent.sort(), ['SC-e1', 'SC-e2']);
  assert.equal((await listOpen(db)).leads.length, 0);
  assert.equal(row(db, 'SC-e2').crm_attempts, 2);
});

test('a failed notification is retried, then abandoned after the attempt limit with an alert log', async () => {
  const db = d1();
  await acceptLead(record('SC-f'), deps({db, sendToCrm: ok(), notifyOwner: boom('resend 500')}).d);
  const logs = [];
  const log = (e, f) => logs.push({e, ...f});
  for (let i = 0; i < MAX_ATTEMPTS; i++) await retryOpen({db, sendToCrm: ok(), notifyOwner: boom('resend 500'), log});
  assert.equal(row(db, 'SC-f').notify, 'abandoned');
  assert.ok(logs.some((l) => l.e === 'lead_notify_abandoned'));
  assert.equal(await reopenAbandoned(db), 1);
  await retryOpen({db, sendToCrm: ok(), notifyOwner: ok(), log});
  assert.equal(row(db, 'SC-f').notify, 'delivered');
});

test('retry resumes a partial CRM write instead of repeating completed steps', async () => {
  const db = d1();
  const steps = [];
  let failNote = true;
  const crm = async (r, p) => {
    if (!p.contactId) { steps.push('contact'); p.contactId = 'c1'; }
    if (!p.opportunityId) { steps.push('opportunity'); p.opportunityId = 'o1'; }
    if (!p.noted) { if (failNote) throw new Error('note 500'); steps.push('note'); p.noted = true; }
  };
  await acceptLead(record('SC-g'), deps({db, sendToCrm: crm}).d);
  failNote = false;
  await retryOpen({db, sendToCrm: crm, notifyOwner: null, log: () => {}});
  assert.deepEqual(steps, ['contact', 'opportunity', 'note']);
  assert.equal(row(db, 'SC-g').crm, 'delivered');
});

test('retry pages through a large queue with a cursor, visiting each lead once', async () => {
  const db = d1();
  for (let n = 0; n < 7; n++) await acceptLead(record(`SC-h${n}`), deps({db, notifyOwner: ok()}).d);
  const seen = [];
  let cursor = null, batches = 0;
  do {
    const r = await retryOpen({db, sendToCrm: async (rec) => { seen.push(rec.leadId); }, notifyOwner: ok(), log: () => {}}, {limit: 3, cursor});
    cursor = r.nextCursor;
    batches++;
  } while (cursor);
  assert.equal(batches, 3);
  assert.equal(new Set(seen).size, 7);
  assert.equal(seen.length, 7);
});

test('two concurrent retry runs never deliver the same lead twice', async () => {
  const db = d1();
  for (let n = 0; n < 4; n++) await acceptLead(record(`SC-i${n}`), deps({db, notifyOwner: ok()}).d);
  const sent = [];
  const crm = async (r) => { sent.push(r.leadId); };
  await Promise.all([retryOpen({db, sendToCrm: crm, notifyOwner: null, log: () => {}}), retryOpen({db, sendToCrm: crm, notifyOwner: null, log: () => {}})]);
  assert.equal(sent.length, 4);
  assert.equal(new Set(sent).size, 4);
});

test('leads older than the retention period are deleted', async () => {
  const db = d1();
  await acceptLead(record('SC-old', '2026-07-01T00:00:00.000Z'), deps({db, notifyOwner: ok(), now: () => new Date('2026-07-01T00:00:01Z')}).d);
  await acceptLead(record('SC-new'), deps({db, notifyOwner: ok()}).d);
  assert.equal(row(db, 'SC-old'), undefined);
  assert.ok(row(db, 'SC-new'));
});

test('lead logs never contain personal data', async () => {
  const {d, logs} = deps({db: d1(), sendToCrm: boom('crm 500'), notifyOwner: ok()});
  await acceptLead(record(), d);
  const text = JSON.stringify(logs);
  assert.ok(!text.includes('couple@example.com') && !text.includes('Ada'), text);
});

// ── The real pipeline ───────────────────────────────────────────────────────

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
