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
  // A unique suffix per load: env values are read at import, and identical data: URLs would reuse the first import.
  return import(`data:text/javascript;base64,${Buffer.from(`${out.outputFiles[0].text}
// load ${++loads}`).toString('base64')}`);
}
let loads = 0;

const {acceptLead, retryOpen, listOpen, reopenAbandoned, purgeExpired, overdueNotifications, NOTIFY_OVERDUE_MS, MAX_ATTEMPTS, LEASE_MS, CONFIRM_MAX_AGE_MS, RETRY_SPACING_MS} = await load('src/lib/inquiry/deliver.ts');

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
/** Moves past both the lease and the retry spacing: the next run may take the lead again. */
const later = () => { clock += Math.max(LEASE_MS, RETRY_SPACING_MS) + 1; };
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
  assert.equal(r.processed, 0, 'a lead whose channels are all leased is not even selected');
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
  assert.equal(runB.processed, 0);

  later(); // run A is presumed dead, and the lead is due again
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
  const crmA = async (r, p, lease) => {
    await lease.guard(); p.contactId = 'c1'; stepsA.push('contact'); await lease.save(p);
    await g.p; // stalls past its lease
    await lease.guard(); stepsA.push('opportunity'); p.opportunityId = 'o1'; await lease.save(p);
  };
  const runA = retry({db, sendToCrm: crmA});
  await until(() => stepsA.length === 1);
  later();
  const stepsC = [];
  await retry({db, sendToCrm: async (r, p, lease) => {
    if (!p.contactId) { await lease.guard(); stepsC.push('contact'); p.contactId = 'c1'; await lease.save(p); }
    if (!p.opportunityId) { await lease.guard(); stepsC.push('opportunity'); p.opportunityId = 'o1'; await lease.save(p); }
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
  const crmDying = async (r, p, lease) => {
    await lease.guard(); p.contactId = 'c1'; steps.push('contact'); await lease.save(p);
    await lease.guard(); p.opportunityId = 'o1'; steps.push('opportunity'); await lease.save(p);
    await dies.p;
  };
  acceptLead(record('SC-l4'), deps({db, sendToCrm: crmDying, notifyOwner: ok()}).d); // never settles
  await until(() => steps.length === 2 && JSON.parse(row(db, 'SC-l4').crm_progress).opportunityId);
  clock += LEASE_MS + 1;
  await retry({db, sendToCrm: async (r, p, lease) => {
    if (!p.contactId) steps.push('contact');
    if (!p.opportunityId) steps.push('opportunity');
    if (!p.noted) { await lease.guard(); steps.push('note'); p.noted = true; await lease.save(p); }
  }});
  assert.deepEqual(steps, ['contact', 'opportunity', 'note']);
  assert.equal(row(db, 'SC-l4').crm, 'delivered');
});

test('a CRM that never answers does not hold back the email to Sean or the confirmation', {timeout: 10_000}, async () => {
  const db = d1();
  const never = gate(); // CRM stalls for good
  const deferred = [];
  const {d, calls} = deps({db, sendToCrm: async () => { await never.p; }, notifyOwner: ok(), defer: (p) => deferred.push(p)});
  assert.equal((await acceptLead(record('SC-stall'), d)).accepted, true);
  await until(() => row(db, 'SC-stall').notify === 'delivered' && row(db, 'SC-stall').confirm === 'delivered');
  assert.equal(calls.confirm, 1);
  assert.equal(row(db, 'SC-stall').crm, 'pending', 'the CRM is still in flight; both emails already recorded');
});

test('on retry too, a stalled CRM does not hold back a failed email', {timeout: 10_000}, async () => {
  const db = d1();
  await acceptLead(record('SC-stall2'), deps({db, sendToCrm: boom(), notifyOwner: boom('resend 500')}).d);
  later();
  const never = gate();
  retry({db, sendToCrm: async () => { await never.p; }, notifyOwner: ok()}); // never settles
  await until(() => row(db, 'SC-stall2').notify === 'delivered');
  assert.equal(row(db, 'SC-stall2').crm, 'failed', 'CRM retry still in flight (lease held, outcome not yet recorded)');
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
  for (let i = 0; i < MAX_ATTEMPTS; i++) { later(); await retry({db, sendToCrm: ok(), notifyOwner: boom('resend 500'), log: (e, f) => logs.push({e, ...f})}); }
  assert.equal(row(db, 'SC-f').notify, 'abandoned');
  assert.ok(logs.some((l) => l.e === 'lead_notify_abandoned'));
  assert.equal(await reopenAbandoned(db), 1);
  later();
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

test('a large backlog is worked round-robin: every lead gets a turn, none twice in a run', {timeout: 20_000}, async () => {
  const db = d1();
  for (let n = 0; n < 120; n++) await acceptLead(record(`SC-b${String(n).padStart(3, '0')}`), deps({db, sendToCrm: boom('crm down'), notifyOwner: ok()}).d);
  const attempts = new Map();
  const crm = async (r) => { attempts.set(r.leadId, (attempts.get(r.leadId) ?? 0) + 1); throw new Error('crm down'); };
  const cronRun = async () => { for (let i = 0; i < 4; i++) { const r = await retry({db, sendToCrm: crm}, {limit: 25}); if (!r.processed) break; } };

  later(); await cronRun();
  assert.equal(attempts.size, 100, 'one run reaches 4 x 25 distinct leads');
  assert.ok([...attempts.values()].every((n) => n === 1), 'no lead twice in a run');

  later(); await cronRun();
  assert.equal(attempts.size, 120, 'the next run starts with the 20 never-attempted leads');
  const counts = [...attempts.values()];
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, 'turns stay even across the backlog');
});

test('leased leads do not use up retry batch slots', {timeout: 10_000}, async () => {
  const db = d1();
  const g = gate();
  for (let n = 0; n < 30; n++) acceptLead(record(`SC-busy${n}`), deps({db, sendToCrm: async () => { await g.p; }}).d); // in flight
  for (let n = 0; n < 5; n++) await acceptLead(record(`SC-due${n}`), deps({db, sendToCrm: boom(), notifyOwner: ok()}).d);
  await until(() => count(db) === 35);
  clock += LEASE_MS / 2; // in-flight leases still valid
  const sent = [];
  const r = await retry({db, sendToCrm: async (rec) => { sent.push(rec.leadId); }}, {limit: 25});
  assert.equal(r.processed, 5);
  assert.deepEqual(sent.sort(), ['SC-due0', 'SC-due1', 'SC-due2', 'SC-due3', 'SC-due4']);
  g.open();
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

test('retention deletes resolved leads at 90 days but keeps unresolved ones until 180', {timeout: 10_000}, async () => {
  const db = d1();
  const t = clock;
  await acceptLead(record('SC-done', new Date(t).toISOString()), deps({db, sendToCrm: ok(), notifyOwner: ok()}).d);
  await acceptLead(record('SC-waiting', new Date(t).toISOString()), deps({db, notifyOwner: ok()}).d); // CRM not connected
  await acceptLead(record('SC-failing', new Date(t).toISOString()), deps({db, sendToCrm: boom(), notifyOwner: boom()}).d);
  const logs = [];
  const log = (e, f) => logs.push({e, ...f});

  await purgeExpired(db, log, t + 91 * 864e5);
  assert.equal(row(db, 'SC-done'), undefined, 'resolved: deleted after 90 days');
  assert.ok(row(db, 'SC-waiting'), 'waiting for the CRM: kept');
  assert.ok(row(db, 'SC-failing'), 'undelivered: kept');

  await purgeExpired(db, log, t + 181 * 864e5);
  assert.equal(count(db), 0, 'nothing outlives 180 days');
  const expired = logs.find((l) => l.e === 'lead_retention_expired_unresolved');
  assert.equal(expired.count, 2);
});

// ── Lease expiry, background delivery, retry scope ──────────────────────────

test('an expired lease cannot start a new step, but an unreplaced holder still records its result', {timeout: 10_000}, async () => {
  const db = d1();
  await acceptLead(record('SC-x'), deps({db, sendToCrm: boom(), notifyOwner: ok()}).d);
  const g = gate();
  const steps = [];
  const run = retry({db, sendToCrm: async (r, p, lease) => {
    await lease.guard(); steps.push('contact'); p.contactId = 'c1'; await lease.save(p);
    await g.p;
    clock += LEASE_MS + 1; // the lease ran out while this runner was busy; nobody else claimed it
    await lease.guard(); steps.push('opportunity');
  }});
  await until(() => steps.length === 1);
  g.open();
  await run;
  assert.deepEqual(steps, ['contact'], 'no new remote step on an expired lease');
  assert.equal(JSON.parse(row(db, 'SC-x').crm_progress).contactId, 'c1', 'the completed step was saved');
  assert.equal(row(db, 'SC-x').crm, 'failed', 'the run ended as failed (lease_lost), to be resumed');
  assert.equal(row(db, 'SC-x').crm_error, 'lease_lost');
});

test('once stored, delivery runs after the response: a slow CRM does not delay acceptance', {timeout: 10_000}, async () => {
  const db = d1();
  const g = gate();
  const deferred = [];
  const {d} = deps({db, sendToCrm: async () => { await g.p; }, notifyOwner: ok(), defer: (p) => deferred.push(p)});
  const r = await acceptLead(record('SC-bg'), d);
  assert.equal(r.accepted, true);
  assert.equal(r.delivery, undefined, 'delivery outcome is not known yet');
  assert.equal(row(db, 'SC-bg').crm, 'pending');
  g.open();
  await Promise.all(deferred);
  assert.equal(row(db, 'SC-bg').crm, 'delivered');
  assert.equal(row(db, 'SC-bg').notify, 'delivered');
});

test('the retry scan skips channels that cannot be delivered now', {timeout: 10_000}, async () => {
  const db = d1();
  for (let n = 0; n < 3; n++) await acceptLead(record(`SC-s${n}`), deps({db, notifyOwner: ok()}).d); // CRM not connected
  const r = await retry({db, notifyOwner: ok()}); // CRM still not connected
  assert.equal(r.processed, 0, 'no batch spent on leads waiting for the CRM');
  assert.equal((await listOpen(db, {now: clock})).leads.length, 3, 'but the admin view still lists them');
});

// ── Log safety ──────────────────────────────────────────────────────────────

test('error codes never carry raw messages, URLs or secrets', {timeout: 10_000}, async () => {
  const {errorCode} = await load('src/lib/security/errors.ts');
  assert.equal(errorCode(new Error('webhook_502')), 'webhook_502');
  assert.equal(errorCode(new Error('ghl_/contacts/upsert_500+webhook_502')), 'ghl_/contacts/upsert_500+webhook_502');
  assert.equal(errorCode(new TypeError('fetch failed: https://hooks.example/secret-token-123')), 'network');
  assert.equal(errorCode(Object.assign(new Error('The operation was aborted due to timeout'), {name: 'TimeoutError'})), 'timeout');
  assert.equal(errorCode(new Error('duplicate key couple@example.com')), 'error');
  assert.equal(errorCode(new RangeError('bad value 555-0100')), 'RangeError');
  assert.equal(errorCode('a string'), 'non_error_thrown');
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

test('a lead whose notification to Sean is still undelivered after 30 minutes is overdue', {timeout: 10_000}, async () => {
  const db = d1();
  // Accepted (stored) while email is down: the visitor saw "received", Sean has not been told.
  const {d} = deps({db, notifyOwner: boom('resend_500')});
  assert.equal((await acceptLead(record('SC-late'), d)).accepted, true);
  const {d: d2} = deps({db, notifyOwner: ok()});
  await acceptLead(record('SC-fine'), d2);
  assert.equal(await overdueNotifications(db, clock), 0, 'not overdue yet');
  assert.equal(await overdueNotifications(db, clock + NOTIFY_OVERDUE_MS + 1), 1, 'only the undelivered one');
  assert.equal(await overdueNotifications(db, clock + 8 * 86_400_000), 0, 'older than 7 days stops alerting (still listed)');
});

test('the 90-day source review counts inquiries per answer and tier, inside the window, with no personal data', {timeout: 10_000}, async () => {
  const {sourceReport} = await load('src/lib/inquiry/deliver.ts');
  const db = d1();
  const {d} = deps({db});
  const add = async (heard, tier, createdAt) => {
    const r = {...record(undefined, createdAt), inquiry: {email: `p${seq}@example.com`, name: 'Private Person', ...(heard ? {heard_via: heard, referrer: 'Jane Doe'} : {})}, lead: {tier}};
    await acceptLead(r, d, `evt-${seq}`);
  };
  const t = new Date(clock).toISOString();
  await add('planner', 'A', t);
  await add('planner', 'B', t);
  await add('search', 'C', t);
  await add(null, 'B', t);
  await add('planner', 'A', new Date(clock - 120 * 86_400_000).toISOString()); // outside 90 days
  const r = await sourceReport(db, {now: clock});
  assert.equal(r.total, 4);
  assert.deepEqual(r.bySource.planner, {total: 2, A: 1, B: 1, C: 0});
  assert.deepEqual(r.bySource.search, {total: 1, A: 0, B: 0, C: 1});
  assert.equal(r.bySource.unknown.total, 1);
  const text = JSON.stringify(r);
  assert.ok(!/example\.com|Private Person|Jane Doe/.test(text), 'counts only');
  assert.equal((await sourceReport(db, {now: clock, days: 180})).total, 5);
});

test('pipeline: the CRM and Sean see how the lead heard, and the referrer is escaped in the email', {timeout: 10_000}, async () => {
  globalThis.__env = {GHL_WEBHOOK_URL: 'https://hooks.example/lead', RESEND_API_KEY: 're_test', INQUIRY_FROM_EMAIL: 'site@example.com', INQUIRY_NOTIFY_EMAIL: 'sean@example.com'};
  globalThis.__cf = {};
  const realFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => { sent.push({url: String(url), body: JSON.parse(init.body)}); return new Response('{}'); };
  const realInfo = console.info;
  console.info = () => {};
  try {
    const {processInquiry} = await load('src/lib/inquiry/process.ts');
    const i = {name: 'Ada Lovelace', email: 'couple@example.com', event_type: 'wedding', location: 'Malibu', budget: 'discuss', role: 'couple', format: 'unsure', moments: [], sms_consent: false, attribution: {}, experiments: {}, heard_via: 'venue', referrer: '<b>Terranea</b> events'};
    const r = await processInquiry(i, 'form');
    assert.equal(r.accepted, true);
    const crm = sent.find((s) => s.url.startsWith('https://hooks.example')).body;
    assert.equal(crm.heard_via, 'The venue');
    assert.equal(crm.referred_by, '<b>Terranea</b> events');
    assert.ok(crm.tags.includes('heard:venue'));
    const notify = sent.find((s) => s.url.includes('resend') && s.body.to[0] === 'sean@example.com').body;
    assert.match(notify.html, /Referred by/);
    assert.ok(notify.html.includes('&lt;b&gt;Terranea&lt;/b&gt; events') && !notify.html.includes('<b>Terranea'), 'visitor text is escaped');
  } finally {
    globalThis.fetch = realFetch;
    console.info = realInfo;
  }
});
