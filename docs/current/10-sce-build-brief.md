# SCE direction from the November 10 build brief

The selected brief is now organized at `resources/briefs/SCE Website.docx`. Media-management instructions are in `11-media-management.md`.

## Authority
The user selected `resources/briefs/SCE Website.docx` as the stronger direction. Completed answers supersede conflicting older positioning. Astro/Cloudflare, typed content, inquiry API, SHA-BAM, consent, CSP and persistent media retain their existing owners. Work is local; publishing is not requested.

## Adopted decisions
SCE / Sean Carney Entertainment is the public brand; Sean remains the named performer and songwriter. Public formats are Solo, Duo and Band; existing CRM values remain stable. The offer combines ceremony, cocktails, reception band, sound, lighting and a custom song, with investment discussed privately.

Cream, existing type and bronze/ink tokens remain. Élan Artists is the principal presentation/roster reference: an experience-led hero, image-led format choices and a player roster, rather than a directory of unrelated bands. A second color is unanswered. The supplied hero is now a silent 40-second loop, with phone-sized sources and existing motion/data protections.

`/custom-song` explains consultation, writing, studio recording and optional live performance. About and the custom-song page present supplied songwriting credentials. The brief clears brand marks; NBC, Netflix and Hyundai appear in their writing/placement context, not as wedding-client claims. `/videos` uses supplied films and existing curated YouTube entries; no new channel is invented.

## Music-planning contract
`lib/music-plan.ts` ranks only the supplied repertoire. `MusicQuiz.astro` asks event, mood, vibe and style, then suggests approximately thirty unique songs, excluding Do Not Play choices. Available supplied recordings can be previewed through the existing persistent player. `MusicPlan.astro` keeps at most twelve favorites and twelve exclusions; a song cannot belong to both lists.

Only repertoire IDs are stored in `sc_music_plan`, per tab, through `lib/storage.ts`. The existing privacy clear-data control evicts them. Share opens the existing inquiry route with a non-sensitive flag. The form resolves IDs to readable titles/artists in the editable message. Nothing is sent until the visitor reviews and submits. The 3,000-character message contract, consent and CRM mapping remain unchanged. Custom-song links also prefill an editable interest note.

## Open material
Mark and Aimee's story/media/consent, the expanded draft venue list, missing player biographies, individual performance videos, dedicated format montages, the new YouTube URL and SHA-BAM consultation URL remain unanswered or unsupplied. Existing confirmed rooms and usable biographies remain public. Custom-song standalone terms, rights, deliverables and deadlines stay consultation topics. No testimonials, venue experience or commercial terms are invented. These items are tracked in `14-decision-register.md` (P6, O3).

## Verification
Astro type checking and production build pass. Thirteen focused checks cover recommendations, unique results, genre/mood changes, exclusions, list limits and exclusivity, invalid storage, inquiry-message size, search and media persistence. Asset checks pass for 1,806 built local references, media below 25 MiB and all 98 original Drive file sizes. DOM doubles do not verify rendering/codecs; browser QA is unavailable because the browser host is disconnected. Source changes were reviewed through git diff; this is an unguarded run.

## References
[Élan Artists home](https://elanartists.com/) and [artist categories](https://elanartists.com/artists/) were inspected for presentation and roster structure. Their copy, images and endorsements are not reused.
