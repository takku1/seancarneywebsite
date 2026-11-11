import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';

const load = async (entry) => {
  const out = await build({entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node'});
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
};

test('the rate-limit tiers in code match the Cloudflare bindings in wrangler.jsonc', async () => {
  const {RATE_TIERS} = await load('src/lib/security/rate-tiers.ts');
  const jsonc = await readFile('wrangler.jsonc', 'utf8');
  const config = JSON.parse(jsonc.replace(/^\s*\/\/.*$/gm, '')); // full-line comments only
  const bindings = Object.fromEntries(config.ratelimits.map((r) => [r.name, r.simple]));
  for (const [tier, t] of Object.entries(RATE_TIERS)) {
    assert.ok(bindings[t.binding], `${tier}: binding ${t.binding} is declared`);
    assert.deepEqual({limit: bindings[t.binding].limit, period: bindings[t.binding].period}, {limit: t.max, period: t.periodSec}, `${tier} matches ${t.binding}`);
    assert.ok([10, 60].includes(t.periodSec), 'Cloudflare only allows 10 or 60 second periods');
  }
});

test('Scout transcripts are rejected when the signing key is missing, unless explicitly in development', async () => {
  const {signTranscript, verifyTranscript} = await load('src/lib/scout/integrity.ts');
  const transcript = [{role: 'user', content: 'hello'}];
  assert.equal(await verifyTranscript(transcript, '', undefined), false, 'production: fail closed');
  assert.equal(await verifyTranscript(transcript, '', undefined, {allowUnsigned: true}), true, 'development: allowed');

  const key = 'k'.repeat(64);
  const sig = await signTranscript(transcript, key);
  assert.equal(await verifyTranscript(transcript, sig, key), true);
  assert.equal(await verifyTranscript([{role: 'user', content: 'hello!'}], sig, key), false, 'an edited transcript fails');
  assert.equal(await verifyTranscript(transcript, sig, undefined, {allowUnsigned: false}), false);
});
