# Launch checklist

Everything here is confirmed with Sean before the site goes live. Each item is a claim the site makes, an asset it needs, or a setup step.

## Claims to confirm
- [ ] **Event count:** 1,000+ events across fifteen years (`src/config/site.ts`). Older sources say 500+ hired and 100+ per year.
- [ ] **Rooms named on the site:** Hotel del Coronado, The Beverly Hills Hotel, The Ritz-Carlton Laguna Niguel, Terranea, The Biltmore (category `room` in `credits.json`; shown on the home page, About and the inquiry page). Sean confirms each was a real engagement and is fine to name.
- [ ] **Clients named:** Salesforce, Autodesk, VCA, MacLean Power Systems, Informa Markets, Hawke Media.
- [ ] **Credentials line** on About (Paris Olympics coverage, NFL Playoffs, Netflix): wording approved by Sean.
- [ ] **Response time:** "within one business day" (`site.responseTime`); keep only if it is always true.
- [ ] **Insurance and paperwork:** COI naming the venue, W-9, stage plot and tech rider available on request.
- [ ] **Named testimonials:** Jordan and Isabela, Timea and Kris, Olivia and John (public on the earlier events site); each couple confirms they are happy to appear.
- [ ] **Formats:** the Solo, Duo and Band options Sean actually offers, and the band's name (The Scene is used throughout).

## Content and assets
- [ ] Usage rights and photographer credit lines for the supplied wedding photography and films (the November 10 Drive set, used on Home, Weddings and `/the-scene`). Some pages still use legacy artist portraits, marked in `media-library.json`.
- [x] The hero film loop: the supplied `SCE WEBSITE HERO FINAL.mov`, cut to a muted 40-second loop in desktop and phone sizes.
- [ ] The script signature logo as a vector.
- [ ] Repertoire by moment: `src/data/repertoire.json` holds only songs already in Sean's own lists and filmed covers; Sean confirms and extends it.
- [ ] Travel policy and destination-wedding notes.
- [ ] The planner pack (COI sample, W-9, rider, stage plot) ready to send: `/planners` requests it by email.
- [ ] A short story for each room in `credits.json` (`story`): the setting, the formats, a moment. Each venue page becomes indexable once its story exists.
- [ ] The private investment guide sent after inquiry (pricing posture: `01-positioning-and-offer.md`).

## Security (from `docs/security/SECURITY.md`)
- [x] Rate-limiting bindings `RATE_LIMITER_STRICT` / `RATE_LIMITER` KV `SCOUT_KV` and D1 `LEADS_DB` declared in `apps/web/wrangler.jsonc` (KV is provisioned on first deploy).
- [ ] `LOG_HASH_KEY` secret (`openssl rand -hex 32`) so security-log pseudonyms are stable across Worker instances.
- [x] CSP enforced: one header policy; `integrations/csp-header-hashes.mjs` writes the SHA-256 hashes of every inline script and style into `_headers` at build (no `unsafe-inline`).
- [ ] A Cloudflare WAF rate rule on `/api/*` as an outer layer.
- [ ] Cloudflare Access (email login) in front of the admin routes `/api/scout/insights` and `/api/leads` (they already require `SCOUT_ADMIN_TOKEN`).
- [ ] Cloudflare dashboard: minimum TLS 1.2, always use HTTPS; submit the domain to hstspreload.org.
- [ ] After turning on GA4 / Clarity / Meta / Turnstile, watch `csp_violation` logs for a week.
- [ ] DNS: DMARC (`_dmarc` TXT `v=DMARC1; p=none; rua=mailto:<reports address>`), moving to `p=quarantine` after 2–4 clean weeks; verify the sending domain in Resend (DKIM plus a `send.` return-path subdomain) before inquiry emails go live.
- [ ] A Cloudflare notification for Worker error-rate spikes; a weekly review of security events.
- [ ] An alert on lead log lines `lead_undeliverable`, `lead_crm_abandoned` and `lead_notify_abandoned` (Workers Logs). An abandoned notification means Sean was never told about that lead: check `GET /api/leads`, contact the couple, then `POST /api/leads` with `{"reopen": true}` once the cause is fixed.
- [ ] Confirm the 15-minute cron trigger is listed under the Worker's Triggers after the first deploy.

## Pre-launch QA
- [ ] The booking wording on the FAQ ("the date is held once the agreement is signed") and `/terms`.
- [ ] Real devices: iPhone (Safari), Android (Chrome), and the Instagram in-app browser. Check the hero film, Scout, the inquiry form, the date check, and the mini-player (start a film, browse two pages: it keeps playing in Chrome and resumes at the same second in Safari).
- [ ] On staging, send a real test inquiry: it returns success, the notification and confirmation emails arrive, and the lead appears in SHA-BAM (or in `GET /api/leads` while SHA-BAM is deferred). With email and CRM both switched off and no lead store, the form must show the direct-email message instead of success.
- [ ] Run the home and weddings pages through Google's Rich Results Test.
- [ ] Submit `sitemap-index.xml` in Google Search Console and Bing Webmaster Tools; confirm `/llms.txt` is reachable.

## Accounts and setup (env vars in `apps/web/astro.config.mjs`)
- [ ] Plausible (`PUBLIC_PLAUSIBLE_DOMAIN`), Microsoft Clarity (`PUBLIC_CLARITY_ID`).
- [ ] GA4 and Meta Pixel when ads start (`PUBLIC_GA4_ID`, `PUBLIC_META_PIXEL_ID`); with the pixel, the `META_CAPI_ACCESS_TOKEN` secret, then confirm in Events Manager that `Lead` shows as deduplicated (browser + server).
- [ ] Cloudflare Turnstile keys (`PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`). **Required:** without the secret, production rejects every inquiry (logged as `turnstile_secret_missing`).
- [ ] SHA-BAM (GoHighLevel) private integration or inbound webhook (`GHL_*`); custom fields: lead_tier, lead_score, event_type, budget, first/last channel. Deferred until Sean supplies the account details. Leads taken before it is connected wait in `LEADS_DB`; once it is, the 15-minute cron backfills them automatically (or run `POST /api/leads` with the admin token, repeating with `nextCursor`), then check `GET /api/leads` shows nothing open.
- [ ] The call-booking link for the thank-you page (`PUBLIC_CALL_BOOKING_URL`).
- [ ] Resend (`RESEND_API_KEY`, `INQUIRY_FROM_EMAIL`, `INQUIRY_NOTIFY_EMAIL`) with a verified sending domain. **Required before launch:** while SHA-BAM is deferred, the notification email is the only way Sean hears about a new lead (stored leads alone notify no one).
- [ ] Scout with AI on: a monthly spend limit on the API key's workspace in the Claude Console. `SCOUT_DAILY_LIMIT` is a soft cap (KV counters are not atomic); the Console limit is the hard one.
- [ ] Google Business Profile, and a review request after every event (`04-integrations-and-workflows.md`, Completed stage).
- [ ] The wedding Instagram bio links to `/links?utm_source=instagram&utm_medium=social&utm_campaign=bio`.
- [ ] DNS points to Cloudflare Workers; the 301s for every legacy URL are in `astro.config.mjs`.

## Experiments at launch (read results by `exp_*` property)
| id | arms | primary metric |
|---|---|---|
| `hero_sub` | the two hero lines | `inquiry_start` per home visit |
| `cta_label` | "Check your date" / "Inquire" | `cta_click` to `inquiry_submit` |

Force an arm for QA with `?exp_<id>=<variant>`; turn on the console event log with `?debug_analytics=1`.

## Housekeeping for Sean
- His Apple Music profile is merged with an Ohio blues musician of the same name; his distributor can split it.
- Bark shows 5.0 from 15 reviews, if he wants a third-party rating to reference.
