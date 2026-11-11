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

Lead acceptance: `src/lib/inquiry/deliver.ts` decides when an inquiry counts as received, for the form and Scout alike. The lead is written to `LEADS_DB` (Cloudflare D1, 90 days; the table is created on first use), sent to SHA-BAM/GoHighLevel (API v2, then the webhook; a non-2xx is a failure) and to Sean's inbox through Resend. The visitor sees success only if at least one of those three held it; otherwise `/api/inquire` returns 503 and the form shows the direct email address. The confirmation email goes out only after acceptance. D1 rather than KV because it is strongly consistent and atomic: the client `event_id` is a `UNIQUE` column, so concurrent resubmissions insert one row and get one lead id; and each row is inserted with every channel `pending`, so a lead cannot be stored yet invisible to recovery. Open work (CRM not taken, failed or not connected yet; Sean not yet notified) is a query on the rows themselves. A cron every 15 minutes (`src/worker.ts`) and `POST /api/leads` retry it in cursor-paged batches of 25; each attempt first claims its row by bumping the attempt counter (optimistic, so two runs never send the same delivery), the CRM records completed steps (contact, opportunity, note) so a retry resumes rather than repeats, and after five attempts a delivery is marked `abandoned` with an error log line for alerting (`reopen` puts it back). `GET /api/leads` lists open leads and per-state counts without personal data (admin token). Lead logs carry IDs and outcomes only. In `astro dev` with nothing configured, leads are accepted as a dry run.

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
