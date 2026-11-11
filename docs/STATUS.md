# STATUS: Sean Carney Entertainment (SCE), luxury weddings and private events

**Current Phase:** Pre-launch, release hardening. Phases 1 and 2 are built, the November 10 SCE brief and Drive content are applied, and the code matches `docs/current/`. Growth work (phase 3) waits until launch (`08-roadmap.md`).

**Readiness:**

| State | Where it stands |
|---|---|
| Implemented | All pages, the inquiry pipeline with durable acceptance, Scout (guided and Claude), media tooling |
| Locally tested | `npm run verify` (types, 46 unit tests, build, audit); `scripts/test_publish.sh` (11 cases); `npm run test:browser`, a smoke test (21 listed pages at desktop and phone width, API guards in the Workers runtime; not the full inquiry, Scout, availability, player or keyboard journeys); in the built Worker under `wrangler dev`: concurrent duplicate submissions produce one lead, and the cron backfills a pre-CRM lead to a stand-in webhook (2026-11-10) |
| Deployed | Not yet: no Cloudflare staging or production |
| Production verified | Not yet: needs a real inquiry through Resend and SHA-BAM on staging |
| Externally approved | Not yet: Sean's claims, venues, testimonials and media rights (`06-launch-checklist.md`) |

**Deferred dependencies** (none blocks code work):

| Dependency | Waiting on | Ready now |
|---|---|---|
| SHA-BAM CRM | Sean's account details | Leads held in `LEADS_DB` (D1) and emailed; the 15-minute cron backfills them once connected |
| Cloudflare deployment | Cloudflare login, DNS, secrets | Build config, bindings, security; staging first (`06-launch-checklist.md`) |
| Scout's AI backend | Whether SHA-BAM includes Conversation AI and an external chat API | Provider seam, Claude adapter, guided mode (`12-scout-backend-decision.md`) |

**Active Focus:** Staging deployment, then a real end-to-end inquiry (Resend is required before launch: while SHA-BAM is deferred it is Sean's only lead notification). Material still to come from Sean: room stories, the planner pack, missing player bios, format montages, the new YouTube and SHA-BAM consultation URLs, and Mark and Aimee's story with consent (`10-sce-build-brief.md`).

**Architecture Summary:** An Astro 7 static site (`apps/web`) on Cloudflare Workers; prerendered pages (`build.format: 'file'`) are swapped by the ClientRouter, while Scout, the consent bar and a persistent audio/video dock survive navigation. The Worker runs only the APIs behind `src/middleware.ts`: inquiry (success only once the lead is held in the lead store, SHA-BAM or Sean's inbox), availability (Google Calendar free/busy), Scout, signal and CSP reports. Content is typed JSON in `src/data/`, validated at build; `media-library.json` is the media catalog, prepared by `scripts/media/media.py` from private originals in `resources/`. Analytics are first-party under an enforced hash-based CSP. Details: `docs/current/03-architecture.md`.

**Key Decisions:**
- 2026-11-10: An inquiry is acknowledged only once it is held durably (`LEADS_DB`, SHA-BAM or the notify email), else 503 with the direct email (`03-architecture.md`).
- 2026-11-10: The lead store is Cloudflare D1, not KV: a `UNIQUE` event id makes duplicate submissions atomic, rows start `pending` so none escapes recovery, and a 15-minute cron retries CRM, notification and confirmation deliveries under per-channel leases (an unexpired lease to start a step, token fencing to record) with per-step CRM checkpoints; delivery runs after the response once the lead is stored (form and Scout alike), with the three channels in parallel; retries work a backlog round-robin, least recently attempted first. "Accepted" means safely recorded, not yet delivered. Retention: resolved leads 90 days, unresolved up to 180. The guarantee is at-least-once: a Worker dying between a remote success and its checkpoint can repeat that one step (a duplicate opportunity is possible until SHA-BAM offers a lookup or idempotency).
- 2026-11-10: POST routes declare an Origin policy (full origin: scheme, host, port): required for the inquiry form and Scout, checked when present elsewhere.
- 2026-11-10: Server logs carry allowlisted error codes only, never raw exception messages; the Meta access token travels in the request body, not the URL.
- 2026-11-10: Hardening from the repository audit: Turnstile fails closed in production, keyed HMAC log pseudonyms, streamed-body size limits, Scout's daily cap documented as soft with the Claude Console limit as the hard cap.
- 2026-11-10: TypeScript 7 held until `@astrojs/check` supports it (Dependabot ignores TypeScript majors).
- 2026-11-10: `resources/briefs/SCE Website.docx` governs brand and offer: SCE is the public brand, formats are Solo, Duo and Band (The Scene), and the offer includes a custom song (`/custom-song`) with Sean's songwriting credits in context. Prices stay private. (`10-sce-build-brief.md`)
- 2026-11-10: Media is catalog-driven: 53 assets and 15 named placements in `media-library.json`; originals are never edited or committed (`11-media-management.md`).
- 2026-11-10: Repo layout: app in `apps/web`, docs in `docs/`, media tooling in `scripts/media/`, Sean's Mac workflow in `scripts/`, private sources in git-ignored `resources/`. The release gate is local (`scripts/publish.sh`, `npm run verify`); GitHub CI is manual-only because Actions minutes are shared across the account's private repos.
- 2026-11-03: A luxury live-music house for weddings, with private events served quietly; one booking covers the day. No rock, country or western framing. (`01-positioning-and-offer.md`)
- 2026-11-03: Visual direction "Ivory maison" (Aman-like restraint), the only theme; the Nov 10 brief adds Élan Artists as the roster/presentation reference. (`02-site-structure-and-design.md`)
- 2026-11-03: Proof is rooms and couples (typeset venue names, named testimonials) plus one credentials line; no marketplace badges or logo walls.
- 2026-11-03: Client router with a persistent dock; every page script uses `onPage(setup, when)` (`src/lib/lifecycle.ts`). `build.format: 'file'` avoids Cloudflare's trailing-slash redirects.
- 2026-11-03: Malformed `src/data/*.json` is fatal in dev, build, check and CI (`integrations/validate-data.mjs`).
- 2026-11-03: The CRM is SHA-BAM, a white-labeled GoHighLevel; the GoHighLevel API v2 integration works unchanged (`04-integrations-and-workflows.md`).
- 2026-11-02: Security baseline against OWASP ASVS 5.0 (`docs/security/SECURITY.md`): enforced CSP with build-time hashes, API middleware, consent-gated vendors, one storage helper with a clear-data control.
- 2026-11-01: Google Calendar is the date source of truth (free/busy only). Scout is provider-agnostic (guided mode without AI; Claude adapter when keyed), governed by OWASP LLM/Agentic Top 10 and NIST AI RMF.

**Deprecated/Legacy:**
- The artist hub (release pages, Music, Shows, Merch, Press kit, fan list, Spotify follows, logo marquee): out of scope for a wedding house; URLs 301. History: `docs/archive/2026-11-03-artist-hub-to-luxury-events/`.
- The band name "The Hustlers" and the duo/trio format: replaced by The Scene and Solo/Duo/Band; research reports keep their original wording.
- The dark "night" theme and the `events_theme` A/B test: one ivory theme by decision.
- GoHighLevel SmartSite and its events sub-site: replaced by this site (snapshot in `reference/current-site/`, old URLs 301).

**Key docs:** `README.md` (repo map and commands); `docs/current/01`–`12` (positioning, design, architecture, integrations, Scout, launch checklist, Mac publishing, roadmap, Drive content update, SCE brief, media management, Scout backend decision); `docs/security/SECURITY.md`; `docs/research/reports/`; `apps/web/.env.example`.

**Run locally:** `cd apps/web && npm run dev` (http://localhost:4321); `npm run verify` is the full gate. Publish: `bash scripts/publish.sh "<description>"`.

**Last Updated:** 2026-11-10
