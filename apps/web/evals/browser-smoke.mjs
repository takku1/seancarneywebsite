/**
 * Browser and runtime smoke test against the production build.
 *   npm run build && npm run test:browser
 *
 * Starts `astro preview` (the real Workers runtime), then:
 * - every page at desktop and phone width: HTTP status, console and script
 *   errors, failed same-origin requests, broken images, sideways scrolling,
 *   exactly one <h1>;
 * - the API guards: Origin required on the inquiry route, the admin route
 *   hidden without its token, oversized and streamed bodies refused.
 *
 * Uses the installed Google Chrome (playwright-core, no browser download);
 * set CHROME_PATH to use another Chromium build. Screenshots: SHOTS=<dir>.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT ?? 4329);
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.SHOTS;
const PAGES = ['/', '/weddings', '/private-events', '/corporate', '/galas', '/estate', '/destination', '/repertoire', '/custom-song', '/the-scene', '/videos', '/about', '/planners', '/venues', '/venues/terranea', '/inquire', '/inquire/thanks', '/links', '/contact', '/privacy', '/terms'];
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };

const WIN = process.platform === 'win32';
// Own process group on POSIX, so the whole tree (npx → astro → workerd) can be stopped together.
const server = spawn(WIN ? 'npx.cmd' : 'npx', ['astro', 'preview', '--port', String(PORT)], { stdio: 'ignore', shell: WIN, detached: !WIN });
/** Stops the preview and everything it started. Synchronous, so it finishes before process.exit. */
const stop = () => {
  try {
    if (WIN) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-server.pid, 'SIGTERM');
  } catch { /* already gone */ }
};

const problems = [];
const fail = (where, what) => { problems.push(`${where}: ${what}`); console.log(`  FAIL ${where}: ${what}`); };

try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(BASE)).ok) break; } catch { /* not up yet */ }
    if (i > 60) throw new Error('preview server did not start (run npm run build first)');
    await new Promise((r) => setTimeout(r, 500));
  }

  // ── API guards in the real runtime ──
  console.log('api');
  const post = (path, init = {}) => fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(init.headers ?? {}) }, body: init.body ?? '{}', ...(init.duplex ? { duplex: 'half' } : {}) });
  const expectStatus = async (name, res, status) => { const got = (await res).status; got === status ? console.log(`  ok   ${name}`) : fail('api', `${name}: expected ${status}, got ${got}`); };
  await expectStatus('inquiry without Origin is refused', post('/api/inquire'), 403);
  await expectStatus('inquiry from another origin is refused', post('/api/inquire', { headers: { origin: 'https://evil.example' } }), 403);
  await expectStatus('inquiry with Origin: null is refused', post('/api/inquire', { headers: { origin: 'null' } }), 403);
  await expectStatus('same-origin inquiry reaches validation', post('/api/inquire', { headers: { origin: BASE } }), 422);
  await expectStatus('admin leads route is hidden without its token', fetch(BASE + '/api/leads'), 404);
  await expectStatus('oversized body is refused', post('/api/inquire', { headers: { origin: BASE }, body: 'x'.repeat(40_000) }), 413);
  const stream = new ReadableStream({ start(c) { for (let i = 0; i < 5; i++) c.enqueue(new TextEncoder().encode('y'.repeat(10_000))); c.close(); } });
  await expectStatus('oversized streamed body is refused', post('/api/inquire', { headers: { origin: BASE }, body: stream, duplex: true }), 413);

  // ── Pages ──
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  for (const [vp, viewport] of Object.entries(VIEWPORTS)) {
    console.log(`pages (${vp})`);
    const ctx = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    for (const path of PAGES) {
      const page = await ctx.newPage();
      const errs = [];
      page.on('console', (m) => { if (m.type() === 'error') errs.push(`console: ${m.text().slice(0, 160)}`); });
      page.on('pageerror', (e) => errs.push(`script: ${e.message.slice(0, 160)}`));
      page.on('response', (r) => { const u = new URL(r.url()); if (u.origin === BASE && r.status() >= 400) errs.push(`${r.status()} ${u.pathname}`); });
      const res = await page.goto(BASE + path, { waitUntil: 'networkidle' });
      await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 30)); } window.scrollTo(0, 0); });
      const info = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        h1: document.querySelectorAll('h1').length,
        broken: [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.getAttribute('src')).map((i) => i.getAttribute('src')).slice(0, 3),
      }));
      if (res?.status() !== 200) errs.push(`status ${res?.status()}`);
      if (info.overflow > 1) errs.push(`scrolls sideways by ${info.overflow}px`);
      if (info.h1 !== 1) errs.push(`${info.h1} <h1> elements`);
      if (info.broken.length) errs.push(`broken images: ${info.broken.join(', ')}`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${(path.slice(1) || 'home').replace(/\//g, '_')}-${vp}.png`, fullPage: true });
      errs.length ? errs.forEach((e) => fail(`${vp} ${path}`, e)) : console.log(`  ok   ${path}`);
      await page.close();
    }
    await ctx.close();
  }
  await browser.close();
} catch (e) {
  fail('run', e.message);
} finally {
  stop();
}

console.log(problems.length ? `\n${problems.length} problem(s)` : '\nall checks passed');
process.exit(problems.length ? 1 : 0);
