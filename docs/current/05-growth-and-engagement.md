# Growth and engagement

How the site turns attention (streams, social, press) into owned fans and booking leads, and how to read the results. Everything here runs on the existing first-party analytics (`src/lib/analytics`): events fan out to Plausible, GA4, Clarity and Meta (where configured and consented), and every event carries the active A/B arms.

## The two funnels

| Funnel | Path | North-star metric |
|---|---|---|
| **Booking** (revenue) | any page → `/private-events` or event page → `/inquire` → thanks | `inquiry_submit` per events-zone visit; lead tier mix |
| **Fan** (long-term value) | social / stream / press → release page or `/links` → list signup | `notify_signup` (topic `news`) per artist-zone visit |

The fan list is the one audience Sean owns outright: platforms can change reach overnight, an email list cannot be taken away. Grow it every week; it also becomes the seed audience for ads (lookalikes) and the first wave on every release.

## What's built

### Release smart-link pages: `/music/<release>`
One page per release (generated from `src/data/releases.json`) replaces Linkfire/Feature.fm-style links: cover, story, Spotify player, every platform link, share button, fan signup, "more music".
- **Upcoming release** (date in the future): the pre-save leads, styled as the primary action, and the date reads "Out <date>". After the date passes the page switches itself to "Out now" with no rebuild; the next build reorders links.
- Measured: `release_view` (Meta `ViewContent`), `stream_click` {platform, release}, `share` {method}, `audio_play`.
- Structured data: `MusicAlbum` / `MusicRecording` with cover image, date and `sameAs` streaming links (helps Google tie the release to Sean's knowledge panel).
- **Use this URL everywhere** a release is promoted: bios, ads, press releases, YouTube descriptions, email.

### Fan list (`news` topic)
- Signup in the footer (every page), on each release page, on `/links`, plus the engagement prompt.
- Contacts land in GoHighLevel tagged `fan` + `notify:news` (same pipeline as the shows/merch lists).
- Measured: `notify_start` (field focused), `notify_signup` {topic, location} (Meta `CompleteRegistration`). The start-to-signup ratio by `location` shows which placement converts.

### Engagement-triggered prompt (artist zone only)
Asks only after real interest, never on arrival: 15 s after a video or Spotify play starts, or at 75% scroll with 40 s+ of foreground time. Not a modal (never takes focus). Caps: once per session, 21 days after a dismissal, never after a signup. Never shown on event pages, `/inquire`, `/links` or the one-sheet, so it never competes with a booking.
- Measured: `fan_prompt_view` {trigger}, `fan_prompt_dismiss`, then `notify_signup` with `location=engagement_prompt`.
- Tune in `src/components/ui/FanPrompt.astro` (delays, dismissal window).

### Link-in-bio: `/links`
Replaces Linktree: featured release, booking, Spotify, YouTube, shows, merch, press, socials and the fan signup, mobile-first, no header/footer. `noindex` (thin by design) and excluded from the sitemap.
- Measured: `links_click` {link}.
- **Bio URLs** (UTMs give each profile its own row in reports):
  - Instagram (artist): `seancarneymusic.com/links?utm_source=instagram&utm_medium=social&utm_campaign=bio`
  - Instagram (events): `seancarneymusic.com/links?utm_source=instagram&utm_medium=social&utm_campaign=bio_events`
  - TikTok / YouTube / Facebook: same pattern with `utm_source=tiktok|youtube|facebook`

### Press kit downloads and one-sheet
- `/press` photos download as JPGs at the largest size held (size shown under each). Measured: `press_photo_download`.
- `/press/one-sheet`: bookers' one-pager generated from the same content (bio, credits, rooms, clients, formats, latest release, quotes, contact). "Print or save as PDF" produces one US Letter page. Measured: `one_sheet_print`. Always current, so it can be linked in outreach emails instead of attaching a PDF.

## Retention and views

### Measuring retention (no IDs)
`src/lib/analytics/retention.ts` keeps a small visit record in the visitor's browser (first visit date, last visit, count; disclosed on /privacy, cleared by "Clear data").
- **Every event** carries `visitor_type` (`new` | `returning`) and `visit_bucket` (`1` | `2` | `3-5` | `6+`). Any metric can be split by loyalty in Plausible/GA4, e.g. "do returning visitors inquire more?".
- `session_start` {visit_n, days_since_last} once per visit.
- **Cohort table**: once per visitor per week, an anonymous beacon adds 1 to `ret:<first-visit ISO week>.w<N>` in KV. `/api/scout/insights` returns `retention`: per cohort, `size` (new visitors that week) and `rate.wN` (share seen again N weeks later, up to 12). No ID, IP or page is sent. Cost: one KV write per visitor per week (fine on the Workers paid plan; the free plan allows 1,000 writes a day).
- Read it monthly: is week-1 and week-4 return rising? Compare cohorts that arrived during a release push with quiet weeks.

### Bringing people back
- **"New since your last visit"** (`src/lib/analytics/new-since.ts`): on a returning visit, the Latest feed, release cards and video tiles published since the previous visit get a "New" badge. Emits `new_since_seen` {count}. Any element with `data-published` participates.
- **Follow and subscribe** (`FollowLinks`): "Follow on Spotify" (new releases reach followers through Release Radar) and "Subscribe on YouTube" (the link opens the subscribe dialog via `sub_confirmation=1`) on every release page, the Music page and `/links`. Emits `follow_click` {network, location}. These are the off-site follows that bring a fan back with no ad spend.
- The fan list and engagement prompt (above). The prompt never covers a playing video: it asks when someone stops watching, never mid-binge.

### Video views and watch time
The click-to-load YouTube embeds now report real viewing, not just "pressed play":
- `video_progress` {percent: 25 | 50 | 75 | 90}, `video_complete`, and `video_watch` {seconds, max_percent, completed} once per video when the visitor leaves. Seconds count actual playback (seeks add nothing).
- **Up next**: when a video ends, the next one in the same rail is offered with an 8-second countdown (Cancel stops it; no countdown if the player is off screen). Emits `up_next_shown`, `up_next_play` {how: auto | click}, `up_next_cancel`. This raises videos per session.
- How it works: the embed URL carries `enablejsapi=1`, and the page listens to the player's own messages (accepted only from youtube-nocookie and from that exact iframe). No YouTube script is loaded, so the CSP is unchanged. YouTube does not formally document this message channel; if it changes, playback still works and only these metrics stop. Verified end to end in Chrome on 2026-11-03 (progress milestones, completion, Up next, auto-advance).
- Read weekly: completion rate (`video_complete` / `video_play`) per video. The clips people finish are the ones to pin on event pages and cut for short-form.

### Persistent player and navigation
- **Client router** (`ClientRouter` in `BaseLayout`): page changes swap in place with a short cross-fade (none under reduced motion). Scout, the consent bar, the fan prompt and the player dock persist (`transition:persist`), so a Scout conversation and a playing video survive navigation. `/links` and `/press/one-sheet` stay plain full-load pages.
- **Player** (`src/lib/media/player.ts` + `PlayerDock.astro`): one video at a time. It plays inline in its tile and **docks to a mini-player** (bottom-left) when the visitor scrolls away or browses to another page; "Back to video" returns it to its tile (navigating back if needed); scrolling back undocks it. When a docked video ends, the next one in the same rail continues in the dock. Starting a Spotify player or "Watch live" pauses it.
  - Chrome 133+: seamless (the iframe is moved with `moveBefore()`, playback never stops). Safari/Firefox: no scroll-docking; on navigation the video reloads in the dock and resumes from the same second.
  - Emits `player_dock` {reason: scroll | navigate, seamless}, `player_undock`, `player_close`, plus the watch metrics above. Verified on 2026-11-03 against the production build with the CSP enforced: one video played continuously across three pages in the same iframe.
- Hovering, focusing or touching a video warms the connection to YouTube (`preconnect`); internal links prefetch on hover.
- **Script lifecycle** (`src/lib/lifecycle.ts`): every page script binds through `onPage(setup, when?)`, which runs per page (DOM-ready on full loads, then after each swap), cleans up observers/listeners before the next swap, and is scoped to its page with `when`. New page scripts must use it.

### Ads measurement (Meta Conversions API)
`lib/integrations/meta-capi.ts` sends `Lead` (inquiry) and `CompleteRegistration` (list signup) server-side, deduplicated with the browser pixel through a shared `event_id`. It sends only with consent, no opt-out and no `Sec-GPC`; email/phone are SHA-256 hashed. Turn on by setting `PUBLIC_META_PIXEL_ID` and the `META_CAPI_ACCESS_TOKEN` secret. Fixed alongside: the thanks page's `generate_lead` was also mapped to Meta `Lead`, double-counting every inquiry; it is now GA4-only.

## UTM conventions
Lowercase, underscores, no spaces. `utm_source` = the platform, `utm_medium` = `social` | `email` | `paid_social` | `referral` | `press`, `utm_campaign` = `<release-id>` or `bio` or `<event-type>_<season>` (e.g. `california-cowboy`, `weddings_spring27`). Attribution keeps first and last touch on every lead, so a fan who found Sean through a release ad and later books a wedding is credited to both.

## Release campaign cadence
1. **4 weeks out**: add the release to `releases.json` with its future `date`, cover and DistroKid HyperFollow link (label `Pre-save`), and set `featured: true`. Rebuild. The home page, `/music`, `/links` and the release page all lead with it.
2. **Pre-save push**: point every post and ad at `/music/<id>?utm_campaign=<id>`. Email the `news` list once.
3. **Release day**: add Spotify/Apple/Bandcamp links (and the `spotify` URI for the player). Rebuild. Email the list ("out now"). The release page has already switched to "Out now" on its own.
4. **Weeks 1–3**: share live clips of the song; watch `stream_click` by platform and `notify_signup` by `location`.

## Weekly read (10 minutes)
- Retention: share of `session_start` that are `returning`; monthly, the cohort table in `/api/scout/insights` (week-1 and week-4 return).
- Video: `video_complete` / `video_play` per video; `up_next_play` (auto vs click) vs `up_next_cancel`; `follow_click` by network.
- Fan: `notify_signup` (news) count and the conversion rate by `location`; `fan_prompt_view` → signup rate; `links_click` mix.
- Music: `release_view` → `stream_click` rate per release (compare releases against each other and against your first month as the baseline); platform split.
- Booking: `inquiry_start` → `inquiry_submit`; lead tier mix; first-touch channel of qualified leads.
- Experiments: results by `exp_*` property (see the table in `02-launch-checklist.md`).

## Next levers (not built yet; each needs an asset, account or a decision)
- **Spotify in the persistent player**: Spotify embeds play inline and stop on navigation. Docking them (and listening depth) needs Spotify's iFrame API script allowed in the CSP.
- **Lead magnet** for the list: an unreleased demo or acoustic version as the signup reward (an incentive is the most-cited way to lift signups). Needs an audio file and a GHL welcome workflow that sends it.
- **Apple Music / YouTube Music links** on every release (add to `links`; the release page labels and tracks them automatically).
- **Short-form loop**: post each live clip with a "full set on the site" CTA pointing at the relevant event page.
