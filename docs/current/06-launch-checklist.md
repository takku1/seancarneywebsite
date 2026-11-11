# Launch checklist

Technical setup and QA before the site goes live. Approvals from Sean live in `14-decision-register.md`.

## Approvals, claims and content
Every claim, testimonial, media right, offer decision and sales material Sean must approve is tracked in one place: `14-decision-register.md`. Launch needs sections 1–6 there settled (approved, or removed from the site).

- [x] The hero film loop: the supplied `SCE WEBSITE HERO FINAL.mov`, cut to a muted 40-second loop in desktop and phone sizes.

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
- [ ] Alerts as listed in `15-booking-operations.md` (Alerts), including the absence of `lead_cron_run` for 30 minutes. Send a test alert and confirm it arrives.
- [ ] After the first production deploy, confirm the D1 database `seancarneymusic-leads` was created and bound as `LEADS_DB` (Worker > Settings > Bindings) and the 15-minute cron is listed under Triggers. Staging proves the same for its own database first (`13-staging.md`).

## Pre-launch QA
- [ ] The booking wording on the FAQ ("the date is held once the agreement is signed") and `/terms`.
- [ ] Real devices: iPhone (Safari), Android (Chrome), and the Instagram in-app browser. Check the hero film, Scout, the inquiry form, the date check, and the mini-player (start a film, browse two pages: it keeps playing in Chrome and resumes at the same second in Safari).
- [ ] Staging passes `bash scripts/staging.sh` smoke, cron, and retry (`13-staging.md`): D1 bound, the cron fires, an inquiry is stored before delivery, and a broken delivery recovers without losing the lead.
- [ ] On staging, send a real test inquiry: it returns success, the notification and confirmation emails arrive, and the lead appears in SHA-BAM (or in `GET /api/leads` while SHA-BAM is deferred). With email and CRM both switched off and no lead store, the form must show the direct-email message instead of success.
- [ ] Run the home and weddings pages through Google's Rich Results Test.
- [ ] Submit `sitemap-index.xml` in Google Search Console and Bing Webmaster Tools; confirm `/llms.txt` is reachable.

## Accounts and setup (env vars in `apps/web/astro.config.mjs`)
- [ ] Plausible (`PUBLIC_PLAUSIBLE_DOMAIN`), Microsoft Clarity (`PUBLIC_CLARITY_ID`).
- [ ] GA4 and Meta Pixel when ads start (`PUBLIC_GA4_ID`, `PUBLIC_META_PIXEL_ID`); with the pixel, the `META_CAPI_ACCESS_TOKEN` secret, then confirm in Events Manager that `Lead` shows as deduplicated (browser + server).
- [ ] Cloudflare Turnstile keys (`PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`). **Required:** without the secret, production rejects every inquiry (logged as `turnstile_secret_missing`).
- [ ] SHA-BAM (GoHighLevel) private integration or inbound webhook (`GHL_*`); custom fields: lead_tier, lead_score, event_type, budget, first/last channel. Deferred until Sean supplies the account details. Leads taken before it is connected wait in `LEADS_DB`; once it is, the 15-minute cron backfills them automatically (or run `POST /api/leads` with the admin token, repeating until `processed` is 0), then check `GET /api/leads` shows nothing open.
- [ ] The call-booking link for the thank-you page (`PUBLIC_CALL_BOOKING_URL`).
- [ ] Resend (`RESEND_API_KEY`, `INQUIRY_FROM_EMAIL`, `INQUIRY_NOTIFY_EMAIL`) with a verified sending domain. **Required before launch:** while SHA-BAM is deferred, the notification email is the only way Sean hears about a new lead (stored leads alone notify no one).
- [ ] Scout with AI on: `ANTHROPIC_API_KEY` and `SCOUT_SIGNING_KEY` (`openssl rand -hex 32`) as Worker secrets. Without the signing key, production Scout stays in guided mode (logged as `scout_signing_key_missing`).
- [ ] Scout with AI on: a monthly spend limit on the API key's workspace in the Claude Console. `SCOUT_DAILY_LIMIT` is a soft cap (KV counters are not atomic); the Console limit is the hard one.
- [ ] Google Business Profile, and a review request after every event (`04-integrations-and-workflows.md`, Completed stage).
- [ ] The wedding Instagram bio links to `/links?utm_source=instagram&utm_medium=social&utm_campaign=bio`.
- [ ] DNS points to Cloudflare Workers; the 301s for every legacy URL are in `astro.config.mjs`.

## Experiments
Paused at launch (`active: false` in `src/lib/analytics/experiments.ts`): at launch traffic a two-arm test can't separate a real difference from noise. Everyone sees the first arm ("Bespoke wedding entertainment…", "Check your date"). When traffic allows, re-enable one and read it by the `exp_*` property; force an arm for QA with `?exp_<id>=<variant>`, and see the console event log with `?debug_analytics=1`.

## Housekeeping for Sean
- His Apple Music profile is merged with an Ohio blues musician of the same name; his distributor can split it.
- Bark shows 5.0 from 15 reviews, if he wants a third-party rating to reference.
