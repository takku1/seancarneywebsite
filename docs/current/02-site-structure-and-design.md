# Site structure and design

## Navigation
**Weddings · Private events · Repertoire · About · Check your date**. One primary action, always visible; everything else is a quiet text link.

## Pages
| Page | Purpose |
|---|---|
| `/` Home | the wedding promise, the arc of the day, the three formats, the rooms, one wedding film, couples' words, one action |
| `/weddings` | the day as moments (ceremony, cocktail hour, dinner, first dance, reception), the format for each, details for the planner, FAQ |
| `/private-events` | overview of private events, linking `/corporate`, `/galas`, `/estate`, `/destination` |
| `/repertoire` | the songs, grouped by moment and era, with requests welcome |
| `/about` | Sean, The Hustlers, the rooms, the one credentials line |
| `/inquire` → `/inquire/thanks` | the five-step inquiry; the thank-you page offers a scheduled call |
| `/links` | link-in-bio for the wedding Instagram (@seancarneyentertainment) |
| `/contact` | three routes: weddings and private events, planners and venues, everything else |
| `/privacy`, `/terms`, 404 | |

Legacy addresses (`/music` and its release pages to `/repertoire`, `/press` to `/about`, `/shows` and `/merch` to the home page, and the old GoHighLevel URLs) redirect with 301s configured in `apps/web/astro.config.mjs`. The planner toolkit and venue pages are on the roadmap (`08-roadmap.md`).

## The home page
1. **Hero:** *"Live music for your wedding"*, then one supporting line, A/B tested (`hero_sub`): *"From the first note of the ceremony to the last song of the night"* or *"Fifteen years of weddings, from Hotel del Coronado to The Beverly Hills Hotel"*. Beneath it: *Solo · Trio · Full band*. Media: the film loop with a poster image as the first paint. Actions: "Check your date" (primary; label A/B tested by `cta_label`) and "Watch a wedding" (opens the live reel).
2. **The rooms:** typeset venue names directly under the hero.
3. **The arc:** the day in moments, each with its format.
4. **Formats:** solo, duo or trio, full band, each with when it shines.
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
- **Video:** click-to-load YouTube films; a playing film docks to a mini-player when the visitor scrolls away or browses, and keeps playing across pages.
- **Scout:** the concierge (a pick-shaped button, bottom right) checks dates and answers questions; see `05-scout-concierge.md`.
- **Inquiry:** five short steps with a live date check; nothing asks for more than it needs.
