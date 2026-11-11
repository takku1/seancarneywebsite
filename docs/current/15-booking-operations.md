# Booking operations

The site's job ends when an inquiry reaches Sean, but the business only succeeds when that inquiry becomes a booked, well-run event. This page covers who owns each stage, what "healthy" means, which alerts show it isn't, and how booked outcomes flow back to improve the site. The pipeline stages and their automations are defined in `04-integrations-and-workflows.md` (Pipeline: "Bookings").

## Stages, owners and next actions

| Stage | Owner | Trigger | Expected next action |
|---|---|---|---|
| Inquiry received | Site | Form or Scout Send; the lead is stored (D1) | Sean is notified (email now, SHA-BAM once connected); the visitor gets a confirmation |
| Qualification | Sean | Notification or "New inquiry" opportunity | Reply within the promised time (C5 in `14-decision-register.md`); the tier only sets the reply order |
| Consultation | Sean | Reply sent, or a call booked | Call held; date, rooms, formats and moments understood |
| Proposal | Sean | Call done | Proposal and the private investment guide (P1); follow-ups at day 2 and day 5 |
| Contract and deposit | Sean (SHA-BAM workflows) | Proposal accepted | Contract signed; deposit paid; **the date goes on the holds calendar** so the site shows it as taken |
| Planning | Sean with the couple or planner | Deposit paid | Timeline, songs and sound; planner pack (P2) to the planner |
| Event | Sean and the musicians | Event week | Run of show confirmed; balance invoice |
| Completed | Sean (SHA-BAM workflows) | Day after | Thank-you; review request; testimonial permission recorded with an approval (`14-decision-register.md`, section 2) |
| Lost | Sean | Manual | Reason recorded (price, date, chose other, no reply) |
| Date released or moved | Sean | Cancellation, reschedule, or a hold that lapses | The holds calendar is updated the same day: the old date removed, the new one added |

## Service levels

| Signal | Healthy | Where to see it |
|---|---|---|
| Inquiry stored | Every accepted inquiry is in D1 or the CRM | `GET /api/leads`; `lead_undeliverable` never fires |
| Sean notified | Within 30 minutes of acceptance | `lead_notify_overdue` (cron, every 15 minutes) |
| Visitor confirmation | Sent within minutes; dropped after 24 hours | `lead_confirm_expired` |
| First human reply | Within the promised time (C5) | SHA-BAM: time from "New inquiry" to "Contacted" |
| Cron running | A `lead_cron_run` line every 15 minutes | Workers Logs; alert when absent for 30 minutes |
| Calendar readable | Answers are open, tentative or busy, rarely unknown | `availability_calendar_error`, `availability_failed` |
| Scout healthy | Replies, or falls back to guided mode | `scout_provider_error`; daily cap events |

## Alerts

Set these in Cloudflare (Workers Logs alerts or a Logpush destination), sent to Sean's phone or email:

- **Act now** (a person may be waiting): `lead_undeliverable`, `lead_notify_overdue`, `lead_notify_abandoned`, `lead_delivery_crashed`, `lead_retry_crashed`, `turnstile_secret_missing`.
- **Same day:** `lead_crm_abandoned`, `lead_retention_expired_unresolved`, `scout_signing_key_missing`, `rate_limiter_unbound`, `rate_limiter_error`, `availability_failed` (repeated), `scout_provider_error` (repeated).
- **Absence:** no `lead_cron_run` for 30 minutes.

When an "act now" alert fires: open `GET /api/leads` (admin token), contact the couple directly from the inquiry if Sean was never notified, fix the cause, then `POST /api/leads` with `{"reopen": true}`.

## Weekly reconciliation (10 minutes)

1. `GET /api/leads`: anything still open beyond the SHA-BAM backlog is investigated.
2. SHA-BAM: every "New inquiry" older than the reply promise has been contacted.
3. Leads marked `repeat-inquiry` (the same person through the form and Scout, or a follow-up) are merged into one opportunity where they describe one event.
4. Lost opportunities have a reason.
5. The holds calendar matches the booked opportunities: every booked date is on it, and nothing else. The site's availability answers are only as accurate as this calendar.

## Outcome feedback

Each CRM contact carries the lead ID, tier, the fit, relationship and urgency scores, related leads, and first- and last-touch attribution. Each opportunity carries its won value. Together they answer:

- **Which channels produce booked revenue**, not just inquiries (the KPI in `04`).
- **Whether the tiers predict bookings.** After about 90 days, compare win rate and value by tier and by dimension, then adjust `scoreLead` (O6 in the register).
- **Where visitors abandon the form**, from the step events (`inquiry_step_complete`) in Plausible.
- **Why proposals are lost**, from the lost reasons.

A/B tests stay paused until there is enough traffic to read them (`src/lib/analytics/experiments.ts`), and are judged on booked outcomes, not clicks.

## Deliberately not built

These wait until real traffic and outcomes show they are needed:
- Customer accounts and client dashboards (SHA-BAM's client portal covers contracts and invoices).
- A CMS (the JSON content model stays simple while one person edits it).
- AI-generated pricing, and further Scout capabilities before Scout's live evals pass.
- More experiments.
