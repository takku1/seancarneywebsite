# Launch checklist

Everything here must be confirmed with Sean before the site goes live. Each item is a claim the site makes or a setup step.

## Facts and flavor found online (added to the site)
Sean's own claims are treated as true. Online research added detail:
- *Songland* specifics (S2, WOLVES pitching "Miracle" to Martina McBride, aired 2020-05-04); WOLVES placements (*Fast & Furious 9*, The CW's *All American*, MLB, BET, SiriusXM Hits 1)
- Recording Academy voting member (his Instagram bio); Telepictures Music (Warner Bros. TV library) releases
- Luxury rooms: Ritz-Carlton Laguna Niguel, Hotel del Coronado, The Beverly Hills Hotel, The Biltmore, Harvard & Stone
- Releases: *The Otherside* (2025), *California Cowboy* (2026-08-14, now featured)
- Named public reviews (Alexander Sugarman, Alison V., Gina, Austin, Anthony Morison) and event clips (Ritz-Carlton, Hotel del Coronado, 2025 reel)
- The "Tale of Two Sean Carneys" story (About page)

Housekeeping for Sean: his Apple Music profile is merged with the Ohio blues Sean Carney (ask his distributor to split it); the band name varies (The Hustlers / Goldmine / The SCENE); Bark shows 5.0 from 15 reviews if he wants a third-party rating.

## Claims to confirm
- [ ] **Event count**: main site says 1,000+ events; events site says 500+ hired and 100+ per year. Site currently shows 1,000+ (`src/config/site.ts`).
- [ ] **Billboard**: "Billboard-charting songwriter" (used) vs "Billboard Hot 100-charting singles" (old home page).
- [ ] **Response time**: site promises a reply "within one business day" (`site.responseTime`). Only keep it if it's always true.
- [ ] **Insurance / paperwork**: COI naming the venue, W-9, stage plot, tech rider "on request" (FAQ + corporate specs).
- [ ] **Custom songs** for brands (corporate FAQ).
- [ ] **Endorsements**: Vox, Warm Audio (stored, not shown anywhere).
- [ ] **Named testimonials**: Jordan and Isabela, Timea and Kris, Olivia and John were already public on the events site. Confirm they're happy to appear.
- [ ] **Logo use**: Netflix, NBC, Hyundai, Billboard, NHL marks in the home "As seen on" marquee (`logoApproved` in `credits.json`).
- [ ] **Clients**: Informa Markets, Hawke Media, Terranea Resort (from events-site logos).

## Content and assets wanted
- [ ] Vector script signature logo (the "Sean Carney" script on the events site, used as the events-zone wordmark)
- [ ] WANTED release date, Spotify **artist** profile URL, Apple Music URL
- [ ] Real public appearance dates (the `appearances.json` page hides empty modules)
- [ ] The Hustlers lineup options; travel policy
- [ ] Original photo shoots in full resolution plus photographer credit lines
- [ ] Choose a hero reel cut from the 4K events video (`698d14a49d6101e137cc5230.mp4`, 79s)

## Fan lists (Shows / Merch "notify me")
- [ ] In GHL, build three workflows on tags `notify:shows`, `notify:merch` and `notify:news` (welcome email; later, announcement emails). `notify:news` is the main fan list (footer, release pages, `/links`, engagement prompt). Contacts also get `fan` and `city:<slug>`.
- [ ] Point the Instagram/TikTok bio links at `/links` with UTMs (exact URLs in `05-growth-and-engagement.md`) and retire Linktree.
- [ ] Add Apple Music (and YouTube Music) links to each release in `releases.json`; release pages pick them up automatically.
- [ ] Optional lead magnet for the fan list (unreleased demo or acoustic version) sent by the `notify:news` welcome workflow.
- [ ] Add real public dates to `apps/web/src/data/appearances.json` with ticket `url`s: `/shows` switches to a date list with "Get tickets" buttons automatically.
- [ ] City demand appears in `/api/scout/insights` under `notify.shows`.

## Security (from docs/security/SECURITY.md)
- [x] Rate Limiting bindings `RATE_LIMITER_STRICT` / `RATE_LIMITER` and KV `SCOUT_KV` declared in `apps/web/wrangler.jsonc` (KV is provisioned on first deploy).
- [ ] Add a Cloudflare WAF rate rule on `/api/*` as an outer layer.
- [ ] Put Cloudflare Access (email login) in front of `/api/scout/insights`.
- [ ] Cloudflare dashboard: minimum TLS 1.2, always use HTTPS; submit the domain to hstspreload.org.
- [x] CSP enforced: one header policy; `integrations/csp-header-hashes.mjs` writes the SHA-256 hashes of every inline script/style into `_headers` at build (no unsafe-inline). Crawled clean on all pages; consent flow verified with test vendor IDs.
- [ ] After turning on GA4 / Clarity / Meta / Turnstile, check `csp_violation` logs for a week (vendor scripts weren't exercised locally).
- [ ] DNS: add DMARC (`_dmarc` TXT `v=DMARC1; p=none; rua=mailto:<reports address>`), move to `p=quarantine` after 2–4 clean weeks. Verify the sending domain in Resend (adds its DKIM record and a `send.` return-path subdomain) before inquiry emails go live.
- [ ] Set up a Cloudflare notification for Worker error-rate spikes; review security events weekly.

## Pre-launch QA
- [ ] Confirm the booking process wording on /private-events FAQ ("date is held once the agreement is signed") and /terms.
- [ ] Test on a real iPhone (Safari), Android (Chrome), and inside the Instagram in-app browser: hero video autoplay, Scout panel, inquiry form, notify forms, and the mini-player (start a video on /music, browse two pages: it should keep playing in Chrome and resume at the same second in Safari).
- [ ] Print `/press/one-sheet` to PDF and check it lands on one Letter page (verified in Chrome on 2026-11-03); proofread it with Sean.
- [ ] Run one release page through Google's Rich Results Test / Schema Markup Validator.
- [ ] Submit `sitemap-index.xml` in Google Search Console and Bing Webmaster Tools; verify `llms.txt` is reachable.

## Accounts and setup (env vars in `apps/web/astro.config.mjs`)
- [ ] Plausible (`PUBLIC_PLAUSIBLE_DOMAIN`), Microsoft Clarity (`PUBLIC_CLARITY_ID`)
- [ ] GA4 / Meta Pixel only when ads start (`PUBLIC_GA4_ID`, `PUBLIC_META_PIXEL_ID`); with the pixel, set the `META_CAPI_ACCESS_TOKEN` secret for server-side conversions and confirm in Events Manager that Lead / CompleteRegistration show "deduplicated" (browser + server).
- [ ] Cloudflare Turnstile keys (`PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`)
- [ ] GoHighLevel inbound webhook URL (`GHL_WEBHOOK_URL`); map custom fields: lead_tier, lead_score, event_type, budget, first/last channel
- [ ] Resend (`RESEND_API_KEY`, `INQUIRY_FROM_EMAIL`, `INQUIRY_NOTIFY_EMAIL`) with a verified sending domain
- [ ] Google Business Profile; request fresh Google reviews
- [ ] Point DNS to Cloudflare Workers. 301s for all old URLs, including the hidden events site, are already configured in `astro.config.mjs`.

## Experiments running at launch (read results by `exp_*` property)
| id | arms | primary metric |
|---|---|---|
| `hero_sub` | status / service | inquiry_start per home visit |
| `cta_label` | Inquire / Check a date | cta_click to inquiry_submit |
| `events_theme` | ivory / night | inquiry_start per event-page view |

Force an arm for QA with `?exp_<id>=<variant>`; turn on the console event log with `?debug_analytics=1`.
