// Inventory the built public reference; this is not an import or deploy command.
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = resolve(root, 'apps/web');
const client = resolve(web, 'dist/client');
const out = resolve(root, 'reports/shabam-prep');
async function walk(dir) {
  const rows = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) rows.push(...await walk(path));
    else if (entry.isFile()) rows.push(path);
  }
  return rows.sort();
}
const files = await walk(client).catch(() => { throw new Error('Build the reference first: cd apps/web && npm run build'); });
const pages = [], assets = [];
for (const path of files) {
  const name = relative(client, path).replaceAll('\\', '/');
  const bytes = await readFile(path);
  if (name.endsWith('.html')) {
    const html = bytes.toString('utf8');
    const match = (pattern) => html.match(pattern)?.[1] ?? '';
    pages.push({ route: name === 'index.html' ? '/' : '/' + name.replace(/\.html$/, ''), file: name,
      title: match(/<title[^>]*>([\s\S]*?)<\/title>/i),
      description: match(/<meta\s+name="description"\s+content="([^"]*)"/i),
      canonical: match(/<link\s+rel="canonical"\s+href="([^"]*)"/i),
      noindex: /<meta[^>]*name="robots"[^>]*content="[^"]*noindex/i.test(html),
      redirectReference: /http-equiv="refresh"/i.test(html),
      nativePageId: '', previewUrl: '', acceptance: 'pending' });
  } else {
    assets.push({ path: '/' + name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
}
const config = await readFile(resolve(web, 'astro.config.mjs'), 'utf8');
const redirectBlock = config.split('redirects: {')[1]?.split('\n  },')[0];
if (!redirectBlock) throw new Error('Redirect config changed; inspect before producing a handoff');
const redirects = [...redirectBlock.matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)].map((m) => ({ from: m[1], to: m[2], status: 301, verified: false }));
const plannerPack = JSON.parse(await readFile(resolve(web, 'src/data/planner-pack.json'), 'utf8'));
await mkdir(out, { recursive: true });
await writeFile(resolve(out, 'inventory.json'), JSON.stringify({ generatedAt: new Date().toISOString(),
  notice: 'Reference inventory only. Not a SHA-BAM import. Build freshness and native parity require separate verification. Metadata retains HTML entity encoding.',
  pages, redirects, assets, plannerPack }, null, 2) + '\n');
await writeFile(resolve(out, 'README.txt'), 'SHA-BAM migration reference inventory\n\nUse inventory.json alongside docs/current/18-sha-bam-setup-kit.md.\nNo credentials, private source media, server bundle or customer records are included.\nDo not upload the Astro output as a working SHA-BAM app: its API endpoints need native replacements.\nRecord native page IDs, preview URLs and acceptance in a separate working copy.\n');
console.log(`${pages.length} page references, ${redirects.length} redirects, ${assets.length} public assets inventoried in reports/shabam-prep`);
