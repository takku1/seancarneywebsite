# Staging

Staging is a separate copy of the site on Cloudflare (`seancarneymusic-staging` on workers.dev). It has its own Worker, lead database (`seancarneymusic-leads-staging`), KV namespace and rate-limit counters, and no custom domain. It proves what local tests cannot: D1 provisioning and binding, the 15-minute cron trigger, background delivery after the response (`waitUntil`), secrets, and real email.

Staging never touches production data and never connects to Sean's live SHA-BAM account. `scripts/staging.sh` refuses `GHL_*` settings until a SHA-BAM test sub-account exists, and refuses to deploy a staging build that names a production resource. `evals/config-guards.test.mjs` checks that isolation on every test run.

## Setup
The `env.staging` block in `apps/web/wrangler.jsonc` defines staging. Bindings are not inherited from the top level, so each one is repeated there with its staging name. The site is built with `CLOUDFLARE_ENV=staging`, and Turnstile uses Cloudflare's test keys, which always pass, so scripted inquiries get through.

Local state lives in `apps/web/.staging/` (gitignored, and refused by `publish.sh`):
- `env`: your test settings (test email, Resend test key, optional Scout AI key).
- `secrets.json`: generated keys (`SCOUT_SIGNING_KEY`, `LOG_HASH_KEY`, `SCOUT_ADMIN_TOKEN`) plus the settings from `env`. The script never prints its values.
- `url`: the deployed workers.dev address.

## Steps
Run these from the repo root:

| Step | Command | Proves |
|---|---|---|
| 1 | `cd apps/web && npx wrangler login`, then `bash scripts/staging.sh login` | Cloudflare access |
| 2 | `bash scripts/staging.sh deploy` | Unit tests, staging build, isolation guard, deploy; D1 and KV are created on the first deploy; the cron schedule and the `LEADS_DB` binding appear in the deploy output |
| 3 | `bash scripts/staging.sh secrets` | Generated keys and Turnstile test secret uploaded; creates `.staging/env` the first time |
| 4 | `bash scripts/staging.sh smoke` | Pages load; `/api/leads` is hidden without the token and reaches D1 with it; a POST without Origin is refused; an inquiry is accepted and already in D1 right after the response; a duplicate send returns the same lead; delivery state 10 seconds later |
| 5 | `bash scripts/staging.sh cron` | The trigger fires: waits up to 16 minutes for the `lead_cron_run` log line |
| 6 | Fill in Resend in `.staging/env`, then run `secrets` and `smoke` again | The notification and confirmation emails arrive |
| 7 | `bash scripts/staging.sh retry` | Email delivery is broken on purpose, an inquiry is still accepted, the real key is restored, and the cron delivers the lead without help (up to 30 minutes: retry spacing is 10 minutes and the cron runs every 15) |
| 8 | SHA-BAM, once Sean provides a test sub-account | Contact, opportunity and note created; repeated retries do not duplicate the opportunity; idempotency across a timeout (see `04-integrations-and-workflows.md`) |

Without Resend, each staging lead stays `skipped` on every channel and remains listed in `GET /api/leads`. That is expected while SHA-BAM is deferred.

Other commands: `leads` (open leads and counts, no personal data), `logs` (live Worker logs), `teardown` (deletes the staging Worker, database and KV namespace after you type `delete staging`).

## What staging does not cover
- The Scout Send flow in a browser. It is covered locally in Chrome; on staging, open the workers.dev URL and send one draft by hand.
- Live Scout evals (`npm run eval:scout`), which need `ANTHROPIC_API_KEY`.
- DNS, the custom domain and production secrets (`06-launch-checklist.md`).
