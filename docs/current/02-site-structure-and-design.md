# Site structure and design

**Current direction:** `10-sce-build-brief.md` applies SCE branding and an Élan-inspired player presentation. Navigation includes custom songs, players and films. `/custom-song` explains the supplied process; `/videos` presents existing films; Repertoire adds a four-step quiz, favorites and Do Not Play lists with reviewed inquiry handoff. The cream palette, typography and accessibility conventions remain.

## Navigation
**Weddings · Private events · Repertoire · Your song · Our players · Films · About · Check your date**. Private events opens a menu of its four event pages. One primary action, always visible (its label, "Check your date" or "Inquire", is an A/B test); everything else is a quiet text link.

## Pages
| Page | Purpose |
|---|---|
| `/` Home | the wedding promise, the arc of the day, the three formats, the rooms, one wedding film, couples' words, one action |
| `/weddings` | the day as moments (ceremony, cocktail hour, dinner, first dance, reception), the format for each, details for the planner, how booking works (four steps), FAQ |
| `/private-events` | overview of private events, linking `/corporate`, `/galas`, `/estate`, `/destination` |
| `/repertoire` | 192 supplied songs, searchable by song/artist and filterable by style; 15 acoustic recordings and a full song-list download |
| `/custom-song` | the custom-song process: consultation, writing, studio recording, optional live performance; Sean's songwriting credits |
| `/videos` | supplied performance films and curated YouTube entries, played in the persistent dock |
| `/the-scene` | a scrolling introduction to the band with five supplied portraits and biographies and the live film |
| `/about` | Sean, The Scene, the rooms (linking to their venue pages), the one credentials line |
| `/planners` | the planner toolkit: paperwork, sound, ceremony, footprint, timing, music, privacy, lead time; a planner-pack request; planner FAQs |
| `/venues`, `/venues/<room>` | the rooms Sean has played; each page states only that he performed there, the formats for a day there, planner notes and a venue FAQ, plus Sean's own story when one exists |
| `/inquire` → `/inquire/thanks` | the five-step inquiry; the thank-you page sets out what happens next and offers a 15-minute call (`PUBLIC_CALL_BOOKING_URL`) |
| `/links` | link-in-bio for the wedding Instagram (@seancarneyentertainment) |
| `/contact` | three routes: weddings and private events, planners and venues, everything else |
| `/privacy`, `/terms`, 404 | |

**Search indexing of venue pages:** a venue page is `noindex` and left out of the sitemap until its room has a `story` in `credits.json` (Sean's own account); adding one makes it indexable on the next build. This keeps thin location pages out of search.

Legacy addresses (`/music` and its release pages to `/repertoire`, `/press` to `/about`, `/shows` and `/merch` to the home page, and the old GoHighLevel URLs) redirect with 301s configured in `apps/web/astro.config.mjs`.

## The home page
1. **Hero:** *"One team. Your whole celebration."*, then one supporting line, A/B tested (`hero_sub`): *"Bespoke wedding entertainment, from acoustic cocktail sets to a full-band reception"* or *"Your people. Your music. A celebration shaped around the two of you"*. Beneath it: *Solo · Duo · Band*. Media: the film loop with a poster image as the first paint. Actions: "Check your date" (primary; label A/B tested by `cta_label`) and "Watch the live film" (opens the live reel).
2. **The rooms:** typeset venue names directly under the hero.
3. **The arc:** the day in moments, each with its format.
4. **Formats:** Solo, Duo and Band, each with when it shines.
5. **A wedding, live:** three films; then couples' words, a Scout invitation, and one quiet band for private events.

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
- **November content update:** Home retains the wedding promise, typeset rooms, day arc, three formats, testimonials and inquiry action. It adds a short introduction to Sean, the supplied live film and four acoustic recordings. The hero uses a muted 40-second edit of the supplied event footage, phone-sized sources and its existing reduced-motion/Save-Data fallback. The band is The Scene; historical research keeps its original wording.
- **Video:** click-to-load YouTube films; a playing film docks to a mini-player when the visitor scrolls away or browses, and keeps playing across pages.
- **Scout:** the concierge (a pick-shaped button, bottom right) checks dates and answers questions; see `05-scout-concierge.md`.
- **Inquiry:** five short steps with a live date check; nothing asks for more than it needs.
