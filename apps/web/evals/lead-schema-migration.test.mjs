import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';

/**
 * Upgrading a lead table created by an earlier version: columns are added,
 * existing leads are kept and still recovered. Schemas below are copied from
 * the commits that created them.
 */
const out = await build({entryPoints: ['src/lib/inquiry/deliver.ts'], bundle: true, write: false, format: 'esm', platform: 'node'});
const {ensureSchema, retryOpen, listOpen, RETRY_SPACING_MS} = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

/** D1's API over a shared SQLite database; each wrapper stands for a separate Worker instance. */
function d1(raw) {
  const tick = () => new Promise((r) => setImmediate(r));
  return {
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

/** a7fc136: the first D1 version (no leases, no confirm retries). */
const V1 = `CREATE TABLE leads (lead_id TEXT PRIMARY KEY, idem_key TEXT UNIQUE, channel TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL,
  crm TEXT NOT NULL DEFAULT 'pending', crm_error TEXT, crm_attempts INTEGER NOT NULL DEFAULT 0, crm_progress TEXT NOT NULL DEFAULT '{}',
  notify TEXT NOT NULL DEFAULT 'pending', notify_error TEXT, notify_attempts INTEGER NOT NULL DEFAULT 0, confirm TEXT NOT NULL DEFAULT 'pending')`;
/** 1a1ce99: leases, before last_attempt_at. */
const V3 = `CREATE TABLE leads (lead_id TEXT PRIMARY KEY, idem_key TEXT UNIQUE, channel TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL,
  crm TEXT NOT NULL DEFAULT 'pending', crm_error TEXT, crm_attempts INTEGER NOT NULL DEFAULT 0, crm_lease TEXT, crm_lease_until INTEGER, crm_progress TEXT NOT NULL DEFAULT '{}',
  notify TEXT NOT NULL DEFAULT 'pending', notify_error TEXT, notify_attempts INTEGER NOT NULL DEFAULT 0, notify_lease TEXT, notify_lease_until INTEGER,
  confirm TEXT NOT NULL DEFAULT 'pending', confirm_error TEXT, confirm_attempts INTEGER NOT NULL DEFAULT 0, confirm_lease TEXT, confirm_lease_until INTEGER)`;

const NOW = Date.UTC(2026, 10, 10, 12);
const data = JSON.stringify({inquiry: {email: 'couple@example.com', name: 'Ada'}, lead: {tier: 'A'}});
function oldDb(ddl) {
  const raw = new DatabaseSync(':memory:');
  raw.exec(ddl);
  raw.prepare(`INSERT INTO leads (lead_id, idem_key, channel, created_at, data, crm, crm_attempts) VALUES ('SC-old1', 'evt-1', 'form', ?, ?, 'failed', 1)`).run(new Date(NOW - 3_600_000).toISOString(), data);
  raw.prepare(`INSERT INTO leads (lead_id, idem_key, channel, created_at, data, crm) VALUES ('SC-old2', 'evt-2', 'form', ?, ?, 'skipped')`).run(new Date(NOW - 1_800_000).toISOString(), data);
  return raw;
}
const columns = (raw) => raw.prepare('PRAGMA table_info(leads)').all().map((c) => c.name);

for (const [label, ddl] of [['previous schema (1a1ce99)', V3], ['first D1 schema (a7fc136)', V1]]) {
  test(`a table from the ${label} is upgraded in place and its leads are still recovered`, {timeout: 10_000}, async () => {
    const raw = oldDb(ddl);
    const db = d1(raw);
    await ensureSchema(db);
    for (const c of ['last_attempt_at', 'crm_lease', 'crm_lease_until', 'notify_lease', 'confirm_attempts', 'confirm_lease_until']) {
      assert.ok(columns(raw).includes(c), `${c} added`);
    }
    const kept = raw.prepare('SELECT lead_id, crm, crm_attempts, confirm_attempts, last_attempt_at FROM leads ORDER BY lead_id').all();
    assert.deepEqual(kept.map((r) => [r.lead_id, r.crm, r.crm_attempts, r.confirm_attempts, r.last_attempt_at]),
      [['SC-old1', 'failed', 1, 0, null], ['SC-old2', 'skipped', 0, 0, null]], 'rows kept, new columns at their defaults');

    assert.deepEqual((await listOpen(db, {now: NOW})).leads.map((l) => l.leadId), ['SC-old1', 'SC-old2']);
    const sent = [];
    const r = await retryOpen({db, sendToCrm: async (rec) => { sent.push(rec.leadId); }, notifyOwner: null, confirmVisitor: null, log: () => {}, now: () => NOW});
    assert.equal(r.processed, 2, 'the retry query runs against the upgraded table');
    assert.deepEqual(sent.sort(), ['SC-old1', 'SC-old2']);
    assert.ok(raw.prepare("SELECT last_attempt_at FROM leads WHERE lead_id = 'SC-old1'").get().last_attempt_at > 0);
  });
}

test('two Worker instances upgrading the same table at once both succeed', {timeout: 10_000}, async () => {
  const raw = oldDb(V3);
  await Promise.all([ensureSchema(d1(raw)), ensureSchema(d1(raw)), ensureSchema(d1(raw))]);
  assert.equal(columns(raw).filter((c) => c === 'last_attempt_at').length, 1);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 2);
});

test('a current table is left unchanged', {timeout: 10_000}, async () => {
  const raw = new DatabaseSync(':memory:');
  await ensureSchema(d1(raw));
  const before = columns(raw);
  await ensureSchema(d1(raw));
  assert.deepEqual(columns(raw), before);
  assert.ok(RETRY_SPACING_MS > 0);
});
