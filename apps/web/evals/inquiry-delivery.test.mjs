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

const {acceptLead, retryOpen, listOpen, reopenAbandoned, MAX_ATTEMPTS, LEASE_MS, CONFIRM_MAX_AGE_MS} = await load('src/lib/inquiry/deliver.ts');

/** Cloudflare D1's API over real SQLite; every call yields first, so concurrent callers interleave. */
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

/** A promise the test resolves by hand: a delivery that is "still in flight". */
function gate() { let open; const p = new Promise((r) => { open = r; }); return {p, open}; }
const until = async (cond) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setImmediate(r)); assert.ok(cond(), 'condition never became true'); };

let clock = Date.UTC(2026, 10, 10, 12);
const now = () => clock;
let seq = 0;
const record = (id = `SC-${++seq}`, createdAt = new Date(clock).toISOString()) =>
  ({leadId: id, channel: 'form', createdAt, inquiry: {email: 'couple@example.com', name: 'Ada Lovelace'}, lead: {tier: 'A'}});
const ok = () => async () => {};
const boom = (msg = 'down') => async () => { throw new Error(msg); };
const quiet = () => {};
function deps(over = {}) {
  const logs = [];
  const calls = {confirm: 0};
  return {logs, calls, d: {db: null, sendToCrm: null, notifyOwner: null, confirmVisitor: async () => { calls.confirm++; }, allowDryRun: false, log: (e, f) => logs.push({e, ...f}), now, ...over}};
}
const retry = (o) => retryOpen({sendToCrm: null, notifyOwner: null, confirmVisitor: null, log: quiet, now, ...o});

// ── Acceptance ──────────────────────────────────────────────────────────────

test('CRM not connected yet: the lead is stored, accepted and listed for backfill', {timeout: 10_000}, async () => {
  const db = d1();
  const {d, calls} = deps({db, notifyOwner: ok()});
  assert.equal((await acceptLead(record('SC-a'), d)).accepted, true);
  assert.equal(calls.confirm, 1);
  assert.equal(row(db, 'SC-a').crm, 'skipped');
  assert.deepEqual((await listOpen(db, {now: clock})).leads.map((l) => l.leadId), ['SC-a']);
});

test('nothing durable took the lead: not accepted, and no confirmation email is sent', {timeout: 10_000}, async () => {
  const {d, calls, logs} = deps({sendToCrm: boom('crm 500'), notifyOwner: boom('resend 500')});
  assert.equal((await acceptLead(record(), d)).accepted, false);
  assert.equal(calls.confirm, 0);
  assert.equal(logs.at(-1).e, 'lead_undeliverable');
});

test('an unavailable database still accepts when the CRM takes the lead', {timeout: 10_000}, async () => {
  const {d, logs} = deps({db: d1({failOn: /./}), sendToCrm: ok()});
  assert.equal((await acceptLead(record(), d)).accepted, true);
  assert.ok(logs.some((l) => l.e === 'lead_store_failed'));
});

test('dry run only in development with nothing configured', {timeout: 10_000}, async () => {
  assert.equal((await acceptLead(record(), deps({allowDryRun: true}).d)).accepted, true);
  assert.equal((await acceptLead(record(), deps({allowDryRun: false}).d)).accepted, false);
});

// ── Idempotent submission ───────────────────────────────────────────────────

test('two simultaneous submissions with the same event id create one lead and one delivery', {timeout: 10_000}, async () => {
  const db = d1();
  let crm = 0, notify = 0;
  const {d} = deps({db, sendToCrm: async () => { crm++; }, notifyOwner: async () => { notify++; }});
  const results = await Promise.all(Array.from({length: 5}, (_, n) => acceptLead(record(`SC-c${n}`), d, 'evt-same')));
  assert.equal(new Set(results.map((r) => r.leadId)).size, 1);
  assert.equal(count(db), 1);
  assert.deepEqual([crm, notify], [1, 1]);
});

// ── Leases ──────────────────────────────────────────────────────────────────

test('a retry run cannot pick up a lead while its first delivery is still in flight', {timeout: 10_000}, async () => {
  const db = d1();
  const g = gate();
  let crm = 0;
  const slowCrm = async () => { crm++; await g.p; };
  const accepting = acceptLead(record('SC-l1'), deps({db, sendToCrm: slowCrm, notifyOwner: ok()}).d);
  await until(() => crm === 1);
  const r = await retry({db, sendToCrm: slowCrm, notifyOwner: ok()});
  assert.equal(crm, 1, 'the cron did not send the lead a second time');
  assert.equal(r.skippedInProgress, 2, 'CRM (in flight) and notify (reserved by the accepting request) are both skipped');
  g.open();
  assert.equal((await accepting).accepted, true);
  assert.equal(row(db, 'SC-l1').crm, 'delivered');
});

test('a slow retry is not duplicated by the next run; after its lease expires, its late result is discarded', {timeout: 10_000}, async () => {
  const db = d1();
  await acceptLead(record('SC-l2'), deps({db, sendToCrm: boom('timeout'), notifyOwner: ok()}).d);
  const g = gate();
  let calls = 0;
  const logsA = [];
  const runA = retry({db, sendToCrm: async () => { calls++; await g.p; }, log: (e, f) => logsA.push({e, ...f})});
  await until(() => calls === 1);
  const runB = await retry({db, sendToCrm: async () => { calls++; }});
  assert.equal(calls, 1, 'run B skipped the leased lead');
  assert.equal(runB.skippedInProgress, 1);

  clock += LEASE_MS + 1; // run A is presumed dead
  const runC = await retry({db, sendToCrm: boom('still down')});
  assert.equal(runC.processed, 1);
  assert.equal(row(db, 'SC-l2').crm, 'failed');

  g.open(); // run A finally "succeeds", too late
  await runA;
  assert.equal(row(db, 'SC-l2').crm, 'failed', "A's stale success did not overwrite C's result");
  assert.ok(logsA.some((l) => l.e === 'lead_lease_lost'));
});

test('a runner that lost its lease stops at its next CRM step', {timeout: 10_000}, async () => {
  const db = d1();
  await acceptLead(record('SC-l3'), deps({db, sendToCrm: boom(), notifyOwner: ok()}).d);
  const g = gate();
  const stepsA = [];
  const crmA = async (r, p, checkpoint) => {
    await checkpoint(p); p.contactId = 'c1'; stepsA.push('contact'); await checkpoint(p);
    await g.p; // stalls past its lease
    await checkpoint(p); stepsA.push('opportunity'); p.opportunityId = 'o1'; await checkpoint(p);
  };
  const runA = retry({db, sendToCrm: crmA});
  await until(() => stepsA.length === 1);
  clock += LEASE_MS + 1;
  const stepsC = [];
  await retry({db, sendToCrm: async (r, p, checkpoint) => {
    if (!p.contactId) { await checkpoint(p); stepsC.push('contact'); p.contactId = 'c1'; await checkpoint(p); }
    if (!p.opportunityId) { await checkpoint(p); stepsC.push('opportunity'); p.opportunityId = 'o1'; await checkpoint(p); }
  }});
  g.open();
  await runA;
  assert.deepEqual(stepsA, ['contact'], 'A stopped before its next remote write');
  assert.deepEqual(stepsC, ['opportunity'], 'C resumed after the checkpointed contact');
  assert.equal(row(db, 'SC-l3').crm, 'delivered');
});

test('a worker that dies mid-CRM leaves its checkpoints; the next run resumes after them', {timeout: 10_000}, async () => {
  const db = d1();
  const steps = [];
  const dies = gate(); // never opened: the Worker died
  const crmDying = async (r, p, checkpoint) => {
    p.contactId = 'c1'; steps.push('contact'); await checkpoint(p);
    p.opportunityId = 'o1'; steps.push('opportunity'); await checkpoint(p);
    await dies.p;
  };
  acceptLead(record('SC-l4'), deps({db, sendToCrm: crmDying, notifyOwner: ok()}).d); // never settles
  await until(() => steps.length === 2 && JSON.parse(row(db, 'SC-l4').crm_progress).opportunityId);
  clock += LEASE_MS + 1;
  await retry({db, sendToCrm: async (r, p, checkpoint) => {
    if (!p.contactId) steps.push('contact');
    if (!p.opportunityId) steps.push('opportunity');
    if (!p.noted) { steps.push('note'); p.noted = true; await checkpoint(p); }
  }});
  assert.deepEqual(steps, ['contact', 'opportunity', 'note']);
  assert.equal(row(db, 'SC-l4').crm, 'delivered');
});

// ── Recovery ────────────────────────────────────────────────────────────────

test('a lead whose outcome write failed is still recovered after its lease expires', {timeout: 10_000}, async () => {
  const db = d1({failOn: /^UPDATE leads SET crm = \?/});
  const {d, logs} = deps({db, sendToCrm: boom('crm 500'), notifyOwner: ok()});
  assert.equal((await acceptLead(record('SC-d'), d)).accepted, true);
  assert.ok(logs.some((l) => l.e === 'lead_state_write_failed'));
  assert.equal(row(db, 'SC-d').crm, 'pending');
  assert.deepEqual((await listOpen(db, {now: clock})).leads.map((l) => l.leadId), ['SC-d']);
});

test('retry backfills the CRM once it is connected, and the lead leaves the open list', {timeout: 10_000}, async () => {
  const db = d1();
  await acceptLead(record('SC-e1'), deps({db, notifyOwner: ok()}).d);
  await acceptLead(record('SC-e2'), deps({db, sendToCrm: boom('timeout'), notifyOwner: ok()}).d);
  const sent = [];
  const res = await retry({db, sendToCrm: async (r) => { sent.push(r.leadId); }, notifyOwner: ok()});
  assert.equal(res.delivered.crm, 2);
  assert.deepEqual(sent.sort(), ['SC-e1', 'SC-e2']);
  assert.equal((await listOpen(db, {now: clock})).leads.length, 0);
});

test('a failed notification is retried, then abandoned after the attempt limit with an alert log; reopen re-queues it', {timeout: 10_000}, async () => {
  const db = d1();
  await acceptLead(record('SC-f'), deps({db, sendToCrm: ok(), notifyOwner: boom('resend 500')}).d);
  const logs = [];
  for (let i = 0; i < MAX_ATTEMPTS; i++) await retry({db, sendToCrm: ok(), notifyOwner: boom('resend 500'), log: (e, f) => logs.push({e, ...f})});
  assert.equal(row(db, 'SC-f').notify, 'abandoned');
  assert.ok(logs.some((l) => l.e === 'lead_notify_abandoned'));
  assert.equal(await reopenAbandoned(db), 1);
  await retry({db, notifyOwner: ok()});
  assert.equal(row(db, 'SC-f').notify, 'delivered');
});

test('a failed confirmation is retried within a day, and dropped once it would be stale', {timeout: 10_000}, async () => {
  const db = d1();
  await acceptLead(record('SC-k1'), deps({db, notifyOwner: ok(), confirmVisitor: boom('resend 500')}).d);
  await retry({db, confirmVisitor: ok()});
  assert.equal(row(db, 'SC-k1').confirm, 'delivered');

  await acceptLead(record('SC-k2'), deps({db, notifyOwner: ok(), confirmVisitor: boom('resend 500')}).d);
  clock += CONFIRM_MAX_AGE_MS + 1;
  let sent = 0;
  const logs = [];
  await retry({db, confirmVisitor: async () => { sent++; }, log: (e, f) => logs.push({e, ...f})});
  assert.equal(sent, 0);
  assert.equal(row(db, 'SC-k2').confirm, 'abandoned');
  assert.ok(logs.some((l) => l.e === 'lead_confirm_expired'));
});

test('retry pages through a large queue with a cursor, visiting each lead once', {timeout: 10_000}, async () => {
  const db = d1();
  for (let n = 0; n < 7; n++) await acceptLead(record(`SC-h${n}`), deps({db, notifyOwner: ok()}).d);
  const seen = [];
  let cursor = null, batches = 0;
  do {
    const r = await retryOpen({db, sendToCrm: async (rec) => { seen.push(rec.leadId); }, notifyOwner: null, confirmVisitor: null, log: quiet, now}, {limit: 3, cursor});
    cursor = r.nextCursor;
    batches++;
  } while (cursor);
  assert.equal(batches, 3);
  assert.equal(seen.length, 7);
  assert.equal(new Set(seen).size, 7);
});

test('two concurrent retry runs never deliver the same lead twice', {timeout: 10_000}, async () => {
  const db = d1();
  for (let n = 0; n < 4; n++) await acceptLead(record(`SC-i${n}`), deps({db, notifyOwner: ok()}).d);
  const sent = [];
  const crm = async (r) => { sent.push(r.leadId); };
  await Promise.all([retry({db, sendToCrm: crm}), retry({db, sendToCrm: crm})]);
  assert.equal(sent.length, 4);
  assert.equal(new Set(sent).size, 4);
});

test('leads older than the retention period are deleted', {timeout: 10_000}, async () => {
  const db = d1();
  const t = clock;
  await acceptLead(record('SC-old', new Date(t).toISOString()), deps({db, notifyOwner: ok()}).d);
  clock = t + 91 * 864e5;
  await acceptLead(record('SC-new'), deps({db, notifyOwner: ok()}).d);
  assert.equal(row(db, 'SC-old'), undefined);
  assert.ok(row(db, 'SC-new'));
});

test('lead logs never contain personal data', {timeout: 10_000}, async () => {
  const {d, logs} = deps({db: d1(), sendToCrm: boom('crm 500'), notifyOwner: ok()});
  await acceptLead(record(), d);
  const text = JSON.stringify(logs);
  assert.ok(!text.includes('couple@example.com') && !text.includes('Ada'), text);
});

// ── The real pipeline ───────────────────────────────────────────────────────

test('pipeline: a webhook answering 500 is a failed delivery, not a success', {timeout: 10_000}, async () => {
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
