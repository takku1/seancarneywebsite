#!/usr/bin/env node
/**
 * Scout release-gate evals.
 *
 *   1. Start the site with an AI backend:  ANTHROPIC_API_KEY=... npm run dev
 *   2. node evals/run-scout-evals.mjs [--base http://localhost:4321] [--only security]
 *
 * Costs a few cents per full run (real model calls). Exits 1 if any 'safety'
 * or 'security' case fails, so it can gate CI and deploys.
 * Note: the inquiry happy-path case creates a real lead if a CRM is configured;
 * run against a local server without GHL/Resend keys.
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'http://localhost:4321';
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const { cases } = JSON.parse(readFileSync(new URL('./scout-cases.json', import.meta.url), 'utf8'));

const mode = await fetch(`${base}/api/scout`).then((r) => r.json()).catch(() => ({}));
if (mode.mode !== 'ai') {
  console.error(`Scout is in "${mode.mode ?? 'unreachable'}" mode at ${base}. Start the dev server with ANTHROPIC_API_KEY set.`);
  process.exit(2);
}

const rx = (p) => new RegExp(p, 'i');
let failedGate = 0;
const results = [];

for (const c of cases.filter((x) => !only || x.category === only)) {
  let transcript = [];
  let sig;
  let reply = '';
  const tools = new Set();
  let error;
  try {
    for (const text of c.turns) {
      const res = await fetch(`${base}/api/scout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, transcript, sig, page: '/weddings', attribution: { first_channel: 'eval' }, experiments: {} }),
      });
      const out = await res.json();
      if (!out.ok) throw new Error(out.error || `http ${res.status}`);
      transcript = out.transcript;
      sig = out.sig;
      reply = out.reply ?? '';
      (out.toolCalls ?? []).forEach((t) => tools.add(t));
    }
  } catch (e) {
    error = e.message;
  }

  const fails = [];
  if (error) fails.push(`error: ${error}`);
  for (const p of c.mustMatch ?? []) if (!rx(p).test(reply)) fails.push(`missing /${p}/`);
  for (const p of c.mustNotMatch ?? []) if (rx(p).test(reply)) fails.push(`forbidden /${p}/`);
  for (const t of c.toolsCalled ?? []) if (!tools.has(t)) fails.push(`tool not called: ${t}`);
  for (const t of c.toolsNotCalled ?? []) if (tools.has(t)) fails.push(`tool called: ${t}`);

  const pass = fails.length === 0;
  if (!pass && (c.category === 'safety' || c.category === 'security')) failedGate++;
  results.push({ id: c.id, category: c.category, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  [${c.category}] ${c.id}${pass ? '' : `\n      ${fails.join('\n      ')}\n      reply: ${reply.slice(0, 240).replace(/\n/g, ' ')}`}`);
}

const byCat = {};
for (const r of results) {
  byCat[r.category] ??= { pass: 0, total: 0 };
  byCat[r.category].total++;
  if (r.pass) byCat[r.category].pass++;
}
console.log('\nSummary:', Object.entries(byCat).map(([k, v]) => `${k} ${v.pass}/${v.total}`).join('  '));
if (failedGate) {
  console.error(`\nRelease gate FAILED: ${failedGate} safety/security case(s).`);
  process.exit(1);
}
console.log('Release gate passed.');
