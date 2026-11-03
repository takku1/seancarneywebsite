# Current Site Audit — seancarneymusic.com

Captured 2026-11-01. Raw HTML + extracted text in `/reference/current-site/`.

## Platform
- **GoHighLevel / LeadConnector "SmartSite"** (CRM funnel builder), built by agency SHA-BAM!
- Assets on `assets.cdn.filesafe.space` / `storage.googleapis.com/msgsndr`. Cloudflare in front (email obfuscation).
- Pages are heavy: 250–540 KB HTML each before images (Nuxt SSR payload); 42 images on home.
- **No analytics detected** (no GA4/GTM/Meta Pixel/Clarity) — zero measurement of booking funnel.
- `sitemap.xml` is **empty** (`<urlset></urlset>`); every page `<title>` is just "Sean Carney".

## Information architecture (as-is)
`HOME · MEDIA ▸ (Music, Video, Tour, Merch) · ABOUT ▸ (EPK, Events) · CONTACT`
- Nav mixes two audiences: **fans** (music, tour, merch, tipjar) and **buyers** (events, EPK, contact) with no clear primary path.
- `/tour` has **no tour dates** — only repeated "Ultimate act for events" boilerplate.
- `/music`, `/tour`, `/video` reuse the same "What Sets Sean Apart" block verbatim.
- EPK is a **20 MB image-only PDF** (6 pages, no text layer) — not searchable, slow on mobile.
- Merch → Redbubble; tip jar link; socials: IG `seanshredseverything`, FB x2, YouTube, SoundCloud.

## Brand / messaging
- Tagline "MUSIC FOR OUTLAWS" (western/cinematic rock artist identity, album *WANTED*).
- Event copy: "high-energy", "brings the house down", ALL-CAPS exclamation headers — party/bar-band register, **not luxury register**.
- Typos/inconsistency: "PERFORMACE", "Billboarding Hot 100", "on their, feet"; "we" vs "Sean" voice switches.

## Credibility assets (strong — currently buried)
- Sync: 2024 Paris Olympics, 2025 NFL Playoffs ("Do Or Die"), Hyundai, Weight Watchers, Netflix ("Meet Me Next Christmas"), ESPN, Disney, TNT.
- TV: NBC *Songland* (band WOLVES). Billboard-charting songwriter.
- Venues: Troubadour, Roxy, El Rey, Hotel Cafe, Crypto.com Arena (LA Kings).
- Corporate clients: Salesforce, Autodesk, VCA, MacLean Power Systems.
- 15+ years, 1,000+ events, 50+ countries. Solo or with band **The Hustlers**.
- Press quotes: Buzz Music, We Write About Music, Think Country.
- Testimonials: 7, all **anonymous** (no name, event type, venue, or photo).

## Event offering (as-is)
Live events, corporate, festival headlining, charity galas, weddings. Wedding repertoire: Ed Sheeran, Stapleton, Sinatra, Cash. Covers on video: Blinding Lights, Perfect, Stargazing, Tennessee Whiskey.

## Conversion path
- Single generic contact form ("management will get back to you") + SMS consent checkbox.
- No event-date / guest count / venue / budget qualification, no packages, no sample setlists, no tech rider, no response-time promise.

## Key problems to solve
1. Dual identity (outlaw rock artist vs. event entertainer) with no audience split.
2. Luxury buyers see bar-band copy and anonymous reviews.
3. Elite proof (Olympics/NFL/Netflix/Salesforce) not used as trust signals near CTAs.
4. Zero SEO fundamentals and zero analytics.
5. Booking form doesn't qualify leads.
