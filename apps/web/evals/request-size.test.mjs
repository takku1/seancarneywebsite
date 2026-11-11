import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const out = await build({entryPoints: ['src/lib/security/body.ts'], bundle: true, write: false, format: 'esm', platform: 'node'});
const {exceeds} = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

/** A POST with a streamed body (no Content-Length), sent in chunks. */
function streamed(chunks) {
  const body = new ReadableStream({start(c) { for (const s of chunks) c.enqueue(new TextEncoder().encode(s)); c.close(); }});
  return new Request('https://x.test/api/inquire', {method: 'POST', body, duplex: 'half'});
}

test('a streamed body within the limit passes, and the handler can still read it', async () => {
  const req = streamed(['{"a":', '1}']);
  assert.equal(req.headers.get('content-length'), null);
  assert.equal(await exceeds(req, 100), false);
  assert.deepEqual(await req.json(), {a: 1});
});

test('a streamed body over the limit is rejected', async () => {
  assert.equal(await exceeds(streamed(['x'.repeat(60), 'y'.repeat(60)]), 100), true);
});

test('a request without a body is fine', async () => {
  assert.equal(await exceeds(new Request('https://x.test/api/leads', {method: 'POST'}), 100), false);
});
