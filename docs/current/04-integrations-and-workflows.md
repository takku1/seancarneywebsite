# Integrations and booking workflows

How an inquiry becomes a booked, paid, reviewed wedding or event with as little manual work as possible. GoHighLevel specifics come largely from third-party guides, so **verify the exact menu and trigger names in Sean's sub-account**.

## The CRM is SHA-BAM (white-labeled GoHighLevel)
Sean's CRM is **SHA-BAM** (`app.sha-bam.com`, sha-bam.com), a reseller's white-label of GoHighLevel. Everything in this doc that says GoHighLevel or GHL happens inside Sean's SHA-BAM account: same features, same API (`services.leadconnectorhq.com`, which `lib/integrations/ghl.ts` calls), same Private Integration tokens. Verified 2026-11-03 from both sites' code (GoHighLevel's `leadconnectorhq.com`, `msgsndr.com` and `filesafe` asset hosts throughout, plus SHA-BAM's branded app domain).

- **Token:** in `app.sha-bam.com`, Settings > **Private Integrations**. GoHighLevel doesn't limit tokens by plan, but a reseller can hide the menu through Roles & Permissions; if it's missing, ask SHA-BAM support (support.sha-bam.com) to enable it for Sean's admin user. The webhook fallback (step 2.5) needs no token.
- **Support:** feature or permission questions go to SHA-BAM, not GoHighLevel. SHA-BAM's plans bill workflow "premium actions" (such as the inbound webhook trigger) and messaging credits.

## The architecture in one line
**Website (Astro on Cloudflare) → GoHighLevel (CRM, pipeline, SMS, contracts, invoices) ⇄ Google Calendar (single source of truth for dates) → back to the website's availability check.**

Sean already pays for GHL, which covers CRM, two-way Google Calendar sync, Documents & Contracts with e-signature, invoices through a connected Stripe account, SMS, and workflows. Adding HoneyBook or Dubsado would duplicate it. The website only captures, qualifies and attributes leads, then hands off.

```
Visitor ── /inquire (5 steps) ──► /api/inquire (Worker)
              │ date picked             ├─ validate · honeypot · Turnstile
              ▼                         ├─ score lead (A/B/C) + pipeline value from budget
        /api/availability ◄── Google    ├─ GHL API v2: upsert contact → opportunity "New inquiry" → note
        (free/busy only)     Calendar   └─ Resend: notify Sean + confirm to client
                                ▲
GHL workflows ──────────────────┘  booked stage creates the calendar block, so the site sees it
```

## Pipeline: "Bookings" (create in GHL > Opportunities > Pipelines)
| Stage | Entered when | Automation (GHL workflow) |
|---|---|---|
| New inquiry | Website creates the opportunity | Instant push/SMS to Sean for Tier A (tag `tier:A`); email/SMS auto-reply to lead; task "Reply within 1 business day" |
| Contacted | Sean replies | Stop the speed-to-lead reminders |
| Call booked | Lead books via `PUBLIC_CALL_BOOKING_URL` (GHL calendar) | Reminder 24h and 1h before (email + SMS) |
| Proposal sent | Sean sends a GHL proposal/estimate | Follow-up at day 2 and day 5 if unopened or unsigned |
| Contract signed | Documents & Contracts status Completed | Invoice auto-generated from the document's product line items (deposit); payment link by email and SMS |
| Booked (deposit paid) | Stripe payment received | **Create the event on the SCE holds calendar** (`GOOGLE_HOLD_CALENDAR_IDS`, two-way sync) so the website shows the date as taken; planner info pack email |
| Event week | 7 days before | Final timeline/run-of-show confirmation, balance invoice |
| Completed | Day after the event | Thank-you; ask for a Google review at day 2 (direct review link); ask permission to quote them on the site (feeds `testimonials.json`: consent `granted` plus an `approval` record, `14-decision-register.md`) |
| Lost | Manual | Reason dropdown (price, date, chose other); 9-month nurture |

The lost reasons and tiers become the data that tunes pricing bands and `scoreLead()` weights after 90 days (owners, service levels and the outcome loop: `15-booking-operations.md`).

## Setup checklist with every key

### 1. Google Calendar availability (`/api/availability`)
1. In Google Cloud Console, create a project and enable the **Google Calendar API**.
2. Under IAM, create a **service account** and add a JSON key. From that file, `client_email` goes to `GOOGLE_SA_EMAIL` and `private_key` goes to `GOOGLE_SA_PRIVATE_KEY`.
3. In Google Calendar, open each calendar Sean books against, then Settings > Share with specific people. Add the service account email with **"See only free/busy (hide details)"**.
4. Put the calendar IDs (Settings > Integrate calendar) in `GOOGLE_CALENDAR_IDS`, comma-separated. Recommended: a dedicated holds calendar of confirmed bookings and blocked dates in `GOOGLE_HOLD_CALENDAR_IDS`.
   - Any hold in the performance window (10am to midnight local) makes the date **busy** ("may be spoken for").
   - Personal calendars then only make it **tentative** ("Sean has something on that day; he'll confirm"), when their combined busy time, overlaps counted once, reaches an hour.
   - Without a holds calendar, that hour makes the date busy.
   - If any calendar returns an error, the answer is **unknown**, never open.
   - Day boundaries follow `AVAILABILITY_TIMEZONE`, including daylight-saving days, and "past" means before today in that time zone.
   - Rules and tests: `src/lib/integrations/google-calendar.ts`, `evals/availability.test.mjs`.
5. Logic: a date counts as "busy" if events cover at least 60 minutes between 10:00 and 24:00 local. The site only ever says "looks open" or "may be spoken for", never "confirmed".

*Why not GHL's free-slots API?* That answers "which 30-minute call slots are free", not "is this Saturday taken". Free/busy on the source calendar is simpler and private.

### 2. GoHighLevel CRM (`/api/inquire`)
1. In the sub-account, go to Settings > **Private Integrations**, create one with scopes contacts read/write and opportunities read/write, and copy the token to `GHL_PRIVATE_TOKEN`. It is shown only once.
2. Copy the location ID to `GHL_LOCATION_ID`.
3. Create the **Bookings** pipeline (stages above). Copy the pipeline ID to `GHL_PIPELINE_ID` and the "New inquiry" stage ID to `GHL_STAGE_NEW_ID`.
4. Leads arrive with tags (`website-inquiry`, `event:wedding`, `tier:A`, `role:planner`, `sms-consent`), an opportunity named `Wedding | 2027-09-18 | Malibu | Tier A` valued from the budget band, and a note holding every field plus attribution (first and last channel, UTMs, gclid/fbclid, landing page, experiment arms).
5. Optional fallback: a workflow with an **Inbound Webhook** trigger (a premium action) as `GHL_WEBHOOK_URL`. Create custom fields first, avoid apostrophes in field names, send a test lead, then "fetch sample" to map fields.
6. Connect Google Calendar in GHL (Settings > Calendars > Connections). Set it as the **conflict calendar** and use **two-way sync** so GHL bookings appear in Google and Google events block GHL.

### 3. SMS (GHL LC Phone): compliance required before any texting
- **A2P 10DLC registration** is mandatory for US business SMS. Brand approval takes about 1–3 days and campaign approval about 2–5 days.
- Campaigns require **Privacy Policy and Terms URLs** (Twilio requirement since 2026-06-30). The site provides both: `/privacy` and `/terms`.
- The inquiry form already captures explicit SMS consent (checkbox, unchecked by default). That flag travels as the `sms-consent` tag; only text contacts carrying it. The brand name, EIN and address must match public records exactly, which is the top reason for rejection.

### 4. Contracts, deposits, payments
- Connect **Stripe** in GHL Payments.
- Build a **Documents & Contracts** template (performance agreement) whose product line items include the deposit. When the document is signed, GHL generates the invoice automatically, and a workflow (Documents trigger, status Completed) sends the payment link.
- Deposit policy and cancellation terms go in the contract. The site's FAQ only says "proposal tailored to the event".

### 5. Email (Resend)
- Verify `seancarneymusic.com` in Resend and add its **SPF, DKIM and DMARC** DNS records (start DMARC at `p=none`). Gmail, Yahoo and Outlook enforce authentication in 2026, and unauthenticated mail can be rejected outright.
- Set `RESEND_API_KEY`, `INQUIRY_FROM_EMAIL` (e.g. `bookings@`) and `INQUIRY_NOTIFY_EMAIL`. Never send from an @gmail.com From address.

### 6. Spam: Cloudflare Turnstile
Dashboard > Turnstile > add the site; set `PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`. The widget loads only on the final step, in invisible/interaction-only mode.

### 7. Analytics and attribution
| Tool | Key | Purpose |
|---|---|---|
| Plausible | `PUBLIC_PLAUSIBLE_DOMAIN` | Source of truth; funnel `inquiry_view → inquiry_start → inquiry_step_complete → inquiry_submit → generate_lead`. Every event carries `visitor_type` and `visit_bucket` (new vs returning) and the active A/B arms |
| Microsoft Clarity | `PUBLIC_CLARITY_ID` | Heatmaps and replays, filtered by `exp_*` tags |
| GA4 | `PUBLIC_GA4_ID` | Only with ads; consent mode honors GPC and opt-out |
| Meta Pixel + Conversions API | `PUBLIC_META_PIXEL_ID`, `META_CAPI_ACCESS_TOKEN` | Browser pixel plus a server-side `Lead` from `/api/inquire`, deduplicated by a shared `event_id`; sent only with consent, no opt-out and no Global Privacy Control; email and phone SHA-256 hashed (`lib/integrations/meta-capi.ts`) |
| Google Ads | GCLID stored on the contact | Upload **booked revenue** (not just leads) through Google's **Data Manager API** when ads run; Ads API offline and enhanced-conversions-for-leads uploads are blocked since 2026-06-15. |

The KPI that matters is **booked revenue by first-touch channel**. It comes from GHL opportunities (won value) joined with the attribution note on each contact.

### 8. Media pipeline (films and social)
`src/lib/feeds/media.ts` merges curated data with live platform data at build time and ranks it:
- **YouTube** (`YOUTUBE_API_KEY`): all public uploads with views and duration. About 3 quota units per build out of 10k/day. *The legacy channel RSS feed returns 404 in 2026, so the API is required.*
- **Instagram** (`INSTAGRAM_ACCESS_TOKEN`): latest posts from the wedding account. Requires a professional account (the Basic Display API was retired in Dec 2024). The token lasts 60 days; refresh it monthly via `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=...`.
- **Ranking:** *best* = 45% popularity (log views) + 25% recency (180-day half-life) + 30% event relevance (live at events > covers, plus keyword boosts like ritz/hotel/wedding/reel). Original-music uploads are excluded. *For events* weights relevance highest.
- **Professional filter:** no Shorts (<60s or #shorts), embeddable only, `excludeYoutubeIds`, and view counts shown only above 10K.
- **Pins per placement** (`home`, `event_weddings`, …) in `feed-rules.json` always win, so Sean can force a clip.
- **Freshness:** a daily scheduled rebuild (Workers Builds deploy hook called by a Cron Trigger) keeps "newest" and view counts current.

### 9. Content updates and deploys
- Content lives in `apps/web/src/data/*.json`; edit it and publish with `scripts/publish.sh`, and Cloudflare rebuilds. A Sanity CMS is the planned editor (see `08-roadmap.md`).
- With Sanity, a Sanity webhook (on publish) points at a **Cloudflare Workers Builds Deploy Hook** (Worker > Settings > Builds > Deploy Hooks). The URL itself is the credential, so store it like a password. Builds are limited to 10 per minute and duplicate triggers are deduplicated.

### 10. Hosting
- Cloudflare Workers: `npx wrangler deploy` (or Git-connected Workers Builds). Set PUBLIC_* as build variables and everything else with `npx wrangler secret put NAME`.
- DNS for `seancarneymusic.com` moves to Cloudflare. All old GHL URLs already 301 (`astro.config.mjs`).

## Status
| Piece | Status |
|---|---|
| Inquiry form, lead scoring, attribution, Turnstile, Resend | Built |
| GHL API v2 contact, opportunity and note (webhook fallback) | Built; **needs a test against Sean's sub-account** (deferred until Sean supplies the details). Until then leads are held in `LEADS_DB` and emailed to Sean; after connecting, the 15-minute cron (or `POST /api/leads`) backfills them. On the test day, check whether the account can look up an existing opportunity for a contact (or accepts an idempotency key): that would close the one remaining duplicate window (a Worker dying between creating an opportunity and checkpointing it) |
| Google Calendar availability check plus inline form message | Built; **needs real credentials to test** |
| Discovery call link (`PUBLIC_CALL_BOOKING_URL`) | Built; needs the GHL calendar link |
| GHL pipeline, workflows, contract template, Stripe, A2P registration | Configure in GHL (no code) |
| Meta Conversions API | Built; activates with the pixel ID and token |
| Google Ads Data Manager uploads | When ads start |
| Media pipeline (YouTube, Instagram ranking) | Built; activates when keys are set |
| Sanity CMS plus deploy hook | Planned |

## Sources
- Google service-account JWT on Workers (Web Crypto, since google-auth-library doesn't run there): https://gist.github.com/koistya/95776c2e948095906d48d7e7b04aad0b
- GHL API v2 / private integrations (secondhand summaries, verify at marketplace.gohighlevel.com/docs): https://skills.sh/justin322322/ghl-skills/ghl-api-v2-%26-integrations
- GHL Google Calendar conflict and two-way sync: https://www.perspective.co/article/how-to-connect-google-calendar-to-gohighlevel, https://autogencrm.com/?p=3897
- GHL invoices from signed documents: https://help.gohighlevel.com/support/solutions/articles/155000001299-automatically-generate-invoices-from-signed-documents-contracts
- GHL inbound webhook mapping: https://manual.formwise.ai/formwise/advanced-features/data-and-workflows/sending-formwise-ai-responses-to-highlevel-workflows-via-webhook
- A2P 10DLC 2026 (privacy/terms URL requirement): https://www.twilio.com/en-us/changelog/a2p-10dlc-campaign-registration-will-require-privacy-policy-and- , https://www.ghlexperts.com/guides/gohighlevel-a2p-10dlc
- Google Ads Data Manager migration: https://support.google.com/google-ads/answer/16884284
- Gmail/Yahoo sender authentication 2026: https://powerdmarc.com/google-and-yahoo-email-authentication-requirements/
- Cloudflare Workers Builds deploy hooks: https://developers.cloudflare.com/workers/ci-cd/builds/deploy-hooks/
