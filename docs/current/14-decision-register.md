# Decision and acceptance register

This register owns every outstanding decision, approval and proof the site depends on. `STATUS.md` summarizes it, the launch checklist (`06`) covers technical setup and QA, and every other document links here instead of repeating an item. When something is settled, update its row (status, date, evidence) and the data file it governs.

**Status values:** Open (no answer yet) · Pending (asked, waiting) · Approved (decided, with evidence recorded) · Verified (proven in a real environment).

## 1. Claims the site makes

The site does not invent claims. Each one stays in place only while its row is pending, and comes off the site if Sean says no.

| ID | Claim | Where it appears | Owner | Status | Proof required |
|---|---|---|---|---|---|
| C1 | 1,000+ events across fifteen years | `src/config/site.ts` | Sean | Pending | Sean's figure (older sources say 500+ and 100+ a year) |
| C2 | Rooms named: Amangiri, Hotel del Coronado, The Beverly Hills Hotel, The Ritz-Carlton Laguna Niguel, Terranea, The Biltmore, Hotel Bel-Air, Montage Laguna Beach, The Resort at Pelican Hill, Fairmont Grand Del Mar, Rancho Valencia, Hotel Casa del Mar | `credits.json` (`room`), home strip, About, venue pages, inquiry | Sean | Pending | Sean's 2026-11-12 review asked for Amangiri first and more LA, OC and San Diego rooms ("I've played all of them"); the six additions come from his own draft list in the brief. Sean confirms that selection or strikes any name |
| C3 | Clients named: Salesforce, Autodesk, VCA, MacLean Power Systems, Informa Markets, Hawke Media | `credits.json` | Sean | Pending | Per client: fine to name (and any contract restriction) |
| C4 | Credentials line (Paris Olympics coverage, NFL Playoffs, Netflix) | About | Sean | Pending | Approved wording |
| C5 | Reply "within one business day" | `site.responseTime`, thank-you page, confirmation email | Sean | Pending | Always true, including weekends and event days; otherwise a different promise |
| C6 | COI, W-9, stage plot and rider on request | `/planners`, FAQ | Sean | Pending | The documents exist (see P2) |
| C7 | Formats: Solo, Duo, Band with The SCENE | Throughout | Sean | Pending | The bookable line-ups (see O1) |
| C8 | Recording Academy (Grammy) voting member; Billboard-charting singer, songwriter and guitarist; over 100 events a year; "we guarantee an amazing time" | Home introduction | Sean | Approved (Sean's own wording, review of 2026-11-12) | Keep the wording in step with C1 (1,000+ events) |
| C9 | "The biggest venues in the world choose Sean Carney and The SCENE" | Home formats (Band) | Sean | Approved (Sean's own wording, review of 2026-11-12) | |

## 2. Testimonials (provenance)

Every quote in `src/data/testimonials.json` records its `source`. A name is shown only with `consent: "granted"` plus an `approval` record (`by`, `on`, `scope`), and the build fails if `granted` has no approval. Until then, quotes appear attributed by role only.

| ID | Quote from | Source | Status | Proof required |
|---|---|---|---|---|
| T1 | Jordan and Isabela | Earlier SCE events site | Pending | The couple confirms name and quote may appear |
| T2 | Timea and Kris | Earlier SCE events site | Pending | Same |
| T3 | Olivia and John | Earlier SCE events site | Pending | Same |
| T4 | Alexander Sugarman, Alison V., Gina, Austin, Anthony Morison | Public Bark reviews (2023–2026) | Pending | Each reviewer agrees to appear by name on SCE's site (a public review on Bark is not consent to reuse it elsewhere) |
| T5 | Six unattributed quotes | Earlier Sean Carney site | Pending | Sean confirms they are genuine client words |

When approved, record the approval in JSON, for example `"consent": "granted", "approval": { "by": "Jordan (email to Sean)", "on": "2026-11-20", "scope": "name, city and quote on seancarneymusic.com" }`.

## 3. Media rights

| ID | Asset | Status | Proof required |
|---|---|---|---|
| M1 | November 10 Drive wedding photography and films | Pending | Usage rights and photographer credit lines (`media-library.json` holds the credits) |
| M2 | Legacy artist portraits still on some pages | Pending | Keep or replace (marked in `media-library.json`) |
| M3 | Script signature logo | Open | A vector file |
| M4 | Venue logos in the rooms strip (The Ritz-Carlton, Terranea; supplied in the Drive archive) | Pending | Shown at Sean's request (`logoApproved`); each venue's permission to use its mark. More logos (Amangiri first) as Sean supplies them |
| M5 | A better Duo photograph and a full-band photograph for the home formats | Open | Sean supplies them; swap with `media.py replace` for `home.format.duo` and `home.format.band` |

## 4. Offer and product decisions

| ID | Decision | Owner | Status | Questions for Sean |
|---|---|---|---|---|
| O1 | Format scope | Sean | Open | For Solo, Duo and Band: who plays, the set lengths, and whether sound, microphones for vows and speeches, lighting and the ceremony-to-reception changeover are included. Does Sean perform at every booking? Is the roster on `/the-scene` fixed, or assembled per event? |
| O2 | Contingency | Sean | Open | Substitutes if a musician is ill, equipment failure, weather for outdoor ceremonies, setup and load-in time, cancellation and rescheduling |
| O3 | Custom song terms | Sean | Open | Revision rounds, timeline, delivery formats, personal-use rights and ownership, whether it can be booked on its own |
| O4 | Travel | Sean | Open | Travel and destination policy; the regions served without a travel fee |
| O5 | Public pricing | Sean | Open | Recommendation: a private investment guide after inquiry now; revisit a "from" figure once inquiry volume is measurable |
| O6 | Lead tier weights | Sean | Open | `scoreLead` (fit, relationship, urgency) is a starting point. After about 90 days of outcomes, compare tiers with booked revenue and adjust |
| O7 | Body typeface | Sean | Open | Geist or a humanist sans; test one alternative on the home page |
| O8 | Scout's AI backend | Sean | Open | `12-scout-backend-decision.md` |

The FAQ and Scout answer these only in general terms until a row is approved. Scout's knowledge already says "do not invent terms".

## 5. Sales materials

| ID | Material | Owner | Status | What it needs |
|---|---|---|---|---|
| P1 | Private investment guide (PDF, sent after inquiry) | Sean | Open | O1, O5 |
| P2 | Planner pack: COI sample, W-9, rider, stage plot, a one-page capabilities sheet, an example day timeline, a named contact | Sean | Open | O1, O2. `/planners` lists the pack from `src/data/planner-pack.json`: a document becomes a download once its file is in `public/downloads/` and its `file` is set (the song list is live). The COI and W-9 stay private, sent on request (a test enforces it) |
| F1 | Post-event and rebooking emails T1 to T7 (`16-follow-ups-and-referrals.md`) | Sean | Open | Approve or edit each template, choose what T3 delivers and whether T7 runs, then switch the workflows on in SHA-BAM |
| P3 | Three event stories: one full wedding day, one private or corporate event, one planner collaboration | Sean | Open | Footage, photos and the clients' consent |
| P4 | A story for each room in `credits.json` | Sean | Open | Each venue page becomes indexable once its story exists |
| P5 | Repertoire by moment (`repertoire.json`) | Sean | Pending | Sean confirms and extends it |
| P6 | Mark and Aimee's story, missing player bios, format montages, the SHA-BAM consultation URL | Sean | Open | From the November 10 brief (`10-sce-build-brief.md`); the SCE YouTube channel is live in `site.ts` |

## 6. Brand migration (at launch)

| ID | Item | Owner | Status |
|---|---|---|---|
| B1 | Instagram, YouTube and Facebook bios and links point to the new site and SCE wording (no artist or band-era copy) | Sean | Open |
| B2 | Directory listings (Bark, Thumbtack, GigSalad, Google Business Profile) use the SCE name, formats and link | Sean | Open |
| B3 | The old SmartSite is retired; every legacy URL 301s (`astro.config.mjs`) | Technical | Approved (redirects built; verified at DNS cutover) |
| B4 | Search Console: new sitemap submitted, legacy URLs re-crawled | Technical | Open (at launch) |

## 7. Technical acceptance

| ID | Proof | Owner | Status | Evidence |
|---|---|---|---|---|
| A1 | Inquiry accepted, stored before delivery, de-duplicated | Technical | Local verified | Unit tests; `wrangler dev`; staging: `scripts/staging.sh smoke` |
| A2 | Cron fires; a failed delivery recovers without losing the lead | Technical | Local verified | `scripts/staging.sh cron` and `retry` (`13-staging.md`) |
| A3 | Notification and confirmation emails arrive (Resend) | Technical | Open | Staging with a Resend test key |
| A4 | SHA-BAM contact, opportunity and note; no duplicate opportunity on retry | Technical | Open | Needs a SHA-BAM test sub-account |
| A5 | Calendar answers correct (holds calendar, DST, errors read as unknown) | Technical | Local verified | `evals/availability.test.mjs`; staging with real calendars |
| A6 | Scout evals pass (never claims an inquiry was sent) | Technical | Open | `npm run eval:scout` with an API key |
| A7 | Alerts configured (`06-launch-checklist.md`, Security) | Technical | Open | Test alert received |
| A8 | Real devices and accessibility | Technical | Open | `06-launch-checklist.md`, Pre-launch QA |
| A9 | Launch approval | Sean | Open | Sections 1–6 settled, A1–A8 verified |
