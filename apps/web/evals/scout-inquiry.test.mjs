import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';

/**
 * Scout inquiries: the model prepares, the visitor sends.
 * - submit_inquiry (called by the model) creates no lead, only a signed draft;
 * - POST /api/scout/inquire (the visitor's Send click) creates the lead, once,
 *   however often the same inquiry is sent or prepared.
 * Real modules, with Astro/Cloudflare virtual modules stubbed and D1 backed by SQLite.
 */
const ENV_NAMES = ['SCOUT_PROVIDER', 'ANTHROPIC_API_KEY', 'SCOUT_MODEL', 'SCOUT_SIGNING_KEY', 'SCOUT_DAILY_LIMIT', 'SCOUT_ADMIN_TOKEN', 'GHL_WEBHOOK_URL', 'GHL_PRIVATE_TOKEN', 'GHL_LOCATION_ID', 'GHL_PIPELINE_ID', 'GHL_STAGE_NEW_ID', 'RESEND_API_KEY', 'INQUIRY_NOTIFY_EMAIL', 'INQUIRY_FROM_EMAIL', 'LOG_HASH_KEY', 'GOOGLE_SA_EMAIL', 'GOOGLE_SA_PRIVATE_KEY', 'GOOGLE_CALENDAR_IDS', 'AVAILABILITY_TIMEZONE'];
const stubs = {
  name: 'stubs',
  setup(b) {
    b.onResolve({filter: /^(astro:env\/server|cloudflare:workers|astro:content)$/}, (a) => ({path: a.path, namespace: 'stub'}));
    b.onLoad({filter: /.*/, namespace: 'stub'}, (a) => ({
      contents: a.path === 'cloudflare:workers' ? 'export const env = new Proxy({}, { get: (_, k) => globalThis.__cf?.[k] });'
        : a.path === 'astro:content' ? 'export const getCollection = async () => [];'
        : `const e = globalThis.__env ?? {}; export const {${ENV_NAMES.join(',')}} = e;`,
      loader: 'js',
    }));
  },
};
async function load(entry) {
  const out = await build({entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node', plugins: [stubs], define: {'import.meta.env.DEV': 'false'}, logLevel: 'error'});
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
}

function d1() {
  const raw = new DatabaseSync(':memory:');
  const tick = () => new Promise((r) => setImmediate(r));
  return {
    raw,
    prepare(sql) {
      return {bind(...v) {
        return {
          async run() { await tick(); return {meta: {changes: Number(raw.prepare(sql).run(...v).changes)}}; },
          async first() { await tick(); return raw.prepare(sql).get(...v) ?? null; },
          async all() { await tick(); return {results: raw.prepare(sql).all(...v)}; },
        };
      }};
    },
  };
}
const leads = (db) => { try { return Number(db.raw.prepare('SELECT COUNT(*) AS n FROM leads').get().n); } catch { return 0; } };

const SECRET = 's'.repeat(64);
const ARGS = {visitor_confirmed: true, name: 'Ada Lovelace', email: 'ada@example.com', event_type: 'wedding', event_date: '2027-09-18', location: 'Malibu', budget: 'discuss', role: 'couple'};
const CTX = {attribution: {}, experiments: {}, page: '/weddings', visitorText: 'I am Ada, ada@example.com'};
const send = (POST, token) => POST({request: new Request('https://seancarneymusic.com/api/scout/inquire', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({token})}), locals: {}});

/** Fresh environment: D1, signing key, a stand-in CRM webhook that counts calls. */
function setup() {
  const db = d1();
  globalThis.__cf = {LEADS_DB: db};
  globalThis.__env = {SCOUT_SIGNING_KEY: SECRET, GHL_WEBHOOK_URL: 'https://hooks.example/lead'};
  const crm = [];
  globalThis.fetch = async (url, init) => { crm.push(JSON.parse(init.body).lead_id); return new Response('ok'); };
  console.info = () => {};
  return {db, crm};
}
const realFetch = globalThis.fetch;
const realInfo = console.info;
const restore = () => { globalThis.fetch = realFetch; console.info = realInfo; };

// Env values are read when a module loads, so they are set before loading.
globalThis.__env = {SCOUT_SIGNING_KEY: SECRET, GHL_WEBHOOK_URL: 'https://hooks.example/lead'};
const {executeTool} = await load('src/lib/scout/tools.ts');
const {POST} = await load('src/pages/api/scout/inquire.ts');

test('the model calling submit_inquiry creates no lead: it only prepares a signed draft', {timeout: 10_000}, async () => {
  const {db, crm} = setup();
  try {
    const out = await executeTool('submit_inquiry', ARGS, CTX);
    assert.equal(JSON.parse(out.result).prepared, true);
    assert.equal(out.card.kind, 'inquiry_confirm');
    assert.match(out.card.token, /^[\w-]+\.[0-9a-f]{64}$/);
    assert.equal(out.card.summary.email, 'ada@example.com');
    assert.equal(leads(db), 0, 'no lead row');
    assert.equal(crm.length, 0, 'nothing sent anywhere');
  } finally { restore(); }
});

test('the visitor pressing Send twice (or a retry) creates one lead and one delivery', {timeout: 10_000}, async () => {
  const {db, crm} = setup();
  try {
    const {card} = await executeTool('submit_inquiry', ARGS, CTX);
    const first = await (await send(POST, card.token)).json();
    const again = await (await send(POST, card.token)).json();
    assert.equal(first.ok, true);
    assert.equal(again.leadId, first.leadId, 'the same lead');
    assert.equal(leads(db), 1);
    assert.deepEqual(crm, [first.leadId], 'one CRM delivery');
  } finally { restore(); }
});

test('a simultaneous double-click creates one lead', {timeout: 10_000}, async () => {
  const {db, crm} = setup();
  try {
    const {card} = await executeTool('submit_inquiry', ARGS, CTX);
    const [a, b] = await Promise.all([send(POST, card.token), send(POST, card.token)].map(async (p) => (await p).json()));
    assert.equal(a.leadId, b.leadId);
    assert.equal(leads(db), 1);
    assert.equal(crm.length, 1);
  } finally { restore(); }
});

test('the same details prepared again the same day still yield one lead', {timeout: 10_000}, async () => {
  const {db, crm} = setup();
  try {
    const one = (await executeTool('submit_inquiry', ARGS, CTX)).card.token;
    const two = (await executeTool('submit_inquiry', ARGS, {...CTX, page: '/about'})).card.token; // context differs, content doesn't
    assert.notEqual(one, two, 'two different drafts');
    const r1 = await (await send(POST, one)).json();
    const r2 = await (await send(POST, two)).json();
    assert.equal(r2.leadId, r1.leadId);
    assert.equal(leads(db), 1);
    assert.equal(crm.length, 1);
  } finally { restore(); }
});

test('same planner, same event, updated details: a new lead, and Sean receives the update', {timeout: 10_000}, async () => {
  const {db, crm} = setup();
  try {
    const original = (await executeTool('submit_inquiry', {...ARGS, budget: 'discuss'}, CTX)).card.token;
    const updated = (await executeTool('submit_inquiry', {...ARGS, budget: '20k_40k', guests: '150 to 300', message: 'Now adding a ceremony set'}, CTX)).card.token;
    const r1 = await (await send(POST, original)).json();
    const r2 = await (await send(POST, updated)).json();
    assert.notEqual(r2.leadId, r1.leadId, 'the follow-up is not swallowed as a duplicate');
    assert.equal(leads(db), 2);
    assert.deepEqual(crm, [r1.leadId, r2.leadId], 'both reached the CRM');
    const stored = JSON.parse(db.raw.prepare('SELECT data FROM leads WHERE lead_id = ?').get(r2.leadId).data).inquiry;
    assert.equal(stored.budget, '20k_40k', 'with the updated details');
  } finally { restore(); }
});

test('identical details sent on a later day are a new inquiry', {timeout: 10_000}, async () => {
  const {db, crm} = setup();
  try {
    const {signDraft} = await load('src/lib/scout/draft.ts');
    const {card} = await executeTool('submit_inquiry', ARGS, CTX);
    const inquiry = JSON.parse(Buffer.from(card.token.split('.')[0], 'base64url').toString()).inquiry;
    const r1 = await (await send(POST, card.token)).json();
    // Sent through a draft prepared a day later (valid now: its 30-minute window is open).
    const tomorrow = await signDraft(inquiry, SECRET, Date.now() + 86_400_000 - 60_000);
    const later = JSON.parse(Buffer.from(tomorrow.split('.')[0], 'base64url').toString());
    assert.notEqual(later.key, JSON.parse(Buffer.from(card.token.split('.')[0], 'base64url').toString()).key);
    const r2 = await (await send(POST, tomorrow)).json();
    assert.notEqual(r2.leadId, r1.leadId);
    assert.equal(leads(db), 2);
    assert.equal(crm.length, 2);
  } finally { restore(); }
});

test('the key covers content, not context: page and attribution do not change it, any detail does', {timeout: 10_000}, async () => {
  const {inquiryKey} = await load('src/lib/scout/draft.ts');
  const t = Date.UTC(2026, 10, 11, 12);
  const base = {...ARGS, attribution: {}, experiments: {}, page: '/weddings'};
  const k = await inquiryKey(base, SECRET, t);
  assert.equal(await inquiryKey({...base, page: '/about', attribution: {first_channel: 'instagram'}}, SECRET, t), k);
  assert.equal(await inquiryKey({...base, email: ' ADA@example.com '}, SECRET, t), k, 'case and whitespace are not content');
  assert.equal(await inquiryKey(base, SECRET, t + 3_600_000), k, 'later the same UTC day');
  for (const change of [{budget: '20k_40k'}, {guests: '150 to 300'}, {format: 'band'}, {message: 'add a ceremony set'}, {event_date: '2027-09-19'}, {phone: '555-0100'}]) {
    assert.notEqual(await inquiryKey({...base, ...change}, SECRET, t), k, JSON.stringify(change));
  }
  assert.notEqual(await inquiryKey(base, SECRET, t + 86_400_000), k, 'the next day');
});

test('a tampered or forged draft is refused and creates nothing', {timeout: 10_000}, async () => {
  const {db, crm} = setup();
  try {
    const {card} = await executeTool('submit_inquiry', ARGS, CTX);
    const [body, sig] = card.token.split('.');
    const forged = JSON.parse(Buffer.from(body, 'base64url').toString());
    forged.inquiry.email = 'victim@example.com';
    const tampered = `${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${sig}`;
    for (const t of [tampered, 'not-a-token', `${body}.${'0'.repeat(64)}`, undefined]) {
      const res = await send(POST, t);
      assert.equal(res.status, 400, String(t).slice(0, 30));
    }
    assert.equal(leads(db), 0);
    assert.equal(crm.length, 0);
  } finally { restore(); }
});

test('drafts expire after 30 minutes', {timeout: 10_000}, async () => {
  const {signDraft, verifyDraft, DRAFT_TTL_MS} = await load('src/lib/scout/draft.ts');
  const t0 = Date.UTC(2026, 10, 11, 12);
  const token = await signDraft({email: 'a@b.co', event_type: 'wedding', location: 'Malibu'}, SECRET, t0);
  assert.equal((await verifyDraft(token, SECRET, t0 + DRAFT_TTL_MS - 1)).ok, true);
  assert.deepEqual(await verifyDraft(token, SECRET, t0 + DRAFT_TTL_MS + 1), {ok: false, error: 'expired'});
  assert.deepEqual(await verifyDraft(token, 'another-secret', t0), {ok: false, error: 'bad_signature'});
});
