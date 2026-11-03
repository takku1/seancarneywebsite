/**
 * Owns the site's CSP hashes (ASVS 3.4.3).
 *
 * After the build, this hashes (SHA-256) the exact contents of every inline
 * <script> and <style> in every page, and replaces the `'csp-script-hashes'` and
 * `'csp-style-hashes'` placeholders in the built _headers. The single header
 * policy therefore allows exactly the inline code the site ships, and nothing
 * else, with no 'unsafe-inline'.
 *
 * The build fails (fail closed) if placeholders remain, no scripts are found,
 * an inline style attribute appears, or a line exceeds Cloudflare's
 * 2,000-character _headers limit (an oversized line is silently dropped,
 * which would ship the site with no CSP at all).
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const INLINE_SCRIPT = /<script\b(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
const INLINE_STYLE = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
const STYLE_ATTR = /<[a-z][^>]*\sstyle="[^"]*"/i;
const DATA_TYPES = /type=["']?application\/(ld\+)?json/i; // data blocks never execute

const sha256 = (s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;

async function htmlFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await htmlFiles(p)));
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

export default function cspHeaderHashes() {
  return {
    name: 'csp-header-hashes',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        const scripts = new Set();
        const styles = new Set();
        for (const file of await htmlFiles(root)) {
          const html = await readFile(file, 'utf8');
          for (const [, attrs, body] of html.matchAll(INLINE_SCRIPT)) {
            if (!DATA_TYPES.test(attrs) && body.trim()) scripts.add(sha256(body));
          }
          for (const [, body] of html.matchAll(INLINE_STYLE)) if (body.trim()) styles.add(sha256(body));
          const attr = html.match(STYLE_ATTR);
          if (attr) throw new Error(`csp-header-hashes: inline style attribute in ${file}: ${attr[0].slice(0, 80)} (move it to a class)`);
        }
        if (!scripts.size) throw new Error('csp-header-hashes: no inline scripts found in built pages');
        const path = join(root, '_headers');
        let headers = await readFile(path, 'utf8');
        headers = headers
          .replace("'csp-script-hashes'", [...scripts].sort().join(' '))
          .replace("'csp-style-hashes'", [...styles].sort().join(' '));
        if (headers.includes("'csp-")) throw new Error('csp-header-hashes: unreplaced placeholder in _headers');
        const long = headers.split(/\r?\n/).find((l) => l.length > 2000);
        if (long) throw new Error(`csp-header-hashes: a _headers line is ${long.length} chars (Cloudflare limit 2000): ${long.slice(0, 60)}...`);
        await writeFile(path, headers);
        logger.info(`CSP header: ${scripts.size} script and ${styles.size} style hashes`);
      },
    },
  };
}
