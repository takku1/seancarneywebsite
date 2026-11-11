import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

/** Bundles a module with Astro/Cloudflare virtual modules stubbed; env comes from globalThis.__env. */
async function load(entry) {
  const stubs = {
    name: 'stubs',
    setup(b) {
      b.onResolve({filter: /^(astro:env\/server|cloudflare:workers|astro:content)$/}, (a) => ({path: a.path, namespace: 'stub'}));
      b.onLoad({filter: /.*/, namespace: 'stub'}, (a) => ({
        contents: a.path === 'cloudflare:workers' ? 'export const env = {};'
          : a.path === 'astro:content' ? 'export const getCollection = async () => [];'
          : `const e = globalThis.__env ?? {}; export const {${['SCOUT_PROVIDER', 'ANTHROPIC_API_KEY', 'SCOUT_MODEL', 'SCOUT_SIGNING_KEY', 'SCOUT_DAILY_LIMIT', 'SCOUT_ADMIN_TOKEN', 'GHL_WEBHOOK_URL', 'GHL_PRIVATE_TOKEN', 'GHL_LOCATION_ID', 'GHL_PIPELINE_ID', 'GHL_STAGE_NEW_ID', 'RESEND_API_KEY', 'INQUIRY_NOTIFY_EMAIL', 'INQUIRY_FROM_EMAIL', 'LOG_HASH_KEY', 'GOOGLE_SA_EMAIL', 'GOOGLE_SA_PRIVATE_KEY', 'GOOGLE_CALENDAR_IDS', 'GOOGLE_HOLD_CALENDAR_IDS', 'AVAILABILITY_TIMEZONE'].join(',')}} = e;`,
        loader: 'js',
      }));
    },
  };
  const out = await build({entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node', plugins: [stubs], define: {'import.meta.env.DEV': 'false'}, logLevel: 'error'});
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
}

test('the mode rule: AI needs a provider, and in production a signing key', async () => {
  const {resolveScoutMode} = await load('src/lib/scout/mode.ts');
  assert.deepEqual(resolveScoutMode({hasProvider: false, hasSigningKey: true, dev: false}), {mode: 'guided', reason: 'no_provider'});
  assert.deepEqual(resolveScoutMode({hasProvider: true, hasSigningKey: false, dev: false}), {mode: 'guided', reason: 'signing_key_missing'});
  assert.deepEqual(resolveScoutMode({hasProvider: true, hasSigningKey: false, dev: true}), {mode: 'ai'});
  assert.deepEqual(resolveScoutMode({hasProvider: true, hasSigningKey: true, dev: false}), {mode: 'ai'});
});

test('GET and POST /api/scout agree: provider configured but no signing key means guided in production', async () => {
  globalThis.__env = {ANTHROPIC_API_KEY: 'sk-test-not-used'}; // provider configured, SCOUT_SIGNING_KEY missing
  const errors = [];
  const realError = console.error;
  console.error = (line) => errors.push(String(line));
  try {
    const {GET, POST} = await load('src/pages/api/scout.ts');
    const get = await (await GET({})).json();
    const req = new Request('https://seancarneymusic.com/api/scout', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({text: 'hello'})});
    const post = await (await POST({request: req, locals: {}})).json();
    assert.equal(get.mode, 'guided', 'the panel is not offered AI');
    assert.equal(post.mode, 'guided');
    assert.ok(errors.some((l) => l.includes('scout_signing_key_missing')), 'the misconfiguration is logged');
    assert.equal(errors.filter((l) => l.includes('scout_signing_key_missing')).length, 1, 'once per isolate, not per request');
  } finally {
    console.error = realError;
  }
});
