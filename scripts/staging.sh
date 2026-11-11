#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Staging: a separate Cloudflare Worker, lead database and KV namespace on
# workers.dev, for proving the real platform before launch. Never production
# data, never Sean's CRM. Walkthrough: docs/current/13-staging.md
#
#   bash scripts/staging.sh login     check the Cloudflare login (run `npx wrangler login` first)
#   bash scripts/staging.sh deploy    unit tests, staging build, deploy (creates D1 + KV the first time)
#   bash scripts/staging.sh secrets   generate staging keys, push them plus apps/web/.staging/env
#   bash scripts/staging.sh smoke     pages, admin gate, origin rule, an inquiry stored before delivery, dedup
#   bash scripts/staging.sh cron      wait (up to 16 min) for the 15-minute trigger to log a run
#   bash scripts/staging.sh retry     break email delivery, send an inquiry, restore it, and wait for
#                                     the cron to deliver it (needs Resend in .staging/env; up to 30 min)
#   bash scripts/staging.sh leads     open leads and per-state counts (no personal data)
#   bash scripts/staging.sh logs      live Worker logs
#   bash scripts/staging.sh teardown  delete the staging Worker, database and KV namespace
#
# Local state lives in apps/web/.staging/ (gitignored): env (your test settings),
# secrets.json (generated keys; never printed), url.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; N=$'\033[0m'; else B=''; G=''; Y=''; R=''; N=''; fi
step() { printf '\n%s==> %s%s\n' "$B" "$1" "$N"; }
ok()   { printf '  %s✓%s %s\n' "$G" "$N" "$1"; }
note() { printf '  %s•%s %s\n' "$Y" "$N" "$1"; }
fail() { printf '\n%s✗ %s%s\n' "$R" "$1" "$N" >&2; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
WEB="$ROOT/apps/web"
STATE="$WEB/.staging"
WORKER=seancarneymusic-staging
DB=seancarneymusic-leads-staging
# Cloudflare's published Turnstile test keys: always pass, so scripted inquiries get through.
TURNSTILE_TEST_SITE=1x00000000000000000000AA
TURNSTILE_TEST_SECRET=1x0000000000000000000000000000000AA
TURNSTILE_TEST_TOKEN=XXXX.DUMMY.TOKEN.XXXX
cd "$WEB"
mkdir -p "$STATE"

wr() { npx --no-install wrangler "$@"; }

# Reads KEY from .staging/env (KEY=value lines; blank or missing = unset).
cfg() { [ -f "$STATE/env" ] && sed -n "s/^$1=//p" "$STATE/env" | tail -1 | sed 's/^"\(.*\)"$/\1/' || true; }

url() {
  [ -s "$STATE/url" ] || fail "No staging URL yet. Run: bash scripts/staging.sh deploy"
  cat "$STATE/url"
}
admin() {
  [ -s "$STATE/secrets.json" ] || fail "No staging keys yet. Run: bash scripts/staging.sh secrets"
  node -e 'process.stdout.write(require(process.argv[1]).SCOUT_ADMIN_TOKEN)' "$STATE/secrets.json"
}

# HTTP helper: prints "<status> <body>".
http() { # method path [json-body] [extra curl args...]
  local m="$1" p="$2" body="${3:-}"; shift 3 || shift $#
  local out; out="$(mktemp)"
  local code
  local data=()
  [ -n "$body" ] && data=(-H 'content-type: application/json' --data "$body")
  code="$(curl -sS -o "$out" -w '%{http_code}' -X "$m" "$(url)$p" ${data[@]+"${data[@]}"} "$@")" || code=000
  printf '%s %s' "$code" "$(cat "$out")"; rm -f "$out"
}
status_of() { printf '%s' "${1%% *}"; }
body_of() { printf '%s' "${1#* }"; }
json_get() { node -e 'let v=JSON.parse(process.argv[1]);for(const k of process.argv[2].split("."))v=v?.[k];process.stdout.write(typeof v==="object"?JSON.stringify(v):String(v??""))' "$1" "$2"; }

# One lead's channel states from GET /api/leads (it lists every lead with open work;
# with no CRM connected, every staging lead stays listed).
lead_state() {
  local r; r="$(http GET '/api/leads?limit=200' '' -H "authorization: Bearer $(admin)")"
  [ "$(status_of "$r")" = 200 ] || { echo "unavailable ($(status_of "$r"))"; return; }
  node -e 'const p=JSON.parse(process.argv[1]);const l=p.leads.find(x=>x.leadId===process.argv[2]);
    if(!l){console.log("not listed");process.exit(0)}
    console.log(Object.entries(l.channels).map(([c,s])=>`${c}=${s.state}${s.attempts?`(${s.attempts})`:""}${s.error?` [${s.error}]`:""}${s.inProgress?" …":""}`).join("  "))' "$(body_of "$r")" "$1"
}

inquiry_json() { # event_id email
  node -e 'const [id,email]=process.argv.slice(1);process.stdout.write(JSON.stringify({
    event_type:"wedding",event_date:"2027-09-18",location:"Staging test, Santa Barbara",guests:"50 to 150",
    format:"small",moments:["Ceremony"],budget:"discuss",name:"Staging Test",email,role:"couple",
    message:"Automated staging test from scripts/staging.sh. Not a real inquiry.",
    event_id:id,started_at:Date.now()-30000,turnstile_token:process.argv[3],page:"/inquire"}))' "$1" "$2" "$TURNSTILE_TEST_TOKEN"
}
test_email() {
  local e; e="$(cfg STAGING_TEST_EMAIL)"
  if [ -n "$(cfg RESEND_API_KEY)" ]; then
    [ -n "$e" ] || fail "Set STAGING_TEST_EMAIL in apps/web/.staging/env: with Resend on, the confirmation email goes there. Use your own address."
  fi
  printf '%s' "${e:-staging-test@example.com}"
}
submit() { # event_id → prints "<status> <body>"
  local origin; origin="$(url)"
  http POST /api/inquire "$(inquiry_json "$1" "$(test_email)")" -H "origin: $origin"
}

guard_build() {
  node -e 'const c=require("./dist/server/wrangler.json");
    const bad=[];
    if(c.name!=="'"$WORKER"'")bad.push("worker name "+c.name);
    for(const d of c.d1_databases||[])if(!/-staging$/.test(d.database_name))bad.push("database "+d.database_name);
    for(const r of c.ratelimits||[])if(!/^2/.test(r.namespace_id))bad.push("rate limiter "+r.namespace_id);
    for(const k of c.kv_namespaces||[])if(k.id)bad.push("KV namespace with a fixed id "+k.id);
    if(c.routes||c.route)bad.push("a custom route");
    if(bad.length){console.error(bad.join("\n"));process.exit(1)}' \
    || fail "The staging build names production resources (above). Not deploying."
}

case "${1:-}" in
login)
  step "Cloudflare login"
  wr whoami || fail "Not logged in. Run: npx wrangler login"
  ;;

deploy)
  step "Unit tests"
  npm test --silent >/dev/null 2>&1 || { npm test; fail "Unit tests failed."; }
  ok "pass"
  step "Staging build"
  CLOUDFLARE_ENV=staging PUBLIC_TURNSTILE_SITE_KEY="$TURNSTILE_TEST_SITE" npx astro build >"$STATE/build.log" 2>&1 \
    || { tail -30 "$STATE/build.log"; fail "Build failed (full log: $STATE/build.log)."; }
  guard_build
  ok "built for $WORKER, database $DB, staging rate limiters"
  step "Deploy"
  wr deploy 2>&1 | tee "$STATE/deploy.log"
  u="$(grep -o 'https://[^ ]*\.workers\.dev' "$STATE/deploy.log" | head -1 || true)"
  [ -n "$u" ] || fail "Deployed, but no workers.dev URL in the output. Check that workers.dev is enabled for the account."
  printf '%s' "$u" >"$STATE/url"
  ok "live at $u"
  if grep -q '\*/15 \* \* \* \*' "$STATE/deploy.log"; then ok "cron */15 registered"; else note "cron schedule not shown in the deploy output; check with: bash scripts/staging.sh cron"; fi
  grep -q LEADS_DB "$STATE/deploy.log" && ok "LEADS_DB bound" || note "LEADS_DB not shown in the deploy output"
  note "next: bash scripts/staging.sh secrets (first time), then smoke"
  ;;

secrets)
  step "Staging secrets"
  if [ ! -f "$STATE/env" ]; then
    cat >"$STATE/env" <<'EOF'
# Staging settings (gitignored). Blank = off. Never use Sean's production CRM here.
# Your own address: confirmation emails from staging tests go here.
STAGING_TEST_EMAIL=
# Resend: a test API key. Without a verified domain Resend only delivers to the
# account owner's address, from onboarding@resend.dev.
RESEND_API_KEY=
INQUIRY_FROM_EMAIL=Staging <onboarding@resend.dev>
INQUIRY_NOTIFY_EMAIL=
# Optional: Scout AI replies on staging (otherwise guided mode).
SCOUT_PROVIDER=
ANTHROPIC_API_KEY=
EOF
    note "created apps/web/.staging/env: fill in Resend there when you have it, then run secrets again"
  fi
  node - "$STATE" "$TURNSTILE_TEST_SECRET" <<'EOF'
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const [dir, turnstile] = process.argv.slice(2);
const file = path.join(dir, 'secrets.json');
const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const gen = (k) => prev[k] || crypto.randomBytes(32).toString('hex');
const env = Object.fromEntries(fs.readFileSync(path.join(dir, 'env'), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"(.*)"$/, '$1')]; }));
const out = { SCOUT_SIGNING_KEY: gen('SCOUT_SIGNING_KEY'), LOG_HASH_KEY: gen('LOG_HASH_KEY'), SCOUT_ADMIN_TOKEN: gen('SCOUT_ADMIN_TOKEN'), TURNSTILE_SECRET_KEY: turnstile };
for (const k of ['RESEND_API_KEY', 'INQUIRY_FROM_EMAIL', 'INQUIRY_NOTIFY_EMAIL', 'SCOUT_PROVIDER', 'ANTHROPIC_API_KEY']) if (env[k]) out[k] = env[k];
if (Object.keys(env).some((k) => k.startsWith('GHL_'))) { console.error('GHL_* settings are not allowed on staging until a SHA-BAM test sub-account exists.'); process.exit(1); }
fs.writeFileSync(file, JSON.stringify(out, null, 2), { mode: 0o600 });
console.log('  keys: ' + Object.keys(out).join(', '));
EOF
  wr secret bulk "$STATE/secrets.json" --name "$WORKER" >/dev/null || fail "Could not upload secrets (deploy first?)."
  ok "uploaded to $WORKER (values are never printed)"
  [ -n "$(cfg RESEND_API_KEY)" ] || note "Resend is off: inquiries are stored, emails are skipped"
  ;;

smoke)
  U="$(url)"; T="$(admin)"
  step "Pages ($U)"
  for p in / /weddings /inquire /privacy; do
    s="$(curl -sS -o /dev/null -w '%{http_code}' "$U$p")"
    [ "$s" = 200 ] && ok "$p 200" || fail "$p returned $s"
  done
  step "Admin gate and lead database"
  s="$(status_of "$(http GET /api/leads '')")"; [ "$s" = 404 ] && ok "no token: 404" || fail "no token returned $s"
  r="$(http GET /api/leads '' -H "authorization: Bearer $T")"
  [ "$(status_of "$r")" = 200 ] || fail "with token: $(status_of "$r") $(body_of "$r") (503 = LEADS_DB not bound; 404 = secrets not uploaded)"
  ok "with token: 200, counts $(json_get "$(body_of "$r")" counts)"
  step "Origin rule"
  s="$(status_of "$(http POST /api/inquire "$(inquiry_json "$(node -p 'crypto.randomUUID()')" "$(test_email)")")")"
  [ "$s" = 403 ] && ok "no Origin: 403" || fail "no Origin returned $s"
  step "An inquiry is stored before delivery"
  ID="$(node -p 'crypto.randomUUID()')"
  r="$(submit "$ID")"
  [ "$(status_of "$r")" = 200 ] || fail "inquiry returned $(body_of "$r") ($(status_of "$r"); 403 verification_failed = Turnstile secret not set; 429 = wait a minute)"
  LEAD="$(json_get "$(body_of "$r")" leadId)"
  ok "accepted: $LEAD"
  ok "in D1 right after the response: $(lead_state "$LEAD")"
  step "Duplicate send"
  r="$(submit "$ID")"
  [ "$(json_get "$(body_of "$r")" leadId)" = "$LEAD" ] && ok "same event id → same lead $LEAD" || fail "duplicate created a second lead: $(body_of "$r")"
  step "Background delivery"
  sleep 10
  st="$(lead_state "$LEAD")"
  ok "after 10 s: $st"
  if [ -n "$(cfg RESEND_API_KEY)" ]; then
    case "$st" in *notify=delivered*confirm=delivered*) ok "both emails sent: check $(cfg INQUIRY_NOTIFY_EMAIL) and $(test_email)";; *) fail "emails not delivered yet: $st";; esac
  else
    note "Resend off: notify/confirm skipped, crm skipped (SHA-BAM deferred). The lead stays listed in /api/leads."
  fi
  ;;

cron)
  step "Waiting for the 15-minute trigger (up to 16 min)"
  if timeout 960 npx --no-install wrangler tail "$WORKER" --format json 2>/dev/null | grep -m1 -o '"lead_cron_run[^}]*'; then
    ok "cron ran"
  else
    fail "no lead_cron_run within 16 minutes. Check Triggers in the Cloudflare dashboard."
  fi
  ;;

retry)
  [ -n "$(cfg RESEND_API_KEY)" ] || fail "Needs Resend in apps/web/.staging/env (the test breaks and restores email delivery)."
  admin >/dev/null
  step "Break email delivery"
  printf 're_staging_invalid_key' | wr secret put RESEND_API_KEY --name "$WORKER" >/dev/null
  ok "RESEND_API_KEY set to an invalid key"
  sleep 15 # let the new version roll out
  step "Send an inquiry"
  r="$(submit "$(node -p 'crypto.randomUUID()')")"
  [ "$(status_of "$r")" = 200 ] || { node -e 'process.stdout.write(require(process.argv[1]).RESEND_API_KEY)' "$STATE/secrets.json" | wr secret put RESEND_API_KEY --name "$WORKER" >/dev/null; fail "inquiry returned $r (Resend key restored)"; }
  LEAD="$(json_get "$(body_of "$r")" leadId)"
  ok "accepted while email is broken: $LEAD"
  sleep 10
  ok "state: $(lead_state "$LEAD")"
  step "Restore email delivery"
  node -e 'process.stdout.write(require(process.argv[1]).RESEND_API_KEY)' "$STATE/secrets.json" | wr secret put RESEND_API_KEY --name "$WORKER" >/dev/null
  ok "real key restored"
  step "Waiting for the cron to deliver it (retry spacing 10 min, cron every 15; up to 30 min)"
  for i in $(seq 1 30); do
    sleep 60
    st="$(lead_state "$LEAD")"
    printf '  %2d min  %s\n' "$i" "$st"
    case "$st" in *notify=delivered*) ok "recovered by the retry: no lead lost"; exit 0;; esac
  done
  fail "not delivered after 30 minutes: $st"
  ;;

leads)
  r="$(http GET '/api/leads?limit=200' '' -H "authorization: Bearer $(admin)")"
  echo "$(status_of "$r")"; body_of "$r"; echo
  ;;

logs)
  wr tail "$WORKER" --format pretty
  ;;

teardown)
  step "Delete staging"
  note "This deletes the Worker $WORKER, the database $DB (all staging leads) and the staging KV namespace."
  printf '  Type "delete staging" to continue: '; read -r answer
  [ "$answer" = "delete staging" ] || fail "Cancelled."
  wr delete --name "$WORKER" --force || note "Worker already gone"
  wr d1 delete "$DB" -y || note "Database already gone"
  wr kv namespace list | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const n of JSON.parse(s))if(/staging/i.test(n.title))console.log(n.id+" "+n.title)})' |
    while read -r id title; do wr kv namespace delete --namespace-id "$id" --force >/dev/null && ok "KV $title deleted"; done
  rm -f "$STATE/url"
  ok "staging deleted (your settings in .staging/env are kept)"
  ;;

*)
  sed -n '3,20p' "$ROOT/scripts/staging.sh" | sed 's/^# \{0,1\}//'
  exit 1
  ;;
esac
