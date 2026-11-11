# STATUS: Sean Carney Entertainment (SCE), luxury weddings and private events

**Current Phase:** Pre-launch. Phases 1 and 2 are built, and the November 10 SCE brief and Drive content are applied; the code matches `docs/current/`. Phase 3 (growth) is next (`08-roadmap.md`). Launch waits on content confirmation and account setup (`06-launch-checklist.md`).

**Active Focus:** Material still to come from Sean: room stories, the planner pack, missing player bios, format montages, the new YouTube and SHA-BAM consultation URLs, and Mark and Aimee's story with consent (`10-sce-build-brief.md`). Accounts to set up: SHA-BAM token, call-booking link, Resend, Turnstile.

**Architecture Summary:** An Astro 7 static site (`apps/web`) on Cloudflare Workers; prerendered pages (`build.format: 'file'`) are swapped by the ClientRouter, while Scout, the consent bar and a persistent audio/video dock survive navigation. The Worker runs only the APIs behind `src/middleware.ts`: inquiry (lead scoring → GoHighLevel/SHA-BAM → Resend), availability (Google Calendar free/busy), Scout, signal and CSP reports. Content is typed JSON in `src/data/`, validated at build; `media-library.json` is the media catalog, prepared by `scripts/media/media.py` from private originals in `resources/`. Analytics are first-party under an enforced hash-based CSP. Details: `docs/current/03-architecture.md`.

**Key Decisions:**
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

**Key docs:** `README.md` (repo map and commands); `docs/current/01`–`11` (positioning, design, architecture, integrations, Scout, launch checklist, Mac publishing, roadmap, Drive content update, SCE brief, media management); `docs/security/SECURITY.md`; `docs/research/reports/`; `apps/web/.env.example`.

**Run locally:** `cd apps/web && npm run dev` (http://localhost:4321); `npm run verify` is the full gate. Publish: `bash scripts/publish.sh "<description>"`.

**Last Updated:** 2026-11-10
