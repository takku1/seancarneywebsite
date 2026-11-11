import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const out = await build({entryPoints: ['src/lib/security/origin.ts'], bundle: true, write: false, format: 'esm', platform: 'node'});
const {checkOrigin} = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
const SITE = 'https://seancarneymusic.com';

test('the exact same origin passes under both policies', () => {
  assert.equal(checkOrigin('https://seancarneymusic.com', SITE, 'required'), 'ok');
  assert.equal(checkOrigin('https://seancarneymusic.com', SITE, 'if-present'), 'ok');
  assert.equal(checkOrigin('https://seancarneymusic.com:443', SITE, 'required'), 'ok', 'the default port is the same origin');
});

test('a missing Origin is refused on browser-only routes and allowed elsewhere', () => {
  assert.equal(checkOrigin(null, SITE, 'required'), 'missing');
  assert.equal(checkOrigin('', SITE, 'required'), 'missing');
  assert.equal(checkOrigin(null, SITE, 'if-present'), 'ok');
});

test('a different scheme is a different origin', () => {
  for (const policy of ['required', 'if-present']) assert.equal(checkOrigin('http://seancarneymusic.com', SITE, policy), 'mismatch', policy);
  assert.equal(checkOrigin('https://localhost:4321', 'http://localhost:4321', 'required'), 'mismatch');
  assert.equal(checkOrigin('http://localhost:4321', 'http://localhost:4321', 'required'), 'ok');
});

test('cross-origin, null, malformed and look-alike origins are rejected under both policies', () => {
  for (const policy of ['required', 'if-present']) {
    for (const bad of ['https://evil.example', 'null', 'not a url', 'https://seancarneymusic.com.evil.example', 'https://evil.example/seancarneymusic.com', 'https://seancarneymusic.com:8443', 'https://www.seancarneymusic.com', 'file:///etc/passwd']) {
      assert.equal(checkOrigin(bad, SITE, policy), 'mismatch', `${policy}: ${bad}`);
    }
  }
});
