# Scout's AI backend: an open decision

Scout's AI backend is undecided and deliberately deferred, like the SHA-BAM connection and the Cloudflare deployment. Today Scout runs on its own Claude adapter, or in guided mode (no AI) when no key is set. This page records the options, what each depends on, and what to ask Sean before choosing.

## What exists now
- **Provider seam:** `src/lib/scout/providers/types.ts` defines `ScoutProvider.run(input) → { reply, cards, transcript, toolCalls, stop }`. Adapters register in `src/lib/scout/index.ts` (`SCOUT_PROVIDER`). The only adapter is `anthropic`; with no key Scout falls back to guided mode.
- **Tools are the authority, not the model.** Scout's four tools (`check_availability`, `show_media`, `open_page`, `submit_inquiry`) run in `src/lib/scout/tools.ts` with server-side validation. `submit_inquiry` goes through the same lead pipeline as the form (`lib/inquiry/deliver.ts`) and only runs when the visitor's own words contain the email and name. The model can request an action; the application decides whether it happens. Any new backend must keep this rule.
- **Testable without paid AI:** guided mode and the tool layer run with no model, so Scout's workflows can be tested locally at no cost.

## The three options

| | A. SHA-BAM native | B. Independent (current) | C. Hybrid |
|---|---|---|---|
| What runs the AI | HighLevel Conversation AI, inside SHA-BAM | Claude (or another model) behind the Worker | Scout's UI and tools; the model is either B's or HighLevel's, behind the provider seam |
| Scout's custom UI (cards, films, date check, music plan) | Replaced by the HighLevel chat widget, or needs testing | Kept | Kept, if HighLevel's API allows it |
| CRM link | Native | Through the lead pipeline (API/webhook) | Native records plus the lead pipeline |
| Model choice | Platform-controlled | Ours | Depends on the provider |
| Vendor lock-in | Higher | Lower | Medium |
| Setup | Low to medium | Done | Medium to high |
| Ongoing maintenance | Lower | Higher (model costs, monitoring) | Medium to high |

**Recommendation until Sean's account details are in:** keep B. It is built, tested, has a guided fallback and a cost cap. Nothing needs buying or rewriting now. C stays possible because the provider seam already exists.

## What HighLevel reportedly offers
From HighLevel's public documentation (September–October 2026), collected during research and **not yet verified against Sean's SHA-BAM account**:
- Conversation AI with custom instructions, brand voice and knowledge bases; lead qualification and contact capture; appointment booking through connected calendars; human handoff and automated follow-up; visual flows and prompt-based agents; calls to external HTTPS endpoints during a conversation; agent management through a public API.
- Published AI Employee pricing per sub-account: pay-per-use (token billing), Growth at $50/month (1,000 responses), Unlimited at $97/month (fair use). A white-label reseller such as SHA-BAM may price or bundle this differently.

**The deciding unknown:** HighLevel's public API manages agents and actions, but that does not show a supported endpoint for sending an arbitrary chat message from an external site and getting the agent's reply. Without one, a `highlevel` adapter for option C cannot exist, and option A means using HighLevel's widget instead of Scout's interface. Verify this before designing around it, so the site does not end up with two disconnected chat systems.

## Questions for Sean (with the SHA-BAM details)
1. Does the SHA-BAM account include Conversation AI / AI Employee, and on which plan (pay-per-use, Growth, Unlimited, or a SHA-BAM bundle)?
2. Can the account's API send a visitor message to an agent and return its reply (an inference endpoint usable from an external site)?
3. Should follow-up after an inquiry (texts, emails, reminders) live in SHA-BAM workflows? That is independent of which AI answers on the site, and it suits SHA-BAM well in every option.

## If the answer is C (hybrid)
1. Add `src/lib/scout/providers/highlevel.ts` implementing `ScoutProvider`, registered as `SCOUT_PROVIDER=highlevel`. It maps Scout's transcript and tools to HighLevel's API.
2. Keep the four tools server-side: HighLevel's agent calls them through an authenticated HTTPS action on the Worker, never by writing CRM records itself without the lead pipeline.
3. Run the Scout evals (`npm run eval:scout`) against the new adapter; the safety and security categories must pass 100% (`05-scout-concierge.md` §9).
4. Keep `anthropic` and guided mode as fallbacks behind the same seam.

## If the answer is A (native)
Embed HighLevel's widget, set `PUBLIC_SCOUT_ENABLED=false`, and move Scout's knowledge into the HighLevel knowledge base. The site loses Scout's inline cards (films, date check, music plan); weigh that before choosing.
