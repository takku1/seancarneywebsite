# Drive content update

## Scope and authority
Use Sean's supplied November website brief and Drive assets within the architecture and Ivory maison design in 01–03. The current site has sample songs, YouTube films and artist portraits. The update adds a searchable full repertoire, direct acoustic listening, supplied performance films, wedding photography and The SCENE's supplied member biographies.

## Ownership and contracts
Content remains in typed data under `apps/web/src/data`; Astro components render it. `src/lib/media/player.ts` owns one active session and the existing persistent dock, extended to native audio/video. Page setup uses `onPage`. Media derivatives live in `public/media`; untouched originals remain in local `resources`. APIs, SHA-BAM, consent and CSP retain their existing owners.

## Choices
The new brief's “The SCENE” replaces the former public band name. Preserve older filenames and historical research. Publish only supplied biographies; do not invent missing bios, venue stories, testimonials or pricing. Internal sales documents, contracts and rate cards inform preparation but are not public downloads. The song-list document is public repertoire material. Keep the ivory palette, type, sharp corners, typeset venue proof and wedding-first navigation.

## Implementation and acceptance
Ready: prepare compressed media; extend the existing player; update home, wedding/private-event imagery, repertoire, About and a linked `/the-scene` page; keep Scout's facts consistent. Checks: Astro types and production build, media sizes and local references, browser desktop/mobile checks of search, filters, playback/docking, navigation and inquiry. Source edits are reviewed with git diff (unguarded run); existing untracked reference files remain untouched.

## Unresolved prerequisites
New YouTube channel URL, consultation URL, venue stories and planner-pack production documents are not supplied. Keep existing configured integrations and fallbacks. No fabricated substitutes. No deployment requested in this repository task.

## Source placement
- `SCE WEBSITE HERO FINAL.mov`: muted, 40-second event-focused hero loop, in desktop and phone sizes.
- `SCE SIZZLE V.1.mov`: on-demand live film on Home, Weddings and The SCENE; a performance frame supplies the poster.
- `WEBSITE ASSETS/05-04-25_Kris_Shuman_Wedding_*.jpg`: wedding intro, garden solo image, first-dance imagery and About’s closing photograph.
- `THE SCENE BAND PICS/*`: five named portraits paired with the November website brief’s biographies. The brief names Raanen Bozzio and Nick Cisneros without supplying bios or portraits; their profiles remain unpublished.
- `ACOUSTIC COVERS` and `NEW ACOUSTIC COVERS`: all 15 supplied WAV recordings, encoded as MP3 for direct listening. Original artist recordings elsewhere in the archive are not used as Sean’s performances.
- `Sean Carney Entertainment_Full_Song_List 2026-2027.docx`: 192 actual entries across nine styles. The document’s “200+” marketing line is not repeated as a measured count. Original document available as a download.
- Internal contracts, sales scripts, price lists and the media release remain in the local archive. Existing venue/story and testimonial consent rules continue to apply.

## Validation evidence
The focused Node suites `evals/native-media.test.mjs` and `evals/repertoire.test.mjs` exercise the real player/search modules with DOM doubles: seven checks pass. They cover source replacement/unloading, audio retention in the dock, video docking/reconnection, combined song/artist search, accent handling, genre filtering, empty results and resetting all nine groups. These do not validate browser codecs or layout. Browser QA is unavailable in this session because the computer-use/browser host is disconnected.

Astro type checking and the production build pass. `scripts/media/verify_site_assets.py` checks 1,454 local references in the built site, the 25 MiB per-asset media limit, and all 98 original Drive file sizes. User review changed the home introduction to the ocean portrait so it no longer repeats Solo’s garden photo; the Private events dropdown now resets the hero’s light text tokens on its ivory surface.
