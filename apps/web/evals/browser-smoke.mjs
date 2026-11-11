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
 * - inquiry journeys at phone width: a refused submission keeps the answers
 *   and shows the direct email; an accepted one lands on the thank-you page;
 *   a 503 never shows success; a stale availability answer never reappears
 *   after the date is cleared. Server delivery itself is covered by the unit
 *   tests and on staging (scripts/staging.sh).
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

  // ── Inquiry journeys (phone width) ──
  console.log('inquiry journeys');
  const journey = async (name, fn) => {
    const ctx = await browser.newContext({ viewport: VIEWPORTS.phone, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(`script: ${e.message.slice(0, 160)}`));
    try { await fn(page); } catch (e) { errs.push(e.message.split('\n')[0]); }
    errs.length ? errs.forEach((e) => fail(`journey: ${name}`, e)) : console.log(`  ok   ${name}`);
    await ctx.close();
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  /** Walks all five steps like a visitor. Waits past the 4-second minimum fill time. */
  const fillInquiry = async (page) => {
    await page.goto(`${BASE}/inquire`, { waitUntil: 'networkidle' });
    const t0 = Date.now();
    await choose(page, 'event_type', 'wedding');
    await page.locator('#location').waitFor({ state: 'visible' });
    await page.locator('input[name="date_flexible"]').check();
    await page.fill('#location', 'Santa Barbara');
    await page.click('[data-next]');
    await page.locator('#guests').waitFor({ state: 'visible' });
    await page.click('[data-next]');
    await choose(page, 'budget', 'discuss');
    await page.click('[data-next]');
    await page.locator('#name').waitFor({ state: 'visible' });
    await page.fill('#name', 'Journey Test');
    await page.fill('#email', 'journey@example.com');
    await page.selectOption('#role', 'couple');
    await page.waitForTimeout(Math.max(0, 4500 - (Date.now() - t0)));
  };
  /** Clicks the visible label of a radio or checkbox choice, as a visitor would. */
  async function choose(page, name, value) { await page.locator('label.choice', { has: page.locator(`input[name="${name}"][value="${value}"]`) }).click(); }
  const formError = (page) => page.locator('.form-error, [data-form-error]').first();

  await journey('a refused submission keeps the answers and shows the direct email', async (page) => {
    // The preview has no Turnstile secret, so production rules refuse the inquiry (403).
    await fillInquiry(page);
    const [res] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/inquire')), page.click('[data-submit]')]);
    assert(res.status() === 403, `expected 403, got ${res.status()}`);
    const err = formError(page);
    await err.waitFor({ state: 'visible', timeout: 5000 });
    assert(/@/.test(await err.innerText()), 'the error names the direct email address');
    assert((await page.inputValue('#name')) === 'Journey Test', 'the answers are kept');
    assert(await page.locator('[data-submit]').isEnabled(), 'Send can be tried again');
  });

  await journey('an accepted inquiry lands on the thank-you page with honest wording', async (page) => {
    await page.route('**/api/inquire', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, leadId: 'SC-JOURNEY', tier: 'B' }) }));
    await fillInquiry(page);
    await page.click('[data-submit]');
    await page.waitForURL(/\/inquire\/thanks/, { timeout: 10_000 });
    const h1 = await page.locator('h1').innerText();
    assert(/received/i.test(h1), `thank-you heading: ${h1}`);
    assert(!/on its way to your inbox/i.test(await page.locator('.lede').innerText()), 'no promise that the email already left');
  });

  await journey('a 503 (nothing stored) never shows success', async (page) => {
    await page.route('**/api/inquire', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'delivery_failed' }) }));
    await fillInquiry(page);
    await page.click('[data-submit]');
    await formError(page).waitFor({ state: 'visible', timeout: 5000 });
    assert(!/thanks/.test(page.url()), 'stays on the form');
  });

  await journey('clearing the date hides a slow, stale availability answer', async (page) => {
    await page.route('**/api/availability**', async (r) => { await new Promise((ok) => setTimeout(ok, 1200)); await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'tentative' }) }); });
    await page.goto(`${BASE}/inquire`, { waitUntil: 'networkidle' });
    await choose(page, 'event_type', 'wedding');
    await page.locator('#event_date').waitFor({ state: 'visible' });
    await page.fill('#event_date', '2031-06-14');
    await page.fill('#event_date', '');
    await page.dispatchEvent('#event_date', 'change');
    await page.waitForTimeout(2000);
    assert(await page.locator('[data-avail]').isHidden(), 'a stale answer reappeared after the date was cleared');
    // And a real answer still shows.
    await page.fill('#event_date', '2031-06-15');
    await page.locator('[data-avail]').waitFor({ state: 'visible', timeout: 5000 });
    assert(/will check/.test(await page.locator('[data-avail]').innerText()), 'tentative wording');
  });

  await browser.close();
} catch (e) {
  fail('run', e.message);
} finally {
  stop();
}

console.log(problems.length ? `\n${problems.length} problem(s)` : '\nall checks passed');
process.exit(problems.length ? 1 : 0);
