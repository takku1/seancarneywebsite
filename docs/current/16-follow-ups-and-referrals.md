# Follow-ups and referrals

Most of SCE's best bookings come from people who have already seen Sean work: planners, venues, past couples and their guests, and companies that book every year. This page covers how the site records where a lead came from, the SHA-BAM workflows that look after those relationships after an event, and the 90-day review that shows which sources produce bookings. The reasoning is in `docs/research/reports/2026-11-12 Trust, referrals and repeat business.md`. Pipeline stages are in `04-integrations-and-workflows.md`; owners and service levels in `15-booking-operations.md`.

## How a lead's source is recorded

| What | Where it comes from | Where it goes |
|---|---|---|
| Automatic attribution (first and last channel, UTMs, landing page) | The browser (`src/lib/analytics/attribution.ts`) | CRM note; `source: website:<channel>` |
| **How they heard about Sean** (`heard_via`): planner, venue, past client or guest, friend or family, search, social, directory, other | The visitor's own answer, optional: the inquiry form's last step, or Scout when they mention it | CRM field `heard_via` and tag `heard:<value>`; Sean's notification ("Heard via"); `inquiry_submit` analytics event |
| **Who referred them** (`referrer`), asked only for the first four answers | The visitor's own words. Scout keeps a name only if the visitor typed it | CRM field `referred_by`; Sean's notification ("Referred by"). Never stored in the browser draft or sent to analytics |

The answer also feeds lead scoring (`scoreLead`, `src/lib/inquiry/schema.ts`): a referral from a planner or venue counts like a trade partner (relationship 30, tier A), one from a past client or friend half as much (15). The larger relationship signal applies; nothing is penalised for being self-found.

A changed referral answer on its own does not make a Scout inquiry a new lead: like attribution, it is context, not content (`src/lib/scout/draft.ts`).

**SHA-BAM setup (once):** create contact custom fields `heard_via` and `referred_by` (single-line text), map them in the inbound webhook if it is used, and create smart lists filtered by tag `heard:planner`, `heard:venue`, `heard:past_client` and `heard:friend`.

## Workflows (SHA-BAM, no site code)

Each runs on the "Bookings" pipeline. Times count from the event date (`event_date` on the opportunity). Every template below is a draft in the house voice; **Sean approves each one before it is switched on** (F1 in `14-decision-register.md`). Anything in [brackets] is a choice Sean makes, never a promise the site has made.

| ID | Trigger | Wait / condition | Action |
|---|---|---|---|
| W1 Thank-you | Stage → Completed | Day 1 | Email T1 (couple or client) |
| W2 Review | W1 sent | Day 3, no review tag yet | Email T2 with the Google review link; on a reply giving permission to quote, record it in `testimonials.json` with an approval (register section 2) |
| W3 The ending | Stage Completed | Day 10 to 14; only if Sean has something to send (the custom-song recording, or a clip of their first dance) | Email T3 with it, plus one referral line |
| W4 Planner and venue thank-you | Stage Completed, contact has a planner or the lead came `heard:planner` / `heard:venue` | Day 2 | Email T4 to the planner or venue contact; task for Sean to send them footage or photos from the event |
| W5 Referral thank-you | New opportunity with `referred_by` set | Stage → Booked | Task: Sean thanks the referrer personally (T5 as a starting point). No payment or commission |
| W6 Corporate rebooking | Stage Completed, `event:corporate` or `event:gala` | Day 300 (about ten months) | Email T6; task for Sean to call if no reply in 7 days |
| W7 Anniversary note (optional) | Stage Completed, `event:wedding` | Day 365 | Email T7. Sean decides whether to switch this on |

Stop rules for every workflow: the contact unsubscribes, replies, or has an open opportunity in progress (no follow-up lands on top of a live conversation).

## Templates

Short, warm, in Sean's voice: no exclamation marks, no urgency, no discounts.

**T1, thank-you (day 1).** Subject: *Thank you, [first names]*
> [First names], thank you for having us at [venue]. It was a privilege to play for you and your people, and [one specific moment Sean remembers]. I hope today is a quiet one. Warmly, Sean

**T2, review (day 3).** Subject: *A small favour*
> If you have a minute, a few words about the day would mean a great deal: [Google review link]. And if you are happy for us to share a line of it on our site, just reply to say so. Thank you again, Sean

**T3, the ending (day 10 to 14).** Subject: *[Your song / Your first dance]*
> [First names], here is [the recording of your song / your first dance] from [venue]: [link]. It was a joy to write and to play. If friends of yours are planning their own celebration, I would be glad to hear from them. Sean

**T4, planner or venue (day 2).** Subject: *Thank you for [couple's names]*
> [Name], thank you for a smooth day at [venue]. Working with you made it easy. I'll send over [photos / a short clip] from the evening for your own use. I hope we share a room again soon. Sean

**T5, referral thank-you (when the referred lead books; Sean sends it personally).**
> [Name], [client] tells me you sent them our way. Thank you, that means a great deal. [Optional, Sean's choice: a handwritten card, flowers, or a note.]

**T6, corporate rebooking (day 300).** Subject: *[Event name], [next year]*
> [Name], it has been almost a year since [event] at [venue]. If you are planning it again, I would love to be part of it, and I'm happy to keep what worked and change what you'd like. Would a short call next week suit? Sean

**T7, anniversary (day 365, optional).** Subject: *One year*
> [First names], a year ago today we played [your song] at [venue]. Wishing you a very happy anniversary. Sean

## The 90-day source review

Every 90 days (the first one 90 days after launch), alongside the tier review in `15-booking-operations.md`:

1. **Inquiries by source:** `GET /api/leads?report=sources` (admin token): inquiries per `heard_via` answer and tier for the last 90 days (counts only, no personal data; `days` up to 180).
2. **Bookings by source:** in SHA-BAM, won opportunities and their value grouped by tag `heard:<value>`, and by the `source` field for automatic attribution.
3. **Read it as a funnel:** inquiries → booked → value, per source. A source with few inquiries and a high win rate (usually planners) earns attention; one with many inquiries and no bookings earns a closer look at fit.
4. **Act on the planner and venue rows:** who sent work this quarter, and have they been thanked (W4, W5)?
5. **Tune the weights** in `scoreLead` only with outcomes behind them (O6 in the register).

Unanswered "how did you hear" (`unknown`) is normal; it is optional by design and never made required.
