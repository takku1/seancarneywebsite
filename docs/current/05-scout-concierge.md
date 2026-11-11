# Scout: the concierge

Policy, architecture and controls for Scout, the AI concierge on seancarneymusic.com.
Owner: site maintainer (with Sean as business owner). Reviewed: 2026-11-03. Review again on any model or tool change, and at least quarterly.

## 1. What Scout is (and isn't)

- **Is:** a transactional booking concierge for weddings and private events. It checks date availability (indicative), suggests formats for each moment of the day, shows wedding films, answers questions from the site's own content, and submits inquiries the visitor explicitly confirms.
- **Isn't:** a companion, an advisor, or a decision-maker. It makes no consequential decisions about people, never confirms bookings or prices, and never acts without the visitor's request.
- **Risk tier:** low (NIST AI RMF framing): narrow scope, tools with limited side effects, a human (Sean) confirming every outcome.
- **Code:** `apps/web/src/lib/scout/` (knowledge, tools, intents, signals, integrity, providers), `src/pages/api/scout*.ts`, `src/components/scout/`.

## 2. Frameworks applied

| Framework | How it's used here |
|---|---|
| **NIST AI RMF 1.0** (Govern, Map, Measure, Manage), with the Generative AI Profile (NIST AI 600-1) as reference | This document = Govern. §1 = Map. §9 evals and metrics = Measure. §8 controls and §10 incident response = Manage |
| **OWASP Top 10 for LLM Applications (2025)** | Control-by-control mapping in §8 |
| **OWASP Top 10 for Agentic Applications (2026)** | Tool misuse (ASI02) and memory/context poisoning (ASI06) controls in §5 and §8 |

## 3. Legal and policy compliance

| Requirement | Applies because | How Scout complies |
|---|---|---|
| **California B&P Code §17940 et seq. (SB 1001, bot disclosure)** | Scout communicates with Californians in a sales context | Panel title "Scout, Sean's AI assistant"; every greeting says it's an AI assistant; footer: "You're chatting with an AI assistant, not Sean." The system prompt requires saying so if asked |
| **California SB 243 (companion chatbots, effective 2026-01-01)** | Applies only to bots meeting users' *social* needs | **Out of scope by design**: no relationship-building, no check-ins, no persistent memory, no companionship role-play (system prompt "Safety" section). Crisis protocol included anyway (988 / 911, stop selling). Re-assess if Scout ever gains memory or proactive messages |
| **CCPA/CPRA notice at collection** | Personal info may be typed into chat | Notice shown in the panel *before* the first message, linking to `/privacy#scout`, which states purposes, the processor (Anthropic), retention (tab-only transcripts; anonymous counters 120 days) and no sale/share |
| **EU AI Act Art. 50(1)** (transparency, from 2026-08-02) | EU visitors may use Scout | Same AI disclosure as above, shown at the start of every interaction |
| **Utah / Maine AI disclosure** | Broad AI-interaction disclosure | Satisfied by the same disclosure |
| **FTC Act §5 (deceptive AI claims)** | Marketing claims about the assistant | Scout is described only as an AI assistant. It never claims to book, confirm or guarantee anything; availability is "looks open". No claims about Scout's accuracy |
| **TCPA / A2P 10DLC** | SMS follow-ups via GHL | Scout always submits `sms_consent: false`. SMS consent is collected only by the form checkbox |

*Not legal advice. Have counsel confirm before launch, especially SB 243 scope if features change.*

## 4. Personality and behavior spec

**Voice:** a polished concierge for a luxury wedding house: warm, brief, assured. Plain, elegant English; no slang, no exclamation marks, no regional caricature. Crisper and more formal for planners, corporate, gala and budget conversations.

| Do | Don't |
|---|---|
| "I'd be glad to check that date for you." | Slang, hype or caricature |
| Two to four sentences, then one clear next step | Long lists, sales pressure, urgency or scarcity claims |
| Match the register: romantic with couples, precise with planners | One tone for every conversation |
| "That date looks open; Sean confirms personally" | "You're booked" / "Confirmed" |
| "Sean sends a proposal tailored to the day" | Any price, rate or package number |
| "I'm not sure; may I pass that to Sean?" | Guessing credits, policies or availability |
| Say it's an AI when asked or relevant | Speak as Sean, or imply a human is typing |

**Behaviors:**
- **Inquiry flow:** collect 2–3 fields at a time; read back the summary; get an explicit yes; then submit.
- **Hand-off:** after 20 visitor turns, or 4 tool rounds in one turn, Scout hands off to `/inquire`.
- **Unknowns:** decline to guess; offer to route the question to Sean.
- **Off-topic:** steer back politely.
- **Safety:** self-harm or danger means care, 988 / 911, and no further selling. With apparent minors, Scout keeps to general questions and a guardian handles any booking.

The source of truth is the system prompt in `lib/scout/knowledge.ts`, generated from site content, so facts can't drift from the pages.

## 5. Memory architecture (what Scout remembers, where, and for how long)

| Tier | Contents | Where | Retention | Poisoning risk and control |
|---|---|---|---|---|
| Working memory | The current conversation | Visitor's tab (`sessionStorage`) | Until the tab closes or "Clear chat" | Tampering: **HMAC-signed by the server**; forged history is rejected (`lib/scout/integrity.ts`) |
| Knowledge | Bio, rooms, formats, event types, FAQs, repertoire, films | Built from `src/data/*.json` at build time | Versioned in git | Read-only at runtime; changes only via reviewed commits or the CMS. No RAG or vector store, so no runtime injection path |
| Aggregate signals | Topic counts, checked dates, scrubbed unmatched questions | Cloudflare KV `SCOUT_KV` | 120 days (TTL) | **Never fed back into the model.** Trending chips show only canonical, pre-written questions, so one visitor's text can't reach another's session |
| Long-term record | An inquiry the visitor confirmed | GoHighLevel CRM | Per Sean's CRM policy | Created only by `submit_inquiry` with grounding checks (§6) |
| Provider-side | Request processing by Anthropic | Anthropic | Per Anthropic's API data policy (no training on API data by default; check current terms) | Disclosed on `/privacy#scout` |

**No cross-session memory or user profiles.** Adding any would trigger a re-review (SB 243 scope, CCPA notice, ASI06).

## 6. Tools and skills registry

| Tool | Side effect | Risk | Guards |
|---|---|---|---|
| `check_availability(date)` | None (read-only free/busy) | Low | Date format check; free/busy-only calendar share (the site can never read event details); answers worded as indicative |
| `show_media(ids)` | None | Low | IDs must exist in the build-time catalog; max 3; the UI renders only known YouTube IDs and site URLs |
| `open_page(page)` | None (renders a button) | Low | Enum of site routes only; the client renders only allowlisted routes, so it can never link off-site |
| `submit_inquiry(...)` | Creates a CRM lead and sends emails | Medium | `visitor_confirmed` required; **the email and first name must appear in text the visitor typed** (blocks injected or hallucinated submissions); full schema validation (same as the form); `sms_consent` forced false; tagged `via:scout` |

Principles: least privilege (no tool can read CRM data, send arbitrary email, browse the web or run code); every tool is idempotent or confirmation-gated; tool results are data, never instructions. Adding a tool requires a row here plus eval cases.

## 7. Provider abstraction

`lib/scout/providers/types.ts` defines the seam. The provider is Claude (`claude-opus-5-5` by default, `SCOUT_MODEL` to override; effort `low`; prompt-cached knowledge; server-side refusal fallback where supported). No key means **guided mode**: scripted flows with no AI, no cost, and the same tools via direct endpoints. Switching providers changes only the adapter. Whether Scout stays on its own model, moves to SHA-BAM's Conversation AI, or uses a hybrid is an open decision: `12-scout-backend-decision.md`.

## 8. Security controls (mapped to OWASP LLM Top 10, 2025)

| OWASP | Risk | Control in this build |
|---|---|---|
| LLM01 | Prompt injection | System-prompt boundaries; signed transcripts; tool-result data only; injected text can't trigger submissions (grounding check); no web browsing or document ingestion |
| LLM02 | Sensitive info disclosure | The knowledge base holds only public site content and no secrets; no CRM read access; PII scrubbed from gap logs |
| LLM03 | Supply chain | Official `@anthropic-ai/sdk`; lockfile pinned; `npm audit` in CI (to add) |
| LLM04 | Data/model poisoning | No fine-tuning; knowledge only from reviewed repo content |
| LLM05 | Improper output handling | All model text HTML-escaped; only allowlisted site routes and mailto become links (tested against `javascript:`, `//evil`, and `<img onerror>`) |
| LLM06 | Excessive agency | Three narrow tools; confirmation plus grounding on the only write action; max 4 tool rounds per turn |
| LLM07 | System prompt leakage | The prompt is treated as public: nothing secret in it; instruction not to reveal it anyway |
| LLM08 | Vector/embedding weaknesses | No vector store |
| LLM09 | Misinformation | Grounded in site content; refuse unknowns; availability is indicative; prices never stated |
| LLM10 | Unbounded consumption | 1,000-char messages; 150 KB transcript cap; 20-turn cap; rate limits: the standard API tier (20 requests per minute per client, a Cloudflare Rate Limiting binding; `lib/security/rate-tiers.ts`) plus a best-effort per-isolate cap of 40 AI turns per 10 minutes, and a **Cloudflare WAF rate rule on `/api/scout` (set at deploy)**; daily AI-turn budget (`SCOUT_DAILY_LIMIT`, default 1,500) then guided mode, a soft cap because KV counters are not atomic, failing closed to guided mode in production without storage; the hard cap is the API key's workspace spend limit in the Claude Console; `max_tokens` 2000 |

**Transcript signing is required in production:** without `SCOUT_SIGNING_KEY`, `/api/scout` serves guided mode only (logged as `scout_signing_key_missing`), and unsigned history is rejected; only development runs unsigned.

**Secrets:** `ANTHROPIC_API_KEY`, `SCOUT_SIGNING_KEY` and `SCOUT_ADMIN_TOKEN` live only in Worker secrets (`wrangler secret put`). Rotate them every 90 days or immediately on suspicion; rotating the signing key just resets open chats. `/api/scout/insights` returns 404 without the bearer token.

## 9. Measurement

- **Product metrics** (analytics events): `scout_open` (by source: launcher, invite, resume), `scout_message`, `scout_reply` (latency, tools used), `scout_tool`, `scout_handoff`, `inquiry_submit {via: scout}`, `scout_error`, `scout_clear`. North star: **booked revenue from Scout-sourced leads** (`via:scout` tag in GHL) against form-sourced leads.
- **Demand insights:** `GET /api/scout/insights` (top questions, unanswered gaps, hottest dates). Review weekly; turn recurring gaps into FAQ entries (they then flow into Scout automatically).
- **Evals (release gate):** `apps/web/evals/scout-cases.json` covers behavior, safety and red-team cases. Run `node apps/web/evals/run-scout-evals.mjs` against a local server with an API key before any change to the prompt, model or tools. It costs a few cents per run. Gate: 100% pass on the safety and security categories.

## 10. Incident response

1. **Kill switch:** set `SCOUT_PROVIDER=none` (guided mode, instant on the next request) or `PUBLIC_SCOUT_ENABLED=false` and redeploy (hides Scout entirely).
2. If abuse or a cost spike: lower `SCOUT_DAILY_LIMIT`, tighten the WAF rule, and rotate `ANTHROPIC_API_KEY`.
3. If a bad lead or injection is suspected: search GHL for the `via:scout` tag, rotate `SCOUT_SIGNING_KEY`, and add a red-team eval case reproducing it.
4. If harmful or incorrect output is reported: capture the exact text, add an eval case, fix the prompt or knowledge, and re-run the evals before re-enabling.

## Sources
- OWASP Top 10 for LLM Applications 2025: https://genai.owasp.org/2024/11/17/owasp-reveals-updated-2025-top-10-risks-for-llms-announces-new-llm-project-sponsorship-program-and-inaugural-sponsors/ ; summary https://www.hackerone.com/blog/owasp-top-10-llms-2025-how-genai-risks-are-evolving
- OWASP Top 10 for Agentic Applications 2026 (ASI02 tool misuse, ASI06 memory poisoning): https://www.giskard.ai/knowledge/owasp-top-10-for-agentic-application-2026 , https://goteleport.com/blog/owasp-top-10-agentic-applications
- California SB 243 companion chatbots: https://perkinscoie.com/insights/update/california-companion-chatbot-law-now-effect , https://www.gunder.com/en/news-insights/insights/client-insight-california-sb-243-new-compliance-requirements-for-operators-of-ai-companion-chatbots
- EU AI Act Art. 50 transparency: https://secureprivacy.ai/blog/eu-ai-act-article-50-transparency-obligations-for-chatbots-and-deepfakes-2026
- CPRA notice at collection and retention: https://transcend.io/blog/cpra-notice-at-collection , https://dailyjournal.com/articles/367336-cpra-series-part-iii-notice-and-disclosure-obligations
- FTC deceptive AI claims (Operation AI Comply / DoNotPay): https://www.akingump.com/en/insights/ai-law-and-regulation-tracker/ftc-announces-five-cases-involving-deceptive-ai-practices
- Utah/Maine broad AI disclosure (secondary): https://closebot.com/blog/ai-chatbot-disclosure-requirements/
- SB 1001 (Cal. Bus. & Prof. Code §17940) and NIST AI RMF / AI 600-1: from background knowledge, **verify the current text before launch**.
