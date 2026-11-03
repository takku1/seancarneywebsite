# Tech Stack for seancarneymusic.com Rebuild (researched 2026-11-01)

Scope: framework, CMS, hosting, video, forms/CRM, analytics, SEO tooling and animation for a roughly 10-25 page, media-heavy musician booking site. Small budget, edited by a non-technical artist, maintained by a technical family member.

Verification note: I checked primary sources (astro.build, sanity.io, vercel.com, Cloudflare docs, gsap.com) directly. Where only third-party sources were available, the item says so. Items marked "[prior knowledge, not re-verified]" come from the researcher's background knowledge (cutoff mid-2026). They have no fresh 2026 citation and the report writer should treat them as such.

## 1. Framework comparison (Astro vs Next.js vs SvelteKit vs Nuxt vs Framer/Webflow)

### Takeaway
Astro is the strongest fit. Its current major version is **Astro 7 (7.4, released Oct 15, 2026)**. It ships zero JS by default with islands, has content collections and built-in image optimization, and since January 2026 its core team has been owned by Cloudflare, so it is well funded. Next.js 16 is capable but heavier than a mostly static marketing site needs. In the HTTP Archive field data that is available, developer-cloud-hosted sites (Vercel/Netlify, mostly JS frameworks) pass CWV *less* often than Wix or Squarespace. A JS-framework site does not get good CWV automatically; you need discipline about media and third-party embeds.

### Cited Findings
- **Astro current version:** Astro 7.0 shipped Jun 22, 2026 with "faster builds with Vite 8, a new Rust compiler, Advanced Routing, background dev server support, and structured logging." 7.1 (Jul 16, 2026) added CSP, pagination and content collections improvements. 7.2 (Aug 6, 2026) added experimental incremental static builds. 7.3 (Sep 3, 2026) added a `finalize()` helper for Cloudflare Worker entrypoints. 7.4 (Oct 15, 2026) added separate build and runtime image services and experimental parallel prerendering. — [Astro blog](https://astro.build/blog/)
- Astro 6 went through a public beta (redesigned dev server, Cloudflare Workers focus) announced alongside the acquisition in January 2026. Templates had been upgraded to 6 by March 2026. — [Astro 6 Beta](https://astro.build/blog/astro-6-beta/); [Shadcnblocks changelog](https://www.shadcnblocks.com/changelog/astro-6-templates-update)
- **Cloudflare acquired The Astro Technology Company on Jan 16, 2026.** The team became Cloudflare employees working full time on Astro. Astro stays MIT-licensed open source and keeps its multi-deployment-target policy (it still deploys to Vercel and Netlify). — [Business Wire press release](https://secure.businesswire.com/news/home/20260116386991/en/Cloudflare-Acquires-Astro-to-Accelerate-the-Future-of-High-Performance-Web-Development); [The New Stack](https://thenewstack.io/cloudflare-acquires-team-behind-open-source-framework-astro/); [roboin.io](https://roboin.io/article/en/2026/01/17/cloudflare-acquires-astro-web-framework/)
- **Next.js current version:** Next.js 16 launched Oct 21-22, 2025 with Turbopack as the default bundler, Cache Components / `"use cache"` replacing PPR, and React 19.2. The official blog shows 16.3 (Aug 3, 2026) and a security release on Aug 26, 2026 covering 16.3 and 15.5. One third-party tracker lists 16.4.1 (Oct 15, 2026), which I did not confirm. — [nextjs.org blog](https://nextjs.org/blog?page=1); [versio.io](https://www.versio.io/de/product-release-end-of-life-eol-vercel-nextjs.html); [makerkit](https://makerkit.dev/blog/md/tutorials/nextjs-16)
- **Real-world CWV, HTTP Archive / CrUX (June 2026, mobile, origin-level):** Wix 80.1%, WordPress.com 73.1% and Squarespace 70.1% pass all three CWV. Sites on Vercel pass at 39.8% and Netlify at 41.2%. This article did not break results out by framework (Astro, Next, Nuxt, SvelteKit, Webflow, Framer, GoHighLevel). — [webhosting.today, Aug 12, 2026 (recomputed from HTTP Archive CWV report)](https://webhosting.today/2026/08/12/googles-field-data-ranks-the-platforms-behind-live-sites-by-speed-and-the-gap-is-more-than-twofold/)
- The authoritative per-technology dashboard is the HTTP Archive Core Web Vitals Technology Report. It is JS-rendered and I could not extract it. — [HTTP Archive CWV Tech Report](https://httparchive.org/reports/cwv-tech)
- **Older or unverified framework CWV data:** Astro's own 2023 report (CrUX/HTTP Archive) found Astro and SvelteKit beat the average pass rate, with Astro the highest at that time and Next.js/Nuxt below average. — [Astro 2023 framework performance report](https://astro.build/blog/2023-web-framework-performance-report). A 2026 agency blog claims about 60% mobile pass for Astro vs 38% for WordPress, with no dataset given. — [Valley Marketing Group](https://thevalleymarketinggroup.com/blog/astro-vs-wordpress-core-web-vitals-2026/). A 2026 blog claim of "29.3% of mobile Next.js sites pass" cites no source. — [tech-insider.org](https://tech-insider.org/fi/astro-vs-nextjs-2026/) (low reliability)
- 2026 overall pass rates conflict: 42% vs 49.2% of mobile sites pass all three, both attributed to the 2026 Web Almanac. — [searchlab.nl](https://searchlab.nl/en/statistics/technical-seo-statistics-2026); [shno.co](https://www.shno.co/marketing-statistics/core-web-vitals-statistics)

### Inferences
- For a content site with about 25 mostly static pages, Astro's static-first output plus islands only where needed (multi-step form, audio player, video lightbox) should do better than a React-hydrated Next.js App Router site, both on default JS payload and on maintenance surface. The low Vercel/Netlify origin pass rates (about 40%) compared with site builders (70-80%) suggest that code-it-yourself sites often ship heavy JS and unoptimized media. Framework choice matters less than media and embed discipline, and Astro's defaults enforce that discipline best.
- SvelteKit and Nuxt are both viable and also lightweight, but they have smaller ecosystems of CMS starter kits and fewer music/marketing templates than Astro and Next. Neither has a clear advantage here. [prior knowledge, not re-verified]
- **Framer/Webflow** (no-code) give the artist direct visual editing with no developer needed and good-enough CWV. The trade-offs are recurring per-site fees, CMS item and locale caps, weaker control over schema/JSON-LD and form-to-CRM logic, and vendor lock-in that repeats the GoHighLevel problem. They are reasonable if the family maintainer drops out. [prior knowledge; no 2026 Framer/Webflow pricing verified]
- Astro now being Cloudflare-owned makes Cloudflare Workers the most "first-class" host, but Astro still officially supports Vercel and Netlify adapters, so lock-in risk is low.

### Gaps
- I could not get 2026 per-framework CWV pass rates (Astro, Next.js, Nuxt, SvelteKit, Gatsby, Webflow, Framer, GoHighLevel) from the HTTP Archive dashboard, because it renders client-side. The report writer should tell the reader to check httparchive.org/reports/cwv-tech and filter by technology.
- I did not verify State of JS 2025 satisfaction numbers. No current SvelteKit (likely 2.x) or Nuxt (4.x) version was verified [prior knowledge].
- I did not confirm Astro 7 feature details for view transitions (`<ClientRouter />`), the Fonts API, or live content collections. These features existed in Astro 5.x/6.x [prior knowledge].

## 2. Headless CMS for a non-technical artist

### Takeaway
**Sanity's Free plan is the safest hosted pick.** It costs $0, has up to 20 seats, 10k documents, 100GB assets and 100GB bandwidth, and includes visual editing / the Presentation tool. **Keystatic** (git-based, free, built by Thinkmill, strong Astro integration) is the zero-vendor alternative if the maintainer accepts a simpler editing UI. Storyblok's free tier is now uncertain (reportedly removed in April 2026).

### Cited Findings
- **Sanity Free:** up to 20 seats, 10k documents, 2 public datasets, 100GB/mo bandwidth, 100GB assets, 250k API requests/mo (1M API CDN requests). Visual editing, Live Preview and the Presentation tool are included on Free. Growth is $15/seat/month. — [sanity.io/pricing](https://www.sanity.io/pricing)
- Third-party sources conflict on Sanity's bandwidth (10GB vs 100GB) and the Growth model. The official page says 100GB and $15/seat. — [flowninja](https://www.flowninja.com/blog/sanity-cms-pricing); [costbench](https://costbench.com/software/headless-cms/sanity/free-plan)
- **Storyblok:** Sources conflict. G2 and freetier.co list a free Starter plan (1 seat, 1 space, 100K API requests). AgentDeals (verified May 2026) reports a 2026-04-13 changelog entry that replaced the permanent free tier with a 45-day trial. Paid plans are reported as €99-€199+/mo. — [agentdeals.dev](https://agentdeals.dev/vendor/storyblok); [freetier.co](https://freetier.co/directory/products/storyblok); [pricingsaas](https://pricingsaas.com/companies/storyblok)

### Inferences
- [prior knowledge, not re-verified in 2026] **Keystatic** is free and open source. It stores content as Markdown/YAML/JSON in the git repo, with a local or GitHub-mode admin UI at `/keystatic`, and integrates natively with Astro content collections. Images are committed to git, which suits a small media library but not large video. **Decap CMS** (formerly Netlify CMS) is free and git-based but dated, with slow development. **TinaCMS** is git-backed with an inline visual editor, and Tina Cloud has a small free tier. **Payload** (v3, Next.js-native, self-hosted, MIT) is powerful but requires a database and a Next.js app, which is more than this project needs. Payload was reportedly acquired by Figma in mid-2025. **Contentful's** free tier is restrictive and its editing UI is less artist-friendly, so it is overkill.
- The recommended pattern is Sanity (hosted Studio, works on mobile, image hotspot/crop, structured "Show", "Testimonial", "Press item" and "Video" types) plus Astro static builds triggered by a Sanity webhook to a deploy hook. That way the artist edits, the site rebuilds in about a minute, and pages stay static and fast. Store large videos in a video host, not the CMS.
- 10k documents and 100GB assets on Sanity Free is far more than a 25-page musician site will use.

### Gaps
- I did not verify 2026 pricing for Keystatic Cloud, TinaCMS Cloud, Payload Cloud, Contentful or Decap. I did not confirm the Figma-Payload acquisition with a 2026 source.

## 3. Hosting: Vercel vs Netlify vs Cloudflare

### Takeaway
**Cloudflare Workers (static assets) is the best value.** Static asset requests are free and unlimited, the free plan allows 100k Worker requests/day, and paid is $5/mo. Astro is now Cloudflare's framework. **Vercel Hobby forbids commercial use**, so a booking business site would need Pro at $20/mo. Netlify's free plan moved to a 300-credit model in which bandwidth is metered (roughly 15GB on one estimate), which is risky for a media-heavy site.

### Cited Findings
- **Cloudflare Workers:** "Requests to static assets are free and unlimited". The free plan allows 100,000 Worker requests/day. Paid starts at $5/mo per account. Pages Functions are billed as Workers. — [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- **Vercel Hobby** is for "personal, non-commercial use". It includes 100GB Fast Data Transfer/mo, 5K image transformations/mo, and 1M function invocations. Pro is $20/mo including a $20 usage credit. — [vercel.com/pricing](https://vercel.com/pricing)
- **Netlify Free:** a 300-credit monthly pool replaced the bandwidth-based limits. One source estimates bandwidth at 20 credits/GB (about 15GB), and deploys reportedly cost 15 credits each. Form submissions were reported free from Apr 14, 2026. Sources conflict on whether sites pause when credits run out. Netlify's older blog still says 100GB. — [netli.fyi](https://netli.fyi/blog/netlify-free-plan-limits-2026); [netlify.com blog](https://www.netlify.com/blog/introducing-netlify-free-plan.md); [costbench](https://www.costbench.com/software/cloud-infrastructure/netlify/free-plan/)
- Netlify states that Astro 6 "just works" on Netlify (Mar 2026). — [API Evangelist summary of Netlify post](https://blogs.apievangelist.com/blogs/netlify-2026-03-10-astro-6-just-works-on-netlify/)

### Inferences
- Pre-rendering images at build time with Astro's `<Image>`/`<Picture>` (AVIF/WebP, sharp) avoids paying for runtime image transformation on any host. Combined with Cloudflare's free unlimited static assets, hosting can realistically cost $0-$5/mo.
- Vercel's non-commercial clause means it is not truly free for this use case.
- If you use Netlify, its built-in Forms are convenient, but the credit metering makes bandwidth for a video-heavy site unpredictable. Keep video off the host in either case.

### Gaps
- I did not verify Cloudflare Images free-tier transformation limits or Netlify's official per-credit rates on primary pages.

## 4. Video hosting and embed facades

### Takeaway
Hero and reels: use a short, muted, compressed MP4/WebM hero loop (or an HLS stream) with a poster image, plus a facade for YouTube/Spotify. For paid streaming, Cloudflare Stream ($5/1k min stored, $1/1k min delivered) and Bunny Stream (per GB, about $1/mo minimum) are cheapest. Mux is the most developer-polished and has a free delivery allowance. Third-party pricing sources conflict, so verify.

### Cited Findings
- **Cloudflare Stream:** $5 per 1,000 minutes stored and $1 per 1,000 minutes delivered. Sources conflict on whether there is a free delivery allowance. — [apicostcalc](https://apicostcalc.com/mux-vs-cloudflare-stream-vs-bunny-stream-cost-calculator.html); [apiscout](https://apiscout.dev/guides/mux-vs-cloudflare-stream-api-2026)
- **Mux:** Reported rates range from $0.0024-$0.003/min/month storage and $0.0008-$0.001/min delivered. One source reports 100,000 free delivery minutes per month. These are conflicting third-party figures. — [devtoolpicks](https://devtoolpicks.com/blog/best-mux-alternatives-indie-hackers-2026); [leanopstech](https://leanopstech.com/blog/mux-vs-cloudflare-stream-vs-cloudfront-2026/)
- **Bunny Stream:** billed per GB, with storage from about $0.01/GB/mo, CDN delivery from about $0.005/GB, and a $1 monthly minimum. Encoding is reportedly free on all three. — [devtoolpicks](https://devtoolpicks.com/blog/best-mux-alternatives-indie-hackers-2026)

### Inferences
- With an estimated 5-10 short reels (2-4 minutes each, about 40 minutes stored) and low-thousands of monthly plays, any of the three costs under about $5/mo. Bunny or Cloudflare Stream is cheapest. Cloudflare Stream keeps everything in one Cloudflare account alongside the Astro hosting.
- [prior knowledge] Facade pattern: `lite-youtube-embed` (Paul Irish), or Astro's `astro-embed` / `@astro-community/astro-embed-youtube`, renders a thumbnail and play button and loads the iframe only on click. This saves roughly 500KB-1MB+ of YouTube JS per embed. Do the same for Spotify: show a static cover and "Listen" button and inject the iframe on click. The current site loads several eager iframes, which is likely a major cause of its weight.
- [prior knowledge] Hero video and LCP: make the poster image the LCP element (preload it and set `fetchpriority="high"`), use `<video autoplay muted playsinline loop preload="none|metadata">`, keep the hero file around 1-3MB at 720p, and use a static image fallback on `prefers-reduced-motion` or data saver.
- Replace the 20MB image-only PDF EPK with an HTML press page (indexable text, schema). Offer a compressed PDF (under about 2-3MB) as an optional download.

### Gaps
- I did not verify any official vendor pricing pages (mux.com/pricing, cloudflare.com Stream, bunny.net/stream) in this pass. The figures above are from comparison sites that conflict with each other.

## 5. Forms and lead capture

### Takeaway
Build the multi-step qualifying form as a single Astro island (or a progressively enhanced HTML form) posting to an Astro Action or server endpoint on Cloudflare Workers. Validate Cloudflare Turnstile server-side, then fan out to (a) the CRM via API or webhook, (b) Resend for the confirmation and notification emails. Keeping GoHighLevel as the CRM through its inbound webhook is the lowest-disruption path.

### Cited Findings
- Netlify form submissions were reported as free from Apr 14, 2026, which is an option if you host on Netlify. — [netli.fyi](https://netli.fyi/blog/netlify-free-plan-limits-2026)
- Cloudflare Workers free tier: 100k requests/day covers form endpoints easily. — [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)

### Inferences
- [prior knowledge, not re-verified] Cloudflare Turnstile is free and works without a CAPTCHA puzzle. Resend's free tier is about 3,000 emails/mo (100/day). HubSpot's free CRM has forms/contacts APIs. HoneyBook and Dubsado are popular with event vendors for proposals, contracts and payments, but their public APIs are limited. Typical integration is via Zapier/Make or their own embedded forms, which hurt CWV and design control. GoHighLevel supports inbound webhooks / API v2 to create contacts and trigger workflows, so the existing SMS/email nurture automations survive the rebuild.
- Suggested form steps: (1) event type (wedding / corporate / private), (2) date, venue or city and guest count (soft-qualify), (3) budget range and services (ceremony, cocktail, reception, band size), (4) contact info. Fire analytics events for step views and submit to measure drop-off.
- Calendar availability: rather than a live calendar (which leaks the artist's schedule), do a "check date" step that queries a private Google Calendar free/busy endpoint server-side, or just collect the date and reply quickly. Cal.com or Calendly can be used for post-qualification discovery calls.

### Gaps
- I did not verify 2026 pricing or limits for Turnstile, Resend, HubSpot free, HoneyBook, Dubsado or GoHighLevel webhooks.

## 6. Analytics, consent, and conversion tracking

### Takeaway
Use a cookieless analytics tool as the primary source of truth: Plausible (about $9-14/mo), Fathom (about $15/mo) or Umami (free self-host or cloud). Add GA4 only if ads or Google ecosystem reporting are needed. Clarity (free) gives heatmaps and session replay. Adding Meta Pixel, GA4 or Clarity brings in CCPA/CPRA "sharing" obligations: a "Do Not Sell or Share" link and honoring Global Privacy Control.

### Cited Findings
- Plausible, Fathom and Umami are all cookieless and marketed as GDPR/CCPA compliant. Some sources say no consent banner is needed (vendor claims). Plausible starts at about $9/mo for 10K pageviews, with a reported May 2026 change to $14/mo Growth. Fathom starts at about $15/mo. Umami Cloud pricing conflicts (free tier of 1M events vs $20/mo) and self-hosting is free. — [apiscout](https://apiscout.dev/blog/plausible-vs-umami-vs-fathom-analytics-2026); [databuddy](https://www.databuddy.cc/blog/plausible-vs-matomo-vs-privacy-first-analytics-2026); [comparetiers](https://comparetiers.com/compare/plausible-vs-umami)

### Inferences
- [prior knowledge, not re-verified] Microsoft Clarity is free with no traffic cap, but it sets cookies and records sessions, so disclose it in the privacy policy and mask form fields. Under CPRA, cross-context behavioral advertising (Meta Pixel, Google Ads remarketing) counts as "sharing". You need a "Do Not Sell or Share My Personal Information" link and must honor the Global Privacy Control signal. CCPA applicability thresholds (for example $25M+ revenue, or buying/selling/sharing personal info of 100k+ consumers) likely exempt a solo musician, but following the practices is cheap insurance and helps if ads scale. Meta Conversions API (server-side) can send the "Lead" event from the form endpoint, which avoids a heavy pixel and is more resilient to ad blockers.
- Conversion events to track: `inquiry_step_n`, `inquiry_submit` (with event type and budget band), `video_play`, `audio_play`, `epk_download`, `phone_click`, `email_click`.
- Load third-party scripts off the main thread or after interaction. Partytown is an Astro integration for this, though its maturity varies [prior knowledge].

### Gaps
- I did not verify official 2026 Plausible, Fathom or Umami pricing pages, Clarity terms, or current CPRA thresholds (they are CPI-adjusted).

## 7. SEO tooling

### Takeaway
Astro covers the basics with official integrations: `@astrojs/sitemap`, build-time AVIF/WebP via `<Picture>`, and per-page meta in a layout. Add JSON-LD by hand: `MusicGroup` or `Person`/`PerformingGroup` for the artist, `Event` for public shows, `Review`/`AggregateRating` only for genuine third-party reviews, `LocalBusiness`/`Service` with `areaServed` for venue and location pages, `VideoObject` for reels, and `FAQPage`. Generate OG images at build time with Satori/`astro-og-canvas`.

### Cited Findings
- Astro 7.4 separates build-time and runtime image services, which fits pre-generating optimized images at build. — [Astro blog](https://astro.build/blog/)

### Inferences
- [prior knowledge] Google limits review rich results for self-serving reviews (a business marking up reviews of itself on its own site does not get review stars). Testimonials can still be marked up, but stars are unlikely. `Event` rich results require public, ticketed/attendable events. Private weddings should not be marked up as Events.
- Location/venue SEO pages (for example "wedding saxophonist [City]" or "[Venue] wedding music") work only with unique content: real performance photos at that venue, a planner quote, and logistics notes. Thin doorway pages are a risk.
- Text-based HTML EPK/press pages replace the image-only PDF, which search engines cannot index meaningfully.

### Gaps
- I did not fetch the schema.org or Google Search Central pages in this pass. The rules above come from prior knowledge.

## 8. Animation libraries

### Takeaway
GSAP is now 100% free, including the full plugin set (ScrollTrigger, SplitText, MorphSVG), thanks to Webflow. Prefer native CSS first: scroll-driven animations and the View Transitions API (Astro has built-in support). Use GSAP or Motion only for the few signature moments, loaded as an island.

### Cited Findings
- "GSAP is now 100% free for all users". Webflow's support lets them "offer the entire GSAP library for free". ScrollTrigger, SplitText and MorphSVG are listed among the plugins. The pricing page does not spell out commercial-use or license restrictions. — [gsap.com/pricing](https://gsap.com/pricing/)

### Inferences
- [prior knowledge] GSAP's "no charge" license reportedly bars use in tools that compete with Webflow. That is irrelevant for a musician site, but check the license text. CSS scroll-driven animations (`animation-timeline: scroll()/view()`) are supported in Chromium and Safari 26. Firefox support was partial or behind a flag as of mid-2026, so use them as progressive enhancement. Cross-document View Transitions (`@view-transition { navigation: auto; }`) work in Chromium and Safari 18.2+, which lets an Astro static site get SPA-like page transitions with no JS. Motion (formerly Framer Motion) has a vanilla `animate()` API (about 2.5-18KB).
- CWV guardrails: animate only `transform`/`opacity`, never delay LCP text or images behind an entrance animation, and respect `prefers-reduced-motion`.

### Gaps
- I did not verify the current browser support tables (caniuse) or the GSAP license text.

## Recommended stack (synthesis for the report writer)
- **Framework:** Astro 7.x, static output with islands. [astro.build/blog](https://astro.build/blog/)
- **Host:** Cloudflare Workers static assets, free or $5/mo. [Cloudflare pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- **CMS:** Sanity Free with visual editing, rebuilding via webhook. Keystatic is the zero-vendor fallback. [sanity.io/pricing](https://www.sanity.io/pricing)
- **Video:** Cloudflare Stream or Bunny Stream for reels, a small self-hosted MP4 hero loop, and lite-YouTube/Spotify facades.
- **Forms:** Astro island → Worker endpoint → Turnstile → GoHighLevel webhook (or HubSpot free) + Resend.
- **Analytics:** Plausible or Fathom (cookieless) + Clarity, with GA4 and Meta CAPI only if running ads. Add a GPC-honoring "Do Not Sell/Share" link if pixels are used.
- **SEO:** @astrojs/sitemap, JSON-LD components, build-time OG images, AVIF/WebP via `<Picture>`.
- **Motion:** CSS scroll-driven animations + View Transitions first, then GSAP (free) for signature moments.
- **Estimated running cost:** about $0-$30/mo (host $0-5, video about $1-5, analytics $9-15, CMS $0, email $0). This is an estimate built from the cited figures, not a quote.
