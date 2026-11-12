# STATUS: Sean Carney Entertainment (SCE), luxury weddings and private events

**Current Phase:** Pre-launch, release hardening. Phases 1 and 2 are built, the November 10 SCE brief and Drive content are applied, and the code matches `docs/current/`. Growth work (phase 3) waits until launch (`08-roadmap.md`).

**Readiness:**

| State | Where it stands |
|---|---|
| Implemented | All pages, the inquiry pipeline with durable acceptance, Scout (guided and Claude), media tooling |
| Locally tested | `npm run verify` (types, 89 unit tests, including lead-table upgrades, referral capture and the source report, the planner-pack privacy guard, calendar rules across daylight-saving days, lead scoring and linked repeat inquiries; build, audit); a pre-push hook runs the unit tests and type check when `apps/web` changes; `scripts/test_publish.sh` (11 cases); `npm run test:browser` (21 pages at desktop and phone width, API guards in the Workers runtime, and four inquiry journeys: refused, accepted, 503 and a stale date check; not Scout, the player or keyboard journeys); in the built Worker under `wrangler dev`: concurrent duplicate submissions produce one lead, and the cron backfills a pre-CRM lead to a stand-in webhook (2026-11-10) |
| Deployed | Not yet. Staging is scripted and dry-run locally (`scripts/staging.sh`, `13-staging.md`); it waits on the Cloudflare login |
| Production verified | Not yet: needs a real inquiry through Resend and SHA-BAM on staging |
| Externally approved | Not yet: claims, testimonials (names hidden until each is approved), media rights, offer scope and sales materials (`14-decision-register.md`) |

**Deferred dependencies** (none blocks code work):

| Dependency | Waiting on | Ready now |
|---|---|---|
| SHA-BAM CRM | Sean's account details | Leads held in `LEADS_DB` (D1) and emailed; the 15-minute cron backfills them once connected |
| Cloudflare deployment | Cloudflare login (staging); DNS and production secrets (launch) | Isolated staging environment and `scripts/staging.sh` (deploy, secrets, smoke, cron, retry); production config (`06-launch-checklist.md`) |
| Scout's AI backend | Whether SHA-BAM includes Conversation AI and an external chat API | Provider seam, Claude adapter, guided mode (`12-scout-backend-decision.md`) |

**Active Focus:** Staging deployment (`bash scripts/staging.sh`, `13-staging.md`) and Sean's answers in `14-decision-register.md` (claims, testimonial approvals, format scope, planner pack), then a real end-to-end inquiry (Resend is required before launch: while SHA-BAM is deferred it is Sean's only lead notification). Material still to come from Sean: room stories, the planner pack, missing player bios, format montages, the new YouTube and SHA-BAM consultation URLs, and Mark and Aimee's story with consent (`10-sce-build-brief.md`).

**Architecture Summary:** An Astro 7 static site (`apps/web`) on Cloudflare Workers; prerendered pages (`build.format: 'file'`) are swapped by the ClientRouter, while Scout, the consent bar and a persistent audio/video dock survive navigation. The Worker runs only the APIs behind `src/middleware.ts`: inquiry (success only once the lead is held in the lead store, SHA-BAM or Sean's inbox), availability (Google Calendar free/busy), Scout, signal and CSP reports. Content is typed JSON in `src/data/`, validated at build; `media-library.json` is the media catalog, prepared by `scripts/media/media.py` from private originals in `resources/`. Analytics are first-party under an enforced hash-based CSP. Details: `docs/current/03-architecture.md`.

**Key Decisions:**
- 2026-11-12: Referrals are recorded and acted on (`16-follow-ups-and-referrals.md`): the form's last step and Scout ask, optionally, how the visitor heard about Sean and who referred them; the answer travels to the CRM (`heard:` tag, `heard_via`, `referred_by`) and Sean's notification, and a planner or venue referral scores like a trade partner. `GET /api/leads?report=sources` gives the 90-day inquiries-by-source review. Post-event and corporate rebooking follow-ups are SHA-BAM workflows with draft templates awaiting Sean (F1). `/planners` lists the planner pack from `planner-pack.json`; insurance and tax forms are never published.
- 2026-11-12: Sean's site review (`review.md`) is applied: hero "Your story. Your song. Anywhere in the world." with Custom Written Songs among the formats; "Watch The SCE Experience" and every film slot play the YouTube brand film (`src/lib/media/experience.ts`); Instagram and YouTube (the new SCE channel) sit at the top of every page; the rooms drift past as a slow strip, Amangiri first, with approved venue logos and wordmarks; Sean's own introduction and format copy; the band is always "The SCENE"; the nav says Watch. Home and Watch have no listening section: a sticky listening bar appears at the third section and hands playback to the persistent dock. The Hustlers-era reel is gone (excluded from the YouTube feed). New claims, rooms and logos are in `14` (C2, C8, C9, M4, M5).
- 2026-11-11: From the fresh repository audit:
  - Availability reads a dedicated holds calendar (any hold = busy) apart from personal calendars (tentative: Sean checks). Any calendar error reads as unknown, day boundaries are DST-aware, and the form and Scout share one rule set.
  - Lead scoring separates fit, relationship and urgency. The tier sets reply order only.
  - Repeat inquiries from the same email (form or Scout) are linked, never merged or dropped.
  - The thank-you page promises receipt, not an email already sent, and the cron alerts when Sean's notification is 30 minutes overdue.
  - Testimonials carry provenance, and a name needs a recorded approval (the build enforces it).
  - One decision register (`14`) owns outstanding approvals; booking operations, service levels and alerts are in `15`.
  - A/B tests are paused until traffic can support them.
  - No speculative refactor of large files: they are split only when a change needs it.
- 2026-11-11: Staging is a separate Worker, D1 database, KV namespace and set of rate-limit counters (`env.staging` in `wrangler.jsonc`), with no custom domain and no SHA-BAM until a test sub-account exists; a test and the deploy script both refuse a staging build that names a production resource. Application code is frozen apart from staging needs.
- 2026-11-10: An inquiry is acknowledged only once it is held durably (`LEADS_DB`, SHA-BAM or the notify email), else 503 with the direct email (`03-architecture.md`).
- 2026-11-10: The lead store is Cloudflare D1, not KV: a `UNIQUE` event id makes duplicate submissions atomic, rows start `pending` so none escapes recovery, and a 15-minute cron retries CRM, notification and confirmation deliveries under per-channel leases (an unexpired lease to start a step, token fencing to record) with per-step CRM checkpoints; delivery runs after the response once the lead is stored (form and Scout alike), with the three channels in parallel; retries work a backlog round-robin, least recently attempted first. "Accepted" means safely recorded, not yet delivered. Retention: resolved leads 90 days, unresolved up to 180. The guarantee is at-least-once: whenever a remote service acted but the Worker never learned it (timeout, lost response, or a crash before checkpointing), a retry repeats that step; closing it needs remote idempotency (SHA-BAM opportunity, Resend), on the integration test list.
- 2026-11-10: POST routes declare an Origin policy (full origin: scheme, host, port): required for the inquiry form and Scout, checked when present elsewhere.
- 2026-11-11: Scout prepares, the visitor sends: `submit_inquiry` returns a signed draft and only the visitor's Send click (`POST /api/scout/inquire`) creates the lead. Its idempotency key covers every business detail plus the day prepared: retries and double-clicks are one lead, a follow-up with changed details is a new one; only the latest draft is sendable. The day is a deduplication window, not a retry window: the same details prepared again across midnight UTC become two leads, never a lost one. Verified in Chrome against the built Worker (one lead, one CRM delivery across repeated sends).
- 2026-11-10: Production requires `SCOUT_SIGNING_KEY` (otherwise Scout is guided-only); API rate limits are two tiers (strict 3/min, standard 20/min) defined once and checked against `wrangler.jsonc`.
- 2026-11-10: Server logs carry allowlisted error codes only, never raw exception messages; the Meta access token travels in the request body, not the URL.
- 2026-11-10: Hardening from the repository audit: Turnstile fails closed in production, keyed HMAC log pseudonyms, streamed-body size limits, Scout's daily cap documented as soft with the Claude Console limit as the hard cap.
- 2026-11-10: TypeScript 7 held until `@astrojs/check` supports it (Dependabot ignores TypeScript majors).
- 2026-11-10: `resources/briefs/SCE Website.docx` governs brand and offer: SCE is the public brand, formats are Solo, Duo and Band (The SCENE), and the offer includes a custom song (`/custom-song`) with Sean's songwriting credits in context. Prices stay private. (`10-sce-build-brief.md`)
- 2026-11-10: Media is catalog-driven: 53 assets and 15 named placements in `media-library.json`; originals are never edited or committed (`11-media-management.md`).
- 2026-11-10: Repo layout: app in `apps/web`, docs in `docs/`, media tooling in `scripts/media/`, Sean's Mac workflow in `scripts/`, private sources in git-ignored `resources/`. The release gate is local (`scripts/publish.sh`, `npm run verify`); GitHub CI is manual-only because Actions minutes are shared across the account's private repos.
- 2026-11-03: A luxury live-music house for weddings, with private events served quietly; one booking covers the day. No rock, country or western framing. (`01-positioning-and-offer.md`)
- 2026-11-03: Visual direction "Ivory maison" (Aman-like restraint), the only theme; the Nov 10 brief adds Élan Artists as the roster/presentation reference. (`02-site-structure-and-design.md`)
- 2026-11-03: Proof is rooms and couples (the rooms strip, named testimonials) plus one credentials line; no marketplace badges.
- 2026-11-03: Client router with a persistent dock; every page script uses `onPage(setup, when)` (`src/lib/lifecycle.ts`). `build.format: 'file'` avoids Cloudflare's trailing-slash redirects.
- 2026-11-03: Malformed `src/data/*.json` is fatal in dev, build, check and CI (`integrations/validate-data.mjs`).
- 2026-11-03: The CRM is SHA-BAM, a white-labeled GoHighLevel; the GoHighLevel API v2 integration works unchanged (`04-integrations-and-workflows.md`).
- 2026-11-02: Security baseline against OWASP ASVS 5.0 (`docs/security/SECURITY.md`): enforced CSP with build-time hashes, API middleware, consent-gated vendors, one storage helper with a clear-data control.
- 2026-11-01: Google Calendar is the date source of truth (free/busy only). Scout is provider-agnostic (guided mode without AI; Claude adapter when keyed), governed by OWASP LLM/Agentic Top 10 and NIST AI RMF.

**Deprecated/Legacy:**
- Typeset-only rooms and the "no logos" rule: Sean asked for venue logos (2026-11-12). The `hero_sub` A/B test, the native live-film player and the home/Watch listening sections are retired with the review.
- The artist hub (release pages, Music, Shows, Merch, Press kit, fan list, Spotify follows, logo marquee): out of scope for a wedding house; URLs 301. History: `docs/archive/2026-11-03-artist-hub-to-luxury-events/`.
- The band name "The Hustlers" and the duo/trio format: replaced by The SCENE and Solo/Duo/Band; research reports keep their original wording.
- The dark "night" theme and the `events_theme` A/B test: one ivory theme by decision.
- GoHighLevel SmartSite and its events sub-site: replaced by this site (snapshot in `reference/current-site/`, old URLs 301).

**Key docs:** `README.md` (repo map and commands); `docs/current/01`–`16` (positioning, design, architecture, integrations, Scout, launch checklist, Mac publishing, roadmap, Drive content update, SCE brief, media management, Scout backend decision, staging, decision register, booking operations, follow-ups and referrals); `docs/security/SECURITY.md`; `docs/research/reports/` (including "Trust, referrals and repeat business", 2026-11-12); `apps/web/.env.example`.

**Run locally:** `cd apps/web && npm run dev` (http://localhost:4321); `npm run verify` is the full gate. Publish: `bash scripts/publish.sh "<description>"`.

**Last Updated:** 2026-11-12

**2026-11-12 session recovery:** Resumed Claude session 3f18547b-4ade-4bfd-bab7-332f3bec1bcd after its usage-limit interruption. Final verification passed: npm run verify (89 tests, Astro check, production build, zero dependency vulnerabilities); recovered referral-check and review-check on desktop and phone; npm run test:browser (all pages, API guards and inquiry journeys). Referral capture, planner-pack scaffold, distinct Our Players video and follow-up workflow specifications are complete locally. External approvals and deployment dependencies above still apply.
