# SHA-BAM hosting and client experience

## Direction and current state

Decision, 2026-11-12: the owner requests SHA-BAM hosting and workflows, replacing the proposed Cloudflare deployment. Do not provision Cloudflare or change DNS for that proposal. The Astro implementation remains the design/content reference and working fallback until the native replacement passes acceptance.

Public evidence checked 2026-11-12: seancarneymusic.com identifies itself as a SmartSite by SHA-BAM, uses LeadConnector media, resolves to 162.159.140.166, and www aliases sites.ludicrous.cloud. Nameservers are ns-cloud-b1 through b4.googledomains.com. These identify infrastructure, not the registrar account owner or account permissions.

This is a platform migration, not a Wrangler configuration change. The repository runs Astro server endpoints, D1 persistence, KV, rate limits and scheduled retries. No supported way to deploy that Worker into SHA-BAM has been verified. HighLevel's Client App Builder explicitly excludes custom server code/databases. Native features must replace these responsibilities and pass new tests.

## Ownership and replacement map

| Existing behavior | SHA-BAM target | Acceptance before switching |
|---|---|---|
| Astro pages, curated content and media | Draft website pages in Sean's sub-account; preserve reviewed design and URLs | Every public route, metadata, redirects, mobile layout, films and audio checked; private originals never uploaded |
| Five-step inquiry and referral fields | Native form/survey with contact and event fields | Required fields, consent, referral source/name, attribution and submission receipt verified in account |
| D1 acceptance and delivery queue | Native submission record and workflow execution history | Prove saved submission, failure visibility, recovery and duplicate handling; do not claim the former D1 guarantees |
| Lead scoring and CRM delivery | Native workflow updates contact and Bookings opportunity | Existing scoring rules reproduced, two events for one contact remain separate; repeated processing creates no duplicate booking |
| Resend notification and confirmation | SHA-BAM authenticated email and workflows | Sean and visitor receive real test messages; failed delivery is visible and recoverable |
| Calendar free/busy endpoint | SHA-BAM calendar with verified conflict calendar | Test busy/free dates, time zones and manual review; unavailable data never means available |
| Scout API and guided chat | Native chat/Conversation AI if enabled | Check account features, cost and consent; approved answers, handoff and lead capture; no fabricated dates or booking confirmation |
| Signal/source reporting | Native attribution and booked-opportunity reporting | Reconcile a sample of booked events with source/referrer; define report retention and access |
| Worker security/CSP/reporting | SHA-BAM platform controls plus supported page settings | Spam protection, access, privacy, analytics consent and error monitoring tested on hosted pages |
| Post-event/rebooking specs | Native workflows from doc 16 | Test with internal contacts, suppression on replies/unsubscribe, and Sean-approved templates |
| Contracts, invoices, payments | SHA-BAM native documents and payment provider | Correct event, recipient, amount and status; no payment test without authorized test mode |

## Client portal increment

Use SHA-BAM's native client authentication first. Clients should reach their agreements, invoices, consultation booking and shared event resources from one branded entry. Validate enabled modules in Sean's account; general HighLevel documentation is not proof of his reseller entitlements.

SHA-BAM owns identity, contact access, contracts, payments and conversations. Event details belong to the booking/opportunity, not a single contact field that a repeat booking overwrites. Planner access must be explicitly scoped to its event and must not imply access to a couple's financial documents. Song requests, timelines and uploads remain conditional until native record permissions and event association are demonstrated.

Use the standard portal URL for public navigation. Contact-specific magic links belong only in native private invitation/login workflows, never public HTML, analytics or browser storage. Begin with two unrelated test clients and one repeat client with two bookings. Verify isolation, sign-out, expired-link recovery and mobile access. Do not create a parallel user database.

## Execution and release gates

1. Obtain access to Sean's SHA-BAM sub-account. Inventory Websites, Forms/Surveys, Calendars, Workflows, Client Portal, email sending and integrations without changing the live site. Record enabled modules and existing workflows to avoid duplicate notifications.
2. Duplicate the existing website into an unpublished draft. Record the current domain mapping and rollback procedure. Build one complete inquiry-to-notification-to-portal test path before migrating remaining pages.
3. Configure the replacement map above using test contacts and workflows restricted to them. Record preview URLs, test dates, results and observed failures. Native saved submissions replace D1 only after the recovery tests pass.
4. Port reviewed pages and assets; verify legacy routes, SEO, accessible forms, film/player behavior and real-device journeys. Existing local tests establish only the Astro reference behavior.
5. Obtain the content/offer approvals in doc 14. Reconcile privacy/terms with actual SHA-BAM storage, retention, processors and messaging; remove statements about D1 and Resend from the native version when no longer applicable.
6. Validate authenticated email, alerts and portal isolation. Confirm rollback can restore the previous website mapping. Only then replace the live website mapping; preserve existing mail and unrelated DNS records.
7. Send an authorized production inquiry, verify submission, opportunity, notification and confirmation; check redirects and sitemap. Resume ordinary workflows only after acceptance.

## Assurance and blockers

Security/privacy, reliability, operations, verification and UX apply; payments and cross-client access need explicit account tests. Evidence status: public hosting inspected; source dependencies inspected; native parity and tenant isolation untested. No new infrastructure or schema has been provisioned.

Blocked: SHA-BAM account access and reseller feature inventory. Browser automation discovery found no available browser/native host in this session. There is no SHA-BAM connector available. No authenticated account changes, imports or native staging deployment have occurred. Cloudflare login is no longer a prerequisite for the selected direction.

## Provider references (checked 2026-11-12)

- Live hosting attribution: https://seancarneymusic.com/
- Client App Builder capabilities/limitations: https://help.gohighlevel.com/support/solutions/articles/155000009531-getting-started-with-client-app-builder-build-custom-web-and-mobile-apps-with-ai
- Portal setup and branding: https://help.gohighlevel.com/support/solutions/articles/155000000193-how-to-set-up-the-client-portal-
- Contact-specific portal invitations: https://help.gohighlevel.com/support/solutions/articles/155000001205-client-portal-dashboard
- Native forms: https://help.gohighlevel.com/support/solutions/articles/155000004549-how-to-create-a-contact-form-in-highlevel-

## Prepared handoff

The native configuration and acceptance worksheet is in [18-sha-bam-setup-kit.md](18-sha-bam-setup-kit.md). Generate the public reference inventory with `node scripts/prepare-shabam.mjs` after building the reference. This preparation does not configure the account or certify native parity.
