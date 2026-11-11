import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const out = await build({entryPoints: ['src/lib/security/origin.ts'], bundle: true, write: false, format: 'esm', platform: 'node'});
const {checkOrigin} = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
const HOST = 'seancarneymusic.com';

test('same origin passes under both policies', () => {
  assert.equal(checkOrigin('https://seancarneymusic.com', HOST, 'required'), 'ok');
  assert.equal(checkOrigin('https://seancarneymusic.com', HOST, 'if-present'), 'ok');
});

test('a missing Origin is refused on browser-only routes and allowed elsewhere', () => {
  assert.equal(checkOrigin(null, HOST, 'required'), 'missing');
  assert.equal(checkOrigin('', HOST, 'required'), 'missing');
  assert.equal(checkOrigin(null, HOST, 'if-present'), 'ok');
});

test('cross-origin, null, malformed and look-alike origins are rejected under both policies', () => {
  for (const policy of ['required', 'if-present']) {
    for (const bad of ['https://evil.example', 'null', 'not a url', 'https://seancarneymusic.com.evil.example', 'https://evil.example/seancarneymusic.com', 'https://seancarneymusic.com:8443']) {
      assert.equal(checkOrigin(bad, HOST, policy), 'mismatch', `${policy}: ${bad}`);
    }
  }
});
