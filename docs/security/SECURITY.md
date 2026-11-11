# Security baseline: seancarneymusic.com

November 10 music-planning addition: `sc_music_plan` stores only validated repertoire IDs (favorites and Do Not Play, at most twelve each), per tab through `lib/storage.ts`. The existing clear-data control evicts it. Titles/artists are resolved into an editable inquiry message only when the visitor chooses Share; normal review and submission remain required. No new service, tracker or credential is introduced. Disclosed on `/privacy`.

Hardening pass and gap analysis against **OWASP ASVS 5.0** and the **OWASP Top 10 2025**, using AuditForge's control catalog (`Z:\auditforge`, 442 ASVS requirements) and its `audit_repo.py` scanner. Date: 2026-11-01. Re-run on every release (see "How to re-verify").

Scope: Astro static site plus on-demand Cloudflare Worker API routes. **No user accounts or logins**, so ASVS V6 (authentication), V7 (sessions), V9 (self-contained tokens), V10 (OAuth/OIDC), V5 (file upload) and V17 (WebRTC) are not applicable, along with GraphQL, WebSocket, SQL/LDAP/XPath and deserialization requirements (no such components).

## 1. Architecture and trust boundaries

```
Browser ──HTTPS──► Cloudflare (TLS, WAF, rate rules)
                    ├─ static assets (prerendered HTML/CSS/JS/images)   no server code
                    └─ Worker: src/middleware.ts ─► /api/* routes
                         ├─ /api/inquire  ─► LEADS_KV (receipts), GoHighLevel (CRM), Resend (email), Turnstile
                         ├─ /api/scout    ─► Anthropic (AI), Google Calendar
                         ├─ /api/availability ─► Google Calendar (free/busy)
                         ├─ /api/signal, /api/scout/trending ─► Cloudflare KV
                         ├─ /api/scout/insights (admin token) ─► Cloudflare KV
                         └─ /api/csp-report ─► Workers Logs
Build time only: YouTube Data API, Instagram API (media pipeline)
```

## 2. Browser security features required (ASVS 3.1.1)
HTTPS with HSTS (1 year, preload), CSP (enforced, one header policy: SHA-256 hashes of every inline script and style are computed from the built pages by `integrations/csp-header-hashes.mjs`; no `'unsafe-inline'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options` plus CSP `frame-ancestors 'self'`, `Cross-Origin-Opener-Policy: same-origin-allow-popups`, and `Permissions-Policy` denying camera, microphone, geolocation, payment and USB. Source: `apps/web/public/_headers`. Old browsers without these features still render the site; only defense-in-depth is lost.

## 3. Communications inventory and outbound allowlist (ASVS 13.1.1, 13.2.4, 13.2.5)
The server only ever calls these fixed hosts; no URL is ever built from visitor input (SSRF not possible, ASVS 1.3.6).

| Service | Host | From | Purpose | Credential | Failure behavior |
|---|---|---|---|---|---|
| GoHighLevel (Sean's account is SHA-BAM, a white-label of it) | services.leadconnectorhq.com (+ webhook URL) | /api/inquire, Scout `submit_inquiry` | CRM write | `GHL_PRIVATE_TOKEN` | Falls back to the webhook (non-2xx = failure); the lead is queued in `LEADS_KV` for `POST /api/leads`. Acknowledged only if the lead store or the notify email held it; otherwise 503 |
| Resend | api.resend.com | /api/inquire | Notify Sean and confirm to the client | `RESEND_API_KEY` | Errors are failures; the confirmation is sent only after the lead was held durably |
| Cloudflare Turnstile | challenges.cloudflare.com | /api/inquire | Bot check | `TURNSTILE_SECRET_KEY` | Fails closed (403); in production a missing secret also fails closed (logged `turnstile_secret_missing`) |
| Anthropic | api.anthropic.com | /api/scout | AI replies | `ANTHROPIC_API_KEY` | Falls back to guided mode |
| Google OAuth and Calendar | oauth2.googleapis.com, www.googleapis.com | /api/availability, /api/scout | Free/busy only | `GOOGLE_SA_*` | Returns "unknown"; the UI stays quiet |
| Cloudflare KV | binding `SCOUT_KV` | signals, insights, budget | Anonymous counters | Binding | No-op if unbound |
| YouTube, Instagram | googleapis.com, graph.instagram.com | **build only** | Media pipeline | Build variables | Curated fallback; the build never fails |

Concurrency and resources: each request makes at most 1–3 outbound calls (Scout up to 4 model rounds); SDK timeouts are 45 s with 1 retry for Anthropic and platform defaults elsewhere.

## 4. Data classification (ASVS 14.1.1, 14.1.2, 14.2.7)

| Class | Data | Where it lives | Protection | Retention |
|---|---|---|---|---|
| **Confidential** | API keys, tokens, signing key | Worker secrets only | Never in code or logs; least privilege | Rotate every 90 days (below) |
| **Personal** | Inquiry contact details | GHL (system of record); `LEADS_KV` receipt for 90 days (disclosed on /privacy); in transit via TLS | Never in URLs or browser storage; masked in session replay; not sent to analytics | Per Sean's CRM policy |
| **Personal (hashed, ads)** | SHA-256 of email/phone, IP, user agent, `_fbp`/`_fbc` on inquiry conversions | Meta Conversions API (`lib/integrations/meta-capi.ts`), server-side only | Sent only with consent + no opt-out (`ads_ok` from the browser) + no `Sec-GPC: 1`; never raw PII; token is a Worker secret; disclosed on /privacy | Meta's retention |
| **Personal (transient)** | Scout chat text | Visitor's tab (sessionStorage), Anthropic for processing | HMAC-signed, cleared on tab close or "Clear chat", masked in replay | Tab lifetime |
| **Internal** | Lead tier/score, attribution | GHL note; sessionStorage (tier, one page) | Not in URLs | CRM policy |
| **Visit record (no PII)** | `sc_visits` (first-visit date, last-visit time, count, weeks already reported) in localStorage; `sc_visit_session` in sessionStorage | Visitor's browser, via `lib/analytics/retention.ts` | No identifier; disclosed on /privacy; evicted by "Clear data". The only thing sent is an anonymous `{cohort: "2026-W45", week: N}` beacon, validated server-side (regex + 0–12 range) | Until cleared |
| **Anonymous (retention)** | Cohort counters `ret:<ISO week>` → `{w0..w12}` | Cloudflare KV | No ID, IP or page; one +1 per visitor per week | 400-day TTL |
| **Anonymous** | Topic counts, checked dates, scrubbed gap questions | Cloudflare KV | PII scrubbed (emails, phones, addresses) | 120-day TTL |
| **Public** | Site content, Sean's published contact email | Repo / site | Integrity via reviewed commits | n/a |

## 5. Logging inventory (ASVS 16.1.1, 16.2, 16.4)
- **Where:** Workers Logs (Cloudflare), one JSON line per event; UTC timestamps; no raw IPs (`who` is a keyed daily HMAC of the IP with `LOG_HASH_KEY`, or a random per-instance key when unset). Encoded as JSON, so log injection isn't possible (ASVS 16.4.1). Only Cloudflare account members can read them (16.4.2).
- **Security events** (`kind: "security"`): `rate_limited`, `body_too_large`, `origin_rejected`, `method_rejected`, `content_type_rejected`, `bad_signature`, `turnstile_failed`, `honeypot`, `auth_failed`, `validation_failed`, `csp_violation`, `unhandled_error`.
- **Operational:** `kind: "lead"` (`lead_accepted`, `lead_delivery_failed`, `lead_undeliverable`, `lead_duplicate`, `lead_retry_*`; lead id and outcomes only, never contact details), `[scout]` (provider errors), `[media]` (build-time fallbacks).
- **Alerting (to configure):** Cloudflare notification on Worker error-rate spikes; a weekly review of `rate_limited` / `bad_signature` / `csp_violation` counts.

## 6. Secrets and rotation (ASVS 13.1.4, 13.3)
Stored as Worker secrets (`wrangler secret put`) and build variables; never committed (`.gitignore` covers `.env*`). Rotate every **90 days**, or immediately on suspicion or staff change: `ANTHROPIC_API_KEY`, `GHL_PRIVATE_TOKEN`, `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`, `GOOGLE_SA_PRIVATE_KEY`, `SCOUT_SIGNING_KEY` (resets open chats), `SCOUT_ADMIN_TOKEN` (also guards `/api/leads`), `LOG_HASH_KEY` (pseudonyms change on rotation), `INSTAGRAM_ACCESS_TOKEN` (expires every 60 days anyway).

## 7. Dependencies and remediation timeframes (ASVS 15.1.1, 15.1.2, 15.2.1, OWASP A03)
- SBOM: `docs/security/sbom.cdx.json` (CycloneDX 1.5, 195 production components). Regenerate with `npm run sbom`.
- `npm audit --omit=dev`: **0 vulnerabilities** (2026-11-01). Enforced by `npm run verify`, which `scripts/publish.sh` runs before every push, and by the manual CI workflow (`.github/workflows/ci.yml`); fails on high.
- Dependabot weekly (npm) and monthly (GitHub Actions); actions pinned to commit SHAs.
- Remediation timeframes: **Critical / CISA KEV-listed: 48 hours. High: 7 days. Medium: 30 days. Low: next release.** Prioritize with AuditForge's `kev_lookup`/`epss_lookup`.
- Risky or dangerous components (15.1.4, 15.1.5): the Anthropic SDK (handles untrusted model output, which is escaped before rendering) and `set:html` (used only with build-time, non-user content: JSON-LD and inline config).

## 8. ASVS 5.0 status (applicable requirements)

| Req | Status | Evidence |
|---|---|---|
| 1.2.1–1.2.3 output encoding | Met | Astro auto-escaping; chat `esc()` plus allowlisted `linkify`; email HTML `escapeHtml` |
| 1.3.2 no eval | Met | None in source |
| 1.3.6 SSRF | Met | Fixed outbound hosts only (§3) |
| 1.3.11 mail injection | **Fixed** | `headerSafe()` strips CR/LF from subject and reply-to (`lib/inquiry/process.ts`) |
| 1.3.12 ReDoS | Met | Simple anchored and alternation regexes; inputs length-capped |
| 2.2.1–2.2.2 server-side validation | Met | Zod schemas on every write path (`lib/inquiry/schema.ts` for `/api/inquire` and Scout's `submit_inquiry`, tool schemas in `lib/scout/tools.ts`); beacons are type-checked and range-validated (`/api/signal`) |
| 2.4.1 anti-automation | **Fixed** | Per-route rate limits in `src/middleware.ts`, enforced by Cloudflare Rate Limiting bindings declared in `wrangler.jsonc` (strict: 3/min for inquire and insights; standard: 20/min) |
| 2.4.x / OWASP API4 resource limits | **Fixed** | `middleware.ts`: POST bodies are capped per route by declared `Content-Length`, or measured as they stream when undeclared (`lib/security/body.ts`), `maxBodySize` 4–64 KB (413, logged `body_too_large`); malformed or `null` Origin is rejected (403) |
| 2.4.2 human timing | Met | `started_at` minimum fill time plus honeypots |
| 3.2.2 safe text rendering | Met | No `innerHTML` with untrusted data |
| 3.3.x cookies | N/A | The site sets no cookies; vendor cookies are consent-gated (§9) |
| 3.4.1 HSTS | Met | `_headers` (preload) |
| 3.4.2 CORS | Met | No `Access-Control-Allow-Origin` issued; same-origin only |
| 3.4.3 CSP | **Fixed** | Enforced, single header policy, no `'unsafe-inline'`. After each build `integrations/csp-header-hashes.mjs` hashes the exact inline `<script>`/`<style>` contents of every page into `_headers`. The build fails on leftover placeholders, inline `style=""` attributes, or a header line over Cloudflare's 2,000-character limit (an oversized line is silently dropped). CSS ships as files (`inlineStylesheets: 'never'`) to keep the list short |
| 3.4.4 nosniff, 3.4.5 referrer, 3.4.6 frame-ancestors, 3.4.8 COOP | Met | `_headers` |
| 3.4.7 CSP reporting | **Fixed** | `report-uri` / `report-to` → `/api/csp-report` (structured logs) |
| 3.5.1 cross-origin protection | **Fixed** | Origin check plus Content-Type allowlist on POST (`middleware.ts`) |
| 3.5.3 state changes via POST | Met | All writes are POST |
| 3.5.6 no JSONP | Met | None |
| 3.6.1 external asset integrity | Accepted | No third-party JS/CSS libraries from CDNs; analytics vendors' dynamic scripts can't take SRI (documented risk, CSP-limited) |
| 3.7.4 HSTS preload list | To do | Submit at hstspreload.org after launch |
| 4.1.1 Content-Type matches | Met | JSON APIs set `application/json`; 204 for beacons |
| 4.1.4 method allowlist | **Fixed** | 405 with `Allow` header (`middleware.ts`) |
| 8.2.1 function-level access | Met | Only `/api/scout/insights` is privileged; one gate (`requireAuth`, `lib/security/auth.ts`) in `middleware.ts`, driven by `admin: true` in the route table |
| 8.4.2 admin interface layers | Partial | Single middleware gate (constant-time token) plus 404 masking plus strict rate tier; **add Cloudflare Access in front of `/api/scout/insights`** |
| 11.2.4 constant-time compares | **Fixed** | Transcript HMAC and admin token both compared in constant time |
| 11.4.1 approved hashes | Met | HMAC-SHA-256, SHA-256 |
| 11.5.1 CSPRNG | Met | `crypto.randomUUID` for lead IDs (`Math.random` only for A/B buckets) |
| 12.1.1 / 12.2.x TLS | Met (platform) | Cloudflare edge TLS; set minimum TLS 1.2 in the dashboard |
| 13.3.1 secrets management | Met | Worker secrets |
| 13.4.1 no .git deployed | Met | Only `dist/` is deployed |
| 13.4.2 debug off | Met | `?debug_analytics=1` only logs analytics events in the visitor's own console |
| 13.4.5 monitoring endpoints | Met | Insights requires a token and 404s otherwise |
| 13.4.6 version disclosure | Met | No `generator` meta, no version headers |
| 14.2.1 no sensitive data in URLs | **Fixed** | Lead tier moved from the thanks-page URL to sessionStorage |
| 14.2.3 nothing sensitive to trackers | **Fixed** | `data-clarity-mask` on Scout and all forms; analytics events carry no PII |
| 14.3.2 no-store on sensitive responses | Met | All API JSON is `cache-control: no-store` |
| 14.3.3 no sensitive data in browser storage | **Fixed** | All browser storage goes through `lib/storage.ts` (`sc_`-namespaced); `/privacy` has "Clear data saved in this browser" (GDPR Art. 17 eviction). Inquiry draft excludes name, email, phone, company and message; the Scout transcript is tab-scoped and clearable (documented residual risk) |
| 15.2.1 vulnerable components | Met | `npm audit` 0; `npm run verify` gate |
| 15.3.3 mass assignment | Met | Zod strips unknown fields |
| 15.3.6 prototype pollution | **Fixed** | Null-prototype counters; reserved keys rejected (`lib/scout/signals.ts`) |
| 16.3.3 security event logging | **Fixed** | `lib/security/log.ts` (§5) |
| 16.5.1 generic errors | Met | APIs return generic codes only |
| 16.5.4 last-resort handler | **Fixed** | `handleError()` in `middleware.ts` logs `unhandled_error` and returns a generic 500 |

## 9. Privacy controls (AuditForge GDPR / CCPA lanes)
- **GDPR / ePrivacy:** GA4, Clarity and Meta load **only after** the visitor clicks Allow (nothing is requested before consent; verified with test IDs). Plausible is cookieless and always on. Withdrawing consent switches loaded vendors to denied immediately and removes them on the next page load. The consent bar appears only when such a vendor is configured; the choice can be changed, and all site data cleared, on `/privacy#choices`.
- **CCPA / CPRA:** notice at collection (Scout panel, forms), "Do not sell or share" toggle, Global Privacy Control honored automatically, retention stated on `/privacy`.
- **AI disclosure** (CA bot law, EU AI Act Art. 50): see `docs/current/05-scout-concierge.md`.

## 10. AuditForge scan result

**2026-11-02, run 4 (57 rules, WEB014–017 added): `audit_repo.py --baseline docs/security/auditforge-baseline.json --fail-on LOW` → 0.**
- **Baseline (1 entry):** WEB017 "Missing security.txt" is a false positive. `/.well-known/security.txt` is generated by `src/pages/.well-known/security.txt.ts`, so `Expires` refreshes on every build; the rule only matches a static file named `security.txt`.
- **Fixed this run:** the Scout `page` value is now allowlisted to a plain path before it enters the `<context>` tag (it was only length-capped, so attributes could be spoofed). `privacy.ts` storage moved to `lib/storage.ts`. Inline pre-paint storage writes carry `soc2-ignore: PRIV003` reasons.
- **Suppressed false positive:** LLM001 on a TypeScript type annotation (`{ system: string }`).
- **DAST:** `NET_CSP_UNHASHED_INLINE` on 8 pages is a false positive (it counts JSON-LD / `application/json` data blocks as scripts). The browser crawl shows 0 violations.
**2026-11-02, run 3 (AuditForge with WEB006–013, PRIV, SEC010–012, LLM004): `audit_repo.py --fail-on LOW` → 0 findings, no baseline. `universal_audit` DAST against the production build → 0.** The only open item is `EMAIL_DMARC_MISSING` for seancarneymusic.com (a DNS record; see the launch checklist).

Run 3 raised 15 findings, all resolved:
- **Real gaps fixed:**
  - Request size limits (WEB012).
  - Header CSP still contained `'unsafe-inline'` (WEB006).
  - GA4/Clarity loaded before consent, cookieless (PRIV001).
  - Scattered storage writes with no eviction path (PRIV003).
  - Duplicated admin auth instead of one gate (WEB009).
- **False positives, refactored anyway:**
  - SEC012 matched the prototype-pollution *guard*; replaced with a key allowlist.
  - WEB010 didn't recognize the existing try/catch; it is now a named `handleError`.
- **Caught by DAST:** the first version of the hash injection produced a 2,783-character CSP line, which Cloudflare drops entirely. The site would have shipped with no header CSP. Fixed, and the build now fails on it.

Every suppression (`soc2-ignore`) carries a written reason: build-time-only `set:html`, consent-gated vendor loaders, and the one storage-helper write.

Earlier passes fixed: a hardcoded email, real addresses in `.env.example`, unpinned GitHub Actions, all DOM/HTML sinks, and the report-only CSP.

**SBOM:** `npm run sbom`, `docs/security/sbom.cdx.json`. semgrep, trivy, osv-scanner, checkov, nuclei, scorecard and trufflehog are not installed on this machine, so those lanes did not run.

## How to re-verify
```bash
cd apps/web && npm run verify          # types + build + npm audit gate
npm run sbom                           # refresh SBOM
python Z:/auditforge/scripts/audit_repo.py Z:/seancarneywebsite \
  --baseline docs/security/auditforge-baseline.json --fail-on LOW
node evals/run-scout-evals.mjs         # Scout safety/security gate (needs an API key)
```
