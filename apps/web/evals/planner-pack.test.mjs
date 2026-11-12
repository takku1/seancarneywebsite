import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';

const pack = JSON.parse(readFileSync(new URL('../src/data/planner-pack.json', import.meta.url), 'utf8'));

test('planner pack ids are unique and every entry is complete', () => {
  assert.equal(new Set(pack.map((d) => d.id)).size, pack.length);
  for (const d of pack) {
    assert.ok(d.id && d.title && d.description, `incomplete entry ${JSON.stringify(d)}`);
    assert.equal(typeof d.public, 'boolean', `${d.id}: public must be true or false`);
  }
});

test('private documents (insurance, tax forms) are never published', () => {
  for (const d of pack.filter((x) => !x.public)) assert.equal(d.file, undefined, `${d.id} is private but has a public file`);
  for (const id of ['coi', 'w9']) assert.equal(pack.find((d) => d.id === id)?.public, false, `${id} must stay private`);
});

test('every published file exists under public/downloads/', () => {
  for (const d of pack.filter((x) => x.file)) {
    assert.match(d.file, /^\/downloads\/[\w./-]+$/, `${d.id}: files live in /downloads/`);
    assert.ok(existsSync(new URL(`../public${d.file}`, import.meta.url)), `${d.id}: missing public${d.file}`);
  }
});
