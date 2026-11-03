// @ts-check
import { defineConfig, envField } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';
import cspHeaderHashes from './integrations/csp-header-hashes.mjs';

const SITE = 'https://seancarneymusic.com';

export default defineConfig({
  site: SITE,
  trailingSlash: 'never',
  // Pages are prerendered by default; only /api/* runs on the Worker.
  output: 'static',
  adapter: cloudflare({ imageService: 'compile' }),
  // Hash-based CSP for scripts and styles (emitted per page as a <meta> policy).
  // It combines with the header policy in public/_headers, which covers the
  // remaining directives plus reporting; the browser enforces both.
  // CSP: one header policy (public/_headers). integrations/csp-header-hashes.mjs
  // fills in SHA-256 hashes of every inline script and style after the build.
  // CSS ships as cached files rather than inlined per page, which keeps the hash
  // list short enough for Cloudflare's 2,000-character _headers line limit.
  // format 'file' emits music.html (not music/index.html), which Cloudflare serves at /music directly.
  // With directory output, /music answered with a 307 to /music/, so every page cost an extra round trip
  // and every canonical URL (trailingSlash 'never') pointed at a redirect.
  build: { inlineStylesheets: 'never', format: 'file' },
  integrations: [
    cspHeaderHashes(),
    sitemap({
      filter: (page) => !['/inquire/thanks', '/api/', '/links', '/press/one-sheet'].some((p) => page.includes(p)),
    }),
  ],
  // 301s from the old GoHighLevel URLs so existing links and rankings carry over.
  redirects: {
    '/home': '/',
    '/live-events': '/private-events',
    '/tour': '/shows',
    '/appearances': '/shows',
    '/video': '/music#film',
    '/epk': '/press',
    '/events': '/private-events',
    // Hidden "Sean Carney Luxury Events" sub-site on the old platform.
    '/events-home': '/private-events',
    '/wedding-events': '/weddings',
    '/events-contact-us': '/inquire',
    '/tipjar': '/music',
    '/thank-you': '/',
  },
  // Internal links prefetch on hover/focus (touch: on tap-start), so most navigations feel instant.
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  image: {
    responsiveStyles: true,
    layout: 'constrained',
    // Platform images are downloaded and optimized at build, so expiring CDN URLs never reach visitors.
    remotePatterns: [
      { protocol: 'https', hostname: 'i.scdn.co' },
      { protocol: 'https', hostname: '**.cdninstagram.com' },
      { protocol: 'https', hostname: '**.fbcdn.net' },
    ],
  },
  env: {
    schema: {
      // Public (inlined at build). Leave unset to disable a vendor entirely.
      PUBLIC_PLAUSIBLE_DOMAIN: envField.string({ context: 'client', access: 'public', optional: true }),
      PUBLIC_GA4_ID: envField.string({ context: 'client', access: 'public', optional: true }),
      PUBLIC_CLARITY_ID: envField.string({ context: 'client', access: 'public', optional: true }),
      PUBLIC_META_PIXEL_ID: envField.string({ context: 'client', access: 'public', optional: true }),
      PUBLIC_TURNSTILE_SITE_KEY: envField.string({ context: 'client', access: 'public', optional: true }),
      PUBLIC_CALL_BOOKING_URL: envField.string({ context: 'client', access: 'public', optional: true }),
      // Scout concierge: 'false' hides it entirely. Guided mode works with no AI backend.
      PUBLIC_SCOUT_ENABLED: envField.string({ context: 'client', access: 'public', optional: true, default: 'true' }),
      // Server secrets (set with `wrangler secret put`). See apps/web/.env.example.
      TURNSTILE_SECRET_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      GHL_PRIVATE_TOKEN: envField.string({ context: 'server', access: 'secret', optional: true }),
      GHL_LOCATION_ID: envField.string({ context: 'server', access: 'secret', optional: true }),
      GHL_PIPELINE_ID: envField.string({ context: 'server', access: 'secret', optional: true }),
      GHL_STAGE_NEW_ID: envField.string({ context: 'server', access: 'secret', optional: true }),
      GHL_WEBHOOK_URL: envField.string({ context: 'server', access: 'secret', optional: true }),
      GOOGLE_SA_EMAIL: envField.string({ context: 'server', access: 'secret', optional: true }),
      GOOGLE_SA_PRIVATE_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      GOOGLE_CALENDAR_IDS: envField.string({ context: 'server', access: 'secret', optional: true }),
      AVAILABILITY_TIMEZONE: envField.string({ context: 'server', access: 'secret', optional: true }),
      META_CAPI_ACCESS_TOKEN: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Build-time media pipeline (set as Workers Builds variables, not runtime secrets).
      YOUTUBE_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      SPOTIFY_CLIENT_ID: envField.string({ context: 'server', access: 'secret', optional: true }),
      SPOTIFY_CLIENT_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
      INSTAGRAM_ACCESS_TOKEN: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Scout AI backend (optional). Unset = guided mode.
      SCOUT_PROVIDER: envField.string({ context: 'server', access: 'secret', optional: true }),
      ANTHROPIC_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      SCOUT_MODEL: envField.string({ context: 'server', access: 'secret', optional: true }),
      SCOUT_ADMIN_TOKEN: envField.string({ context: 'server', access: 'secret', optional: true }),
      SCOUT_SIGNING_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      SCOUT_DAILY_LIMIT: envField.string({ context: 'server', access: 'secret', optional: true }),
      RESEND_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      INQUIRY_NOTIFY_EMAIL: envField.string({ context: 'server', access: 'secret', optional: true }),
      INQUIRY_FROM_EMAIL: envField.string({ context: 'server', access: 'secret', optional: true }),
    },
  },
});
