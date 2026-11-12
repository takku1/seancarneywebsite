# SHA-BAM setup kit

Working instructions for the native migration in doc 17. Nothing here implies the account has been configured. Use an unpublished duplicate and internal test contacts; keep production messaging paused for these draft workflows.

## Handoff inventory

From the repo root run `node scripts/prepare-shabam.mjs` after a fresh `npm run build` in `apps/web`. Output: `reports/shabam-prep/inventory.json` (gitignored). It lists built page paths, titles, descriptions, canonicals, indexing flags, redirect references, public asset hashes and the planner-pack configuration. Fill page IDs, preview URLs and acceptance into a working copy. HTML entities in metadata are preserved. This is a reference inventory, not a supported website import.

Upload only selected public derivatives after media approval. Never upload `resources/`, `.env`, a server bundle or private COI/W-9 files. Record the SHA-BAM media URL beside each selected source path. Rewrite internal media URLs to those verified locations. Preserve aspect ratios, alt text and video poster images. Keep the current site and domain mapping available for rollback.

## Configure data before forms

Inspect existing field IDs and types first; reuse matching fields. Labels below are intended mappings, not verified API names. Keep a field-ID worksheet locally without credentials. For repeat clients, contact fields are the latest contact details; each submission must preserve its event details in its submission record and associated opportunity. Do not let later contact updates rewrite an earlier event or trigger its reminders.

| Source key | Native target and type | Requirement |
|---|---|---|
| name, email, phone | Standard contact fields | Name/email required; phone optional |
| role, company | Contact role dropdown; company text | role required: couple, planner, corporate, venue, other |
| event_type | Event/opportunity dropdown | wedding, corporate, brand, estate, gala, destination, other |
| event_date, date_flexible | Event date; flexible checkbox | Date may be unknown; no automatic date reservation |
| location | Event text | Required, 2–160 characters |
| guests | Event dropdown | Under 50; 50 to 150; 150 to 300; 300 to 1,000; Over 1,000 |
| format | Event dropdown | solo, small (Duo), band, unsure |
| moments | Event multi-select | Ceremony, Cocktail hour, Dinner, Dancing, Featured performance, After-party |
| budget | Event dropdown | under_5k, 5k_10k, 10k_20k, 20k_40k, 40k_plus, discuss; use schema labels |
| message | Event long text | Optional, maximum 3,000 characters |
| heard_via | Submission/event source dropdown | planner, venue, past_client, friend, search, social, directory, other; optional |
| referrer | Event referred_by text | Optional, 120 characters; show only for first four referral answers; clear when answer changes |
| sms_consent | Explicit consent checkbox and audit evidence | Unchecked; record text/version/time/source; SMS only when granted |
| attribution | Native first/last source and UTMs | Preserve first touch; keep personal data out of analytics |
| lead_tier, lead_score | Workflow-computed fields | Internal; use scoring rules below; never reject a lower tier |

The event/opportunity-field capability and workflow access must be checked in Sean's account. If absent, retain event details in immutable submission records and associated notes, and stop event automation that cannot select the correct event. Do not silently collapse all bookings into contact fields.

## Inquiry and workflow build order

1. Build a native form/survey following the existing five-step reference. Validate required event type, location, budget, name, email and role; preserve optional date and referral answers. Test error/failure messages and spam controls. Completion means a recorded submission, not merely a button click.
2. Trigger one draft workflow from this exact form. Update/upsert the contact; create or associate the intended Bookings opportunity; append the event snapshot and attribution. Test duplicate submission behavior before enabling. Do not also enable external-form tracking capture or the old inquiry workflow for the same form.
3. Calculate fit, relationship and urgency using `src/lib/inquiry/schema.ts::scoreLead` as the reference. Budget contributes 5/15/25/30/35/20; selected format +5; 150+ guests +5. Valid date +5; 90–540 days additionally +10. Under 30 days urgency 30; under 90 urgency 15. Relationship is the maximum applicable signal: planner/venue role or referral 30; corporate role or past-client/friend referral 15. A: fit >=45, relationship >=30, or urgency >=30 with fit >=20. B: fit >=25, relationship >=15, or urgency >=15. Otherwise C. Test boundary dates and time zones; if native arithmetic cannot reproduce this, use manual prioritization and label parity pending.
4. Notify Sean with all submitted details, source and event link. Confirm receipt to the visitor with approved response-time wording. An inquiry is not a booking or a reserved date. Avoid duplicate native autoresponders. Verify both messages arrive from the authenticated sending domain.
5. Use the existing Bookings stages in doc 04. Keep contract, payment and calendar actions native. Only verified signing/payment events advance their corresponding stages. Test wrong-event and repeat-client cases.
6. Configure doc 16's post-event workflows as drafts. Activate only approved templates, with reply/unsubscribe/open-conversation suppression and the correct opportunity date. Confirm native email retry/failure alerts with an authorized failure test.

## Client portal setup

Inventory native Client Portal first; Client App Builder is optional and may need reseller/Labs access. Brand with approved SCE assets. Start with contracts, invoices, appointments and shared resources where enabled. Use existing portal authentication and standard login URL. Send private invitations only through the account workflow to the intended test contact. No shared dashboard magic link in website navigation.

Add a public “Client portal” link only after the real portal URL is verified. Do not show a nonfunctional placeholder. Event timelines/song requests/uploads are a second increment after event-level access is proven. Planner collaboration requires explicit event scope and separate financial permissions.

## Acceptance worksheet

For each row record date, tester, preview URL or native record ID, observed result and screenshot/log reference without customer data. “Pending” is not a pass.

| Test | Expected result | State |
|---|---|---|
| Invalid form and unknown date | Errors retain entered answers; unknown date accepted for manual check | Pending |
| Referral changed to search | Referrer cleared; source saved; no name in analytics/storage | Pending |
| Normal inquiry | Submission, correct contact/opportunity, notification and confirmation | Pending |
| Double send / workflow retry | No unintended duplicate booking or notification; recovery visible | Pending |
| Controlled email failure | Saved inquiry visible; alert arrives; restored delivery recovers | Pending |
| One contact, two events | Correct event data, dates, documents and follow-ups remain distinct | Pending |
| Two unrelated portal users | Neither can retrieve the other's records/files by URL or UI | Pending |
| Planner access | Only invited event; no financial access without explicit permission | Pending |
| Expired login / logout | Safe recovery; private records unavailable after logout | Pending |
| Calendar busy / unknown / DST | Correct conflicts; unavailable service never promises availability | Pending |
| iPhone, Android, Instagram browser | Form, media, portal login and navigation usable | Pending |
| Redirects and metadata | Inventory reconciled; real 301s, correct canonical/noindex, sitemap/robots | Pending |
| Analytics opt-out | Nonessential tracking suppressed; no referrer/client data in events | Pending |
| Rollback rehearsal | Previous website mapping and mail DNS recoverable | Pending |

## Release handoff

Required account inputs: access to Sean's correct sub-account; enabled website/portal/workflow modules; existing site/form/workflow IDs; authenticated sending domain; intended notification recipient; calendar and payment test configuration; approved portal URL. Required business inputs remain in doc 14 (claims, offer, media rights, response commitment and templates). Do not request credentials in repository files or chat.

Build acceptance precedes public replacement. No Cloudflare login, D1 provisioning or Resend key is required for the selected native target. The reference application's former guarantees and passing tests do not establish native acceptance. Maintain the reference build until the hosted replacement passes this worksheet.
