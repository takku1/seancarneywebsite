# Site structure and design

**Current direction:** `10-sce-build-brief.md` applies SCE branding and an Élan-inspired player presentation. Navigation includes custom songs, players and a Watch page. `/custom-song` explains the supplied process; `/videos` presents existing films; Repertoire adds a four-step quiz, favorites and Do Not Play lists with reviewed inquiry handoff. The cream palette, typography and accessibility conventions remain.

## Navigation
**Weddings · Private events · Repertoire · Your song · Our players · Watch · About · Check your date**, with Instagram and YouTube icons at the top of every page beside the primary action. Private events opens a menu of its four event pages. One primary action, always visible (its label, "Check your date" or "Inquire", is an A/B test); everything else is a quiet text link.

## Pages
| Page | Purpose |
|---|---|
| `/` Home | the promise, the rooms, Sean, the three formats, the arc of the day, the custom song, the players, The SCE Experience, couples' words, one action, and the sticky listening bar |
| `/weddings` | the day as moments (ceremony, cocktail hour, dinner, first dance, reception), the format for each, details for the planner, how booking works (four steps), FAQ |
| `/private-events` | overview of private events, linking `/corporate`, `/galas`, `/estate`, `/destination` |
| `/repertoire` | 192 supplied songs, searchable by song/artist and filterable by style; 15 acoustic recordings and a full song-list download |
| `/custom-song` | the custom-song process: consultation, writing, studio recording, optional live performance; Sean's songwriting credits |
| `/videos` ("Watch") | The SCE Experience, then "Acoustic, up close" (`#acoustic`) and "High-energy performances for the perfect moment" (`#live`, My Girl featured), five YouTube clips each, played in the persistent dock; the sticky listening bar |
| `/the-scene` | a scrolling introduction to the band with five supplied portraits and biographies, and The SCENE live ("As It Was" at Hotel del Coronado) |
| `/about` | Sean, The SCENE, the rooms (linking to their venue pages), the one credentials line |
| `/planners` | the planner toolkit: paperwork, sound, ceremony, footprint, timing, music, privacy, lead time; a planner-pack request; planner FAQs |
| `/venues`, `/venues/<room>` | the rooms Sean has played; each page states only that he performed there, the formats for a day there, planner notes and a venue FAQ, plus Sean's own story when one exists |
| `/inquire` → `/inquire/thanks` | the five-step inquiry; the thank-you page sets out what happens next and offers a 15-minute call (`PUBLIC_CALL_BOOKING_URL`) |
| `/links` | link-in-bio for the wedding Instagram (@seancarneyentertainment) |
| `/contact` | three routes: weddings and private events, planners and venues, everything else |
| `/privacy`, `/terms`, 404 | |

**Search indexing of venue pages:** a venue page is `noindex` and left out of the sitemap until its room has a `story` in `credits.json` (Sean's own account); adding one makes it indexable on the next build. This keeps thin location pages out of search.

Legacy addresses (`/music` and its release pages to `/repertoire`, `/press` to `/about`, `/shows` and `/merch` to the home page, and the old GoHighLevel URLs) redirect with 301s configured in `apps/web/astro.config.mjs`.

## The home page
1. **Hero:** *"Your story. Your song. Anywhere in the world."*, then *"Luxury live music for weddings, private celebrations, and corporate events."* Beneath it: *Solo · Duo · Band · Custom Written Songs* (the last links to `/custom-song`). Media: the film loop with a poster image as the first paint. Actions: "Check your date" (primary; label A/B tested by `cta_label`, paused) and "Watch The SCE Experience", which opens the brand film (YouTube `bfN64mYoPCI`, `src/lib/media/experience.ts`) in a lightbox.
2. **The rooms:** the venues Sean has played drift slowly past, Amangiri first. A room shows its logo when Sean has supplied and approved one (`credits.json` `logo` + `logoApproved`, single-ink files in `src/assets/logos/`); otherwise its name is set as a wordmark. Hovering or focusing pauses it; under reduced motion it is a still, centred list.
3. **Sean:** his portrait beside Sean's own introduction (Recording Academy voting member, Billboard-charting, over 100 events a year).
4. **Customize your experience:** Solo ("Watch now", to `/videos#acoustic`), Duo ("Meet The SCENE") and Band ("Book full band service", to `/inquire?format=band`).
5. **The arc:** the day in moments, each with its format.
6. **The custom song, the players, The SCE Experience**, then couples' words, a Scout invitation, and one quiet band for private events.

**Sticky listening bar** (`StickyListen.astro`, Home and Watch): there is no listening section on these pages. Once the visitor reaches the third section, a bar slides in bottom-left with Sean's acoustic recordings (play, next, hide). Play hands the recording to the persistent dock, so it keeps playing across pages; the bar steps aside while the dock shows, returns when it closes, and a finished recording moves on to the next. The full list of recordings stays on `/repertoire#listen`.

**Brand name:** the band is always written **The SCENE**.

## Design language: "Ivory maison"
Restraint in the manner of Aman: the photography carries the emotion, the typography carries the brand, and the interface recedes.

- **Color:** warm ivory ground `#f3efe7`, raised paper `#fbf9f5`, sunk `#ebe5da`, ink `#24201b`, muted text `#5f574d` (6.6:1), one bronze accent `#8c6a42` (4.9:1). Text is never gold or pale grey on ivory.
- **Type:** Cormorant Garamond for display, set light, large and airy; a quiet sans for body text (Geist today; a more characterful humanist sans is worth testing). No eyebrow labels above headings.
- **Space:** few, large moments per page; generous margins; short declarative copy.
- **Imagery:** real weddings and rooms, natural light, people mid-moment. Full-bleed where it earns it.
- **Motion:** slow, rare, always from a visible start (the hero text pulls into focus). Nothing bounces; everything respects reduced motion.
- **Shape:** sharp corners throughout; thin rules instead of boxes.
- **Accessibility:** WCAG 2.2 AA contrast and focus; 44 px touch targets.

Tokens live in `apps/web/src/styles/global.css`. Metric-matched local fallbacks keep font loading from shifting the layout.

## Interaction
- **Hero media:** a muted 40-second edit of the supplied event footage, phone-sized sources and a reduced-motion/Save-Data fallback. Historical research keeps its original wording for the band.
- **Video:** click-to-load YouTube films; a playing film docks to a mini-player when the visitor scrolls away or browses, and keeps playing across pages.
- **Scout:** the concierge (a pick-shaped button, bottom right) checks dates and answers questions; see `05-scout-concierge.md`.
- **Inquiry:** five short steps with a live date check; nothing asks for more than it needs.
