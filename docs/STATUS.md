# STATUS: Sean Carney website rebuild

**Current Phase:** Build, first full version running locally (`apps/web`). Pre-launch: content confirmation and account setup.

**Active Focus:** Production pass done (2026-11-03): fan funnel and marketing layer added (release smart-link pages, owned fan list, engagement prompt, `/links`, press downloads + one-sheet). Next: connect real accounts (GHL incl. the `notify:news` workflow, Google Calendar, Resend, Anthropic, YouTube/Spotify/Instagram, KV), run the Scout evals with a key, add DMARC, and work through the launch checklist (Cloudflare dashboard items: WAF rule, Access on insights, TLS 1.2, HSTS preload).

**Architecture Summary:** Astro 7.4 static site (`apps/web`) on the Cloudflare adapter. Pages are prerendered (`build.format: 'file'`, so /music is served without a redirect) and swapped by Astro's ClientRouter, with Scout and a video player dock persisting across pages; the Worker runs only the APIs: `/api/inquire` (shared lead pipeline: score → GoHighLevel → Resend), `/api/availability` (Google Calendar free/busy), `/api/scout*` (concierge, trending questions, insights) `/api/signal` and `/api/csp-report`, all behind `src/middleware.ts`. Content lives in typed collections (`src/data/*.json`); each release gets a generated smart-link page (`/music/<id>`), merged at build with ranked YouTube/Spotify/Instagram data by the media pipeline (`src/lib/feeds`). First-party analytics: declarative tracking, first and last touch attribution on every lead, cookieless A/B tests. The site has two zones: the artist zone (dark, cinematic) and the events zone (ivory by default, A/B-tested against dark).

**Key Decisions:**
- 2026-11-01: Architectural overhaul, not a clone; the old site is used as evidence only.
- 2026-11-01: Astro 7 + Cloudflare; Sanity deferred until the content model settles (JSON collections now).
- 2026-11-01: GoHighLevel stays the CRM hub (API v2, webhook fallback); Google Calendar is the date source of truth (free/busy only).
- 2026-11-01: Event pages are composed from per-type blocks (`events.json`), not one template.
- 2026-11-01: "As seen on" logo marquee on the home page only.
- 2026-11-01: The events-zone theme is decided by data (`events_theme` experiment), not taste.
- 2026-11-01: The hidden "Sean Carney Luxury Events" sub-site was found and merged in; Sean's own claims are treated as true, and online research added *Songland* details, luxury rooms and newer releases.
- 2026-11-01: The media pipeline ranks content at build time (newest / most watched / best for events), with curated pins and fallbacks.
- 2026-11-01: Scout concierge, provider-agnostic: guided mode with no AI, Claude adapter when keyed. Governed by OWASP LLM/Agentic Top 10 and NIST AI RMF; CA bot-disclosure / CCPA / EU AI Act Art. 50 compliant; outside SB 243 by design. Launched by a guitar-pick button.

- 2026-11-02: Security baseline against OWASP ASVS 5.0 via AuditForge (`docs/security/SECURITY.md`): API middleware (method/origin/content-type/rate-limit tiers bound in `wrangler.jsonc`), structured security logs, enforced header CSP with build-computed SHA-256 hashes (no unsafe-inline), request-size limits, a single admin auth gate, GA4/Clarity/Meta only after consent, one storage helper with a clear-data control, DOM-only rendering in Scout. AuditForge (run 3, 53 rules + DAST): 0 findings at LOW, no baseline.

- 2026-11-03: Two funnels, measured separately: booking (north star `inquiry_submit`) and fan (north star `notify_signup` topic `news`). The fan list is captured site-wide (footer, release pages, `/links`) plus an engagement-triggered prompt, artist zone only, never on booking pages. No new vendors: everything runs on `track()`. Playbook: `docs/current/05-growth-and-engagement.md`.
- 2026-11-03: Release pages replace third-party smart links; `/links` replaces Linktree; `/press/one-sheet` (one printable Letter page, built from the same content) replaces attached PDFs. Bios live in `src/config/press.ts`.

- 2026-11-03: Retention and views measured first-party with no identifiers: a browser visit record tags every event new/returning, plus an anonymous weekly cohort table in KV (`ret:*`, read via insights). YouTube embeds report progress/completion/watch time through the player's own postMessage channel (no YouTube script, CSP unchanged) and offer "Up next". Return hooks: "New since your last visit" badges and Spotify follow / YouTube subscribe links.

- 2026-11-03: Client router adopted for flow and premium playback: video keeps playing in a docked mini-player across pages (seamless via `moveBefore()` in Chrome, resume-at-timestamp elsewhere); every page script uses `onPage(setup, when)` from `src/lib/lifecycle.ts`. Build format switched to `file` after finding Cloudflare 307-redirected every `/page` to `/page/` (canonical URLs pointed at redirects). Meta Conversions API added (consent-gated, hashed, deduplicated). Render pass on throttled mobile: CLS 0.067 → 0 (metric-matched font fallbacks), LCP home 2.1 → 1.4 s, music 2.7 → 1.9 s, private events 2.3 → 1.4 s; font preloads tested and rejected (they delayed first paint).

**Deprecated/Legacy:** GoHighLevel SmartSite and its hidden events sub-site (snapshot in `reference/current-site/`, all old URLs 301). The 20 MB image-only EPK PDF is replaced by `/press` and `/press/one-sheet`. Linktree and third-party smart links are replaced by `/links` and `/music/<id>`.

**Key docs:** `docs/current/01-current-site-audit.md`, `02-launch-checklist.md`, `03-integrations-and-workflows.md`, `04-scout-ai-governance.md`, `05-growth-and-engagement.md`; `docs/security/SECURITY.md`; `docs/research/reports/Luxury event music website strategy.md`; `reference/current-site/media-and-links.md`; `apps/web/.env.example`

**Run locally:** `cd apps/web && npm run dev` then open http://localhost:4321

**Last Updated:** 2026-11-03
