# STATUS: Sean Carney, luxury weddings and private events

**Current Phase:** Phases 1 and 2 are built and verified; the code matches `docs/current/`. Phase 3 (growth) is next, and phase 2 has three items waiting on Sean (`08-roadmap.md`). Pre-launch: content confirmation and account setup (`06-launch-checklist.md`); the biggest content gap is wedding photography (the current library is largely western-styled artist portraits).

**Active Focus:** Content from Sean (wedding photography, room stories, the planner pack, pricing posture) and account setup (SHA-BAM token, call-booking link, Resend, Turnstile). Phase 2 added `/planners`, `/venues` with five room pages (noindex until each has Sean's story), "how booking works" and the call offer after inquiry. Phase 1 verified 2026-11-03 on the production build with the CSP enforced: 34 browser checks (routing, theme, content, Scout, the persistent player, the inquiry flow, legacy redirects, script scoping), 0 type errors, 0 design-detector findings.

**Architecture Summary:** An Astro 7 static site (`apps/web`) on Cloudflare Workers; pages are prerendered (`build.format: 'file'`) and swapped by Astro's ClientRouter, with Scout, the consent bar and a video player dock persisting across pages. The Worker runs only the APIs behind `src/middleware.ts`: `/api/inquire` (lead scoring → GoHighLevel → Resend, plus a consent-gated Meta Conversions API event), `/api/availability` (Google Calendar free/busy), `/api/scout*`, `/api/signal` and `/api/csp-report`. Content is typed JSON in `src/data/`, validated at build, with films ranked at build by the media pipeline. Analytics are first-party (attribution, A/B tests, retention cohorts) under an enforced hash-based CSP. Details: `docs/current/03-architecture.md`.

**Key Decisions:**
- 2026-11-03: The site is a luxury live-music house for weddings, with private events served quietly; one booking covers solo through full band (Sean Carney and The Hustlers). No original music, rock, country or western framing. (`01-positioning-and-offer.md`)
- 2026-11-03: Visual direction "Ivory maison" (Aman-like restraint), the only theme. (`02-site-structure-and-design.md`)
- 2026-11-03: Proof is rooms and couples (typeset venue names, named testimonials), plus one credentials line on About; no marketplace badges, no logo walls.
- 2026-11-03: Pricing posture: tailored proposals and a private investment guide after inquiry; a public "from" price stays an open decision.
- 2026-11-03: Competitor and luxury teardown (Moses Lin, Dylan Galvin, Johnny Rockett; Aman, The Row, Cartier) in `docs/research/reports/`; captures in `reference/competitors/` and `reference/inspiration/`.
- 2026-11-03: Client router with a persistent video dock; every page script uses `onPage(setup, when)` (`src/lib/lifecycle.ts`). `build.format: 'file'` (Cloudflare had 307-redirected every `/page` to `/page/`).
- 2026-11-03: Malformed `src/data/*.json` is fatal in dev, build, check and CI (`integrations/validate-data.mjs`); Astro alone shipped the collection empty.
- 2026-11-03: Repo on GitHub (takku1/seancarneywebsite, private, `main`); Sean's workflow is `scripts/setup-mac.sh` and `scripts/publish.sh`.
- 2026-11-02: Security baseline against OWASP ASVS 5.0 (`docs/security/SECURITY.md`): enforced header CSP with build-time hashes, API middleware, consent-gated vendors, one storage helper with a clear-data control.
- 2026-11-03: The CRM is SHA-BAM, a white-labeled GoHighLevel (`app.sha-bam.com`); the site's GoHighLevel API v2 integration works with it unchanged (`04-integrations-and-workflows.md`).
- 2026-11-01: GoHighLevel is the CRM hub; Google Calendar is the date source of truth (free/busy only). Scout is provider-agnostic (guided mode without AI; Claude adapter when keyed), governed by OWASP LLM/Agentic Top 10 and NIST AI RMF.

**Deprecated/Legacy:**
- The artist hub (release pages, Music, Shows, Merch, Press kit and one-sheet, the fan email list, the engagement prompt, Spotify follow links, the logo marquee): out of scope for a wedding house; removed in phase 1, URLs 301. History: `docs/archive/2026-11-03-artist-hub-to-luxury-events/`.
- The dark "night" theme and the `events_theme` A/B test: one ivory theme by decision.
- GoHighLevel SmartSite and its hidden events sub-site: replaced by this site (snapshot in `reference/current-site/`, all old URLs 301).

**Key docs:** `docs/current/01-positioning-and-offer.md`, `02-site-structure-and-design.md`, `03-architecture.md`, `04-integrations-and-workflows.md`, `05-scout-concierge.md`, `06-launch-checklist.md`, `07-mac-setup-and-publishing.md`, `08-roadmap.md`; `docs/security/SECURITY.md`; `docs/research/reports/`; `apps/web/.env.example`.

**Run locally:** `cd apps/web && npm run dev`, then open http://localhost:4321. Publish: `bash scripts/publish.sh "<description>"`.

**Last Updated:** 2026-11-03
