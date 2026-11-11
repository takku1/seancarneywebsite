import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';

/**
 * Public copy uses the current offer only: Solo, Duo and Band (The Scene).
 * Retired wording from the artist site must not come back in pages, components
 * or content data. Matching code (Scout's intent regex, feed-title cleanup)
 * is allowed to recognize the old words, so those files are listed.
 */
const RETIRED = /\btrio\b|\bhustlers\b/i;
const ALLOWED = new Set(['src/lib/scout/intents.ts', 'src/lib/feeds/media.ts']);

async function* files(dir) {
  for (const e of await readdir(dir, {withFileTypes: true})) {
    const p = join(dir, e.name).replace(/\\/g, '/');
    if (e.isDirectory()) yield* files(p);
    else if (/\.(astro|ts|json|md|txt)$/.test(e.name)) yield p;
  }
}

test('retired formats and names do not appear in public copy', async () => {
  const hits = [];
  for (const root of ['src', 'public']) {
    for await (const f of files(root)) {
      if (ALLOWED.has(f)) continue;
      (await readFile(f, 'utf8')).split(/\r?\n/).forEach((line, n) => { if (RETIRED.test(line)) hits.push(`${f}:${n + 1}: ${line.trim().slice(0, 100)}`); });
    }
  }
  assert.deepEqual(hits, []);
});
