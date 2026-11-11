# Architecture

## System
- **Astro 7 static site** in `apps/web`, deployed to **Cloudflare Workers** with `@astrojs/cloudflare`. Pages are prerendered at build (`output: 'static'`, `build.format: 'file'`, so `/weddings` is served directly with no trailing-slash redirect). The Worker runs only the APIs.
- **Client router** (`ClientRouter` in `BaseLayout.astro`): pages swap in place. Scout, the player dock and the consent bar persist across navigation (`transition:persist`). Bare pages (`/links`, print views) load as plain pages.
- **Content** lives in typed JSON collections (`src/data/*.json`, schemas in `src/content.config.ts`). `integrations/validate-data.mjs` stops dev, build, check and CI on malformed JSON.
- **Security:** an enforced header CSP with build-time SHA-256 hashes (`integrations/csp-header-hashes.mjs` writes `public/_headers`; no `unsafe-inline`); API middleware for method, origin, content type, size and rate limits; an OWASP ASVS 5.0 baseline in `docs/security/SECURITY.md`.

```
Browser ──> Cloudflare (static pages + _headers CSP)
   │            └─ Worker /api/* ── middleware ──> handlers
   │                                    ├─ inquire      → score → durable acceptance (LEADS_DB / SHA-BAM / Resend notify) → confirm (+ Meta CAPI with consent)
   │                                    ├─ leads        → admin: list and retry leads waiting for the CRM
   │                                    ├─ availability → Google Calendar free/busy
   │                                    ├─ scout*       → guided mode | Claude adapter
   │                                    ├─ signal, csp-report
   │                                    └─ KV SCOUT_KV: anonymous counters, retention cohorts
   └─ first-party analytics → Plausible · GA4 · Clarity · Meta (consent-gated)
```

## Modules
Media-management addition: `src/data/media-library.json` owns sources, preparation profiles and named placements; `src/lib/media/library.ts` resolves them at build time. `scripts/media/media.py` prepares files incrementally and generates `audio.json`. See `11-media-management.md`. Originals stay local; image resolution uses tracked prepared outputs and does not ship source paths to browsers.

Music-planning addition: `src/lib/music-plan.ts` owns repertoire-only ranking and validated list state. `MusicQuiz.astro` and `MusicPlan.astro` render the flow, storing IDs through the existing storage helper. The inquiry form resolves them into its editable message; no new API or CRM field is introduced. SCE adds static `/custom-song` and `/videos` pages. See `10-sce-build-brief.md`.

Lead acceptance: `src/lib/inquiry/deliver.ts` decides when an inquiry counts as received, for the form and Scout alike. **Accepted means safely recorded, not necessarily delivered:** the lead is in `LEADS_DB` (Cloudflare D1; the table is created on first use) or, if D1 is unavailable, was taken by SHA-BAM/GoHighLevel (API v2, then the webhook; a non-2xx is a failure) or Sean's inbox through Resend. Otherwise `/api/inquire` returns 503 and the form shows the direct email address. Once the row is stored, delivery runs after the response (Cloudflare's `waitUntil`, passed in per request by `/api/inquire` and, through its tool context, by Scout's `submit_inquiry`), so a slow CRM never delays the visitor; the Meta event is deferred the same way. The three channels run concurrently and each records its outcome as soon as it completes, so a stalled CRM never holds back Sean's email or the confirmation. A duplicate submission (the client `event_id` is a `UNIQUE` column, so concurrent ones insert one row) gets the original lead id whatever its delivery state. Each row is inserted with every channel `pending` (or `skipped` if unconfigured), so no lead escapes recovery.

Each delivery channel (CRM, notify Sean, confirm to the visitor) runs under a lease: a random token plus a five-minute expiry. The accepting request holds every channel's lease from the insert, so the cron cannot pick the lead up mid-delivery. To start a remote call a runner must hold an unexpired lease, and that check renews it (a heartbeat); the CRM checks before each step (contact, opportunity, note, or the webhook) and checkpoints after each. To record a result or checkpoint, the runner's token must still be the channel's lease: an expired holder that nobody has replaced still records (its result is the truth; discarding it would only cause a resend), and once another runner claims the channel the old token is fenced out. External calls time out after 20 seconds (Turnstile 10). **The guarantee is at-least-once, with duplicates confined to one window:** the Worker dying after a remote call succeeded but before its checkpoint was written. For the contact that is harmless (an upsert keyed on email); for the opportunity it can create a duplicate, which needs a lookup or idempotency on SHA-BAM's side to close (`04-integrations-and-workflows.md`).

A cron every 15 minutes (`src/worker.ts`) and `POST /api/leads` retry open work in batches of 25 (the cron runs up to four per invocation). A batch selects only leads with a channel that is configured now and not leased (leads waiting for an unconnected CRM are listed by `GET /api/leads` but cost the cron nothing, and in-flight leads never take a slot), never-attempted first and then least recently attempted, each at most once per 10 minutes: a large backlog is worked round-robin with no cursor state between runs. A lead's channels are retried concurrently too. A `skipped` channel is delivered once it is configured: the CRM backfills, Sean is told about leads that arrived before email was set up, and confirmations are sent only within 24 hours (later ones are dropped as `lead_confirm_expired`). After five attempts a CRM or notify delivery is `abandoned` with an error log line for alerting; `reopen` re-queues it. Retention (cron, and after each inquiry): resolved leads are deleted at 90 days; a lead whose CRM or notification never completed is kept for recovery up to 180 days, then deleted with a `lead_retention_expired_unresolved` error line (disclosed on `/privacy`). `GET /api/leads` lists open leads and per-state counts without personal data (admin token). Logs carry lead IDs, outcomes and allowlisted error codes (`lib/security/errors.ts`), never raw exception messages. In `astro dev` with nothing configured, leads are accepted as a dry run.

POST routes state an Origin policy (`lib/security/origin.ts`): the inquiry form and Scout require a same-host `Origin` (browsers always send one on POST); beacons, CSP reports and the token-protected admin routes check it when present. `null`, malformed and cross-origin values are always rejected.

| Area | Where | What it does |
|---|---|---|
| Layout | `src/layouts/BaseLayout.astro`, `src/components/layout/*` | head, router, header/footer, persisted Scout, dock and consent bar |
| Page lifecycle | `src/lib/lifecycle.ts` | `onPage(setup, when)`: per-page binding with cleanup, scoped to its page |
| Theme | `src/styles/global.css` | Ivory maison tokens, type scale, metric-matched font fallbacks, page transitions |
| Home | `src/pages/index.astro`, `src/components/home/*` | Hero, Rooms, DayArc, Formats, FilmGrid, Testimonials, EventsBand (private events) |
| Event pages | `src/pages/[event].astro`, `src/pages/private-events.astro`, `src/components/events/*`, `src/data/events.json` | weddings and each private-event type, composed from typed blocks |
| Repertoire | `src/pages/repertoire.astro`, `src/data/songbook.json`, `src/data/repertoire.json` | full searchable songbook plus songs by moment |
| Planners and venues | `src/pages/planners.astro`, `src/pages/venues/*` | the planner toolkit; one page per room (`credits.json`, category `room`), `noindex` and out of the sitemap until the room has a `story` (`astro.config.mjs` computes the sitemap exclusions from the data) |
| Media | `src/lib/media/player.ts`, `yt-player.ts`, `src/components/media/*`, `src/lib/feeds/*` | click-to-load YouTube, the persistent dock, watch metrics, "Up next"; build-time YouTube and Instagram ranking |
| Inquiry | `src/pages/inquire/*`, `src/lib/inquiry/*`, `src/pages/api/inquire.ts` | five-step form, lead scoring, durable acceptance (`deliver.ts`), GoHighLevel, Resend, Turnstile, Meta CAPI; `/api/leads` for reconciliation |
| Availability | `src/lib/integrations/google-calendar.ts`, `src/pages/api/availability.ts` | indicative date check from free/busy |
| Scout | `src/components/scout/*`, `src/lib/scout/*`, `src/pages/api/scout*` | the concierge; `05-scout-concierge.md` |
| Analytics | `src/lib/analytics/*`, `src/components/analytics/*` | declarative tracking, first/last-touch attribution, A/B tests, retention cohorts, web vitals |
| SEO | `src/components/seo/Seo.astro`, `src/lib/seo/schema.ts`, `src/pages/llms.txt.ts`, sitemap | Person, Service (weddings, private events) and FAQ JSON-LD; an AI-assistant brief at `/llms.txt` |
| Integrations | `src/lib/integrations/ghl.ts`, `meta-capi.ts` | GoHighLevel API v2 with webhook fallback; Meta Conversions API |
| Tooling | `scripts/setup-mac.sh`, `scripts/publish.sh`, `.github/workflows/ci.yml` | Mac setup, publishing to `main` (the release gate: check, test, build), manual CI (check, test, build, audit) |

## Content model
| Collection | Holds |
|---|---|
| `events.json` | weddings and the private-event types, each composed from blocks (timeline, formats, film, testimonials, checklist, FAQ) |
| `repertoire.json` | songs by moment (ceremony and first dance, cocktail hour and dinner, the dance floor) |
| `testimonials.json` | couples and planners, with occasion, place and consent |
| `videos.json` | live-at-event films and covers (`context`: live, cover, session) |
| `credits.json` | `room` (luxury rooms, typeset on home, About and inquiry, each with a venue page and an optional `story`), `venue` (stages, for the galas list), `client`, and broadcast/sync credits behind the About credentials line |
| `songbook.json` | full supplied 2026–2027 song list: 192 entries across nine styles |
| `audio.json` | 15 direct acoustic recordings, compressed from supplied WAV masters |
| `musicians.json` | supplied biographies and portraits for The Scene |
| `faqs.json` | per-page FAQs (scopes include `weddings`, `planners`, each event type and `scout`), shared with Scout |
| `feed-rules.json` | pinned and excluded videos per placement |
| `src/config/site.ts` | name, contacts, socials, stats, response time |

## Conventions
- Every page script binds through `onPage(setup, when)`, scoped to its page.
- Content is edited in `src/data/`; the build stops on malformed files.
- Inline scripts and styles only through the CSP hash integration.
- Browser storage only through `src/lib/storage.ts` (`sc_` keys, cleared by the privacy control).
- Publishing goes through `scripts/publish.sh` (check, build and secret guard, then push to `main`).

## Performance budget
The November update extends the existing player to native audio/video without changing ownership: one active session, the same persistent dock and router lifecycle. `NativeFilm` and `AcousticListening` load their media on request. Untouched source files remain in local `resources`; `scripts/media/media.py build` produces web derivatives. `/the-scene` presents the supplied band roster. See `09-drive-content-update.md` for sources and validation limits.

Measured on throttled mobile (4× CPU, ~1.6 Mbps): LCP under 2 s, CLS 0, no long tasks; about 12 KB of gzipped JavaScript per page. Fonts are not preloaded (preloads delayed first paint); fallbacks are metric-matched instead.
