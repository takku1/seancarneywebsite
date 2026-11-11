# Managing SCE media

The working catalog is **[media-library.json](../../apps/web/src/data/media-library.json)**. It records stable asset IDs, original sources, preparation profiles, outputs, image alt text and named page placements. **Do not edit the Python script to swap a photo or recording.**

From `apps/web`, run `npm run media:report`, then open `resources/media-index.html`. This private, searchable inventory previews prepared media, shows source/output locations and code references, and lists the complete original Drive archive. Regenerate it after changes. It is not deployed.

## Folder map

| Location | What belongs here |
| --- | --- |
| `resources/originals/drive-2026-11-10/` | Untouched original Drive files, original names/subfolders and download manifest |
| `resources/briefs/` | Working briefs, including `SCE Website.docx` |
| `resources/incoming/<asset-id>/` | Versioned replacement originals, named by content hash |
| `resources/media-index.html` | Generated local inventory |
| `apps/web/src/assets/photos/` | Prepared site images; Astro makes responsive web copies at build |
| `apps/web/public/media/` | Prepared videos and audio; never raw multi-GB masters |
| `apps/web/public/downloads/` | Explicitly public documents only |

`resources` stays local and ignored by git. Prepared assets, the catalog and content JSON are tracked. A checkout can build the site without the private originals; preparing new derivatives requires the relevant original files. Back up `resources` separately.

## Replace an existing image, video or recording

Run these from `apps/web`:

```sh
npm run media:list
npm run media:info -- beach-portrait
npm run media:replace -- beach-portrait "C:/path/to/new-photo.jpg" --alt "Sean smiling beside the ocean"
npm run media:build -- beach-portrait
npm run media:check
npm run check
npm run build
```

On Mac use your normal `/Users/...` source path. The npm wrapper chooses `py` on Windows and `python3` on Mac/Linux. FFmpeg and Pillow are required for preparation; they are not required to change a page placement. Install Pillow in your Python environment with `python3 -m pip install Pillow` (Windows: `py -m pip install Pillow`).

The replace command copies a new source into `incoming`; it preserves both the old original and the stable published filename. All existing references keep working after you rebuild. Image replacements may also require new alt text; `--alt` changes the central value for named placements. Preview every place listed by `media:info` before publishing.

For a film: `npm run media:replace -- sce-live-film "/path/new-film.mov"`, then `npm run media:build -- sce-live-film`. If it is too large for the 25 MiB static limit, the build fails before replacing the existing output. Adjust that profile's bitrate in the catalog, or use a shorter approved edit. **Never replace a public MP4 with the raw master manually.**

For a recording use its stable ID, such as `audio-lose-control`. Titles, original artist attribution and listening order live in its catalog entry. `media:build` synchronizes `src/data/audio.json`; do not edit that generated file by hand.

## Change which image appears in a section

Edit only `placements` in `media-library.json`, choosing an existing asset ID:

```json
"home.intro": "beach-portrait",
"home.format.solo": "wedding-garden",
"home.format.duo": "sce-film-poster",
"home.format.band": "wedding-evening"
```

Other named placements cover the hero/poster, custom song, About, The Scene and the main live film. Run `npm run check` and `npm run build`; no media conversion is needed when the selected image is already prepared. Avoid repeating the same image in adjacent sections. Hero posters and film posters are independent assets even when extracted from the same master.

## Change a hero edit or poster frame

For `hero-loop`, edit `start` and `duration` in seconds. For `hero-poster` or `sce-film-poster`, edit `posterTime`. Then rebuild those IDs. Desktop/phone widths, frame rate and compression are under `profiles`. The existing muted, delayed-load and reduced-motion behavior belongs to the Hero component and remains intact.

```sh
npm run media:build -- hero-loop hero-poster
```

The build prepares only new/changed sources or recipes. `--force` rebuilds selected IDs. Files are generated beside the old outputs and promoted only after every derivative for that asset succeeds. A failed encoding leaves prior outputs available. The cache is private; deleting it only causes another preparation run. A lock prevents simultaneous builds; if interrupted, first confirm the build has stopped before removing `resources/.media-build.lock`.

## Add media and manage the other content

Add a catalog asset with a unique lowercase ID, a source relative to `resources`, a supported `profile`, and stable output paths matching that profile. Add image alt text and a useful label. Copy a similar existing entry; then build its ID. New audio entries also need `trackId`, `artist` and `order`. New images become selectable by a named placement after preparation.

| Change | Owner |
| --- | --- |
| Local sources, prepared files, posters, compression, primary page images | `media-library.json` |
| YouTube ID, title and context | `src/data/videos.json` |
| Featured/ranked YouTube choices | `src/data/feed-rules.json` |
| Player bio/name/portrait asset | `src/data/musicians.json`; portrait outputs resolved through the media catalog |
| Event page's selected image and page-specific description | `src/data/events.json` (existing Astro image paths); replacing that registered image keeps the path stable |
| Song-list download | `song-list-download` in the media catalog |
| Searchable song list | `src/data/songbook.json`; changing the download alone does not rewrite curated song data |
| Browser/install wordmark icons | `apps/web/scripts/prepare-brand.mjs` |

Some older curated images are deliberately marked `legacy`: their current outputs work, but the exact original is not mapped. Do not guess or label them reproducible. `media:replace` supplies a real source and moves them into the standard photo workflow. Historical artist cover art and branding exports have their existing owners; they are not silently rebuilt by this tool.

## Before publishing and rollback

Run `media:check`, the Astro check/build and `py scripts/media/verify_site_assets.py` from the repository root. The last command also verifies all 98 original download sizes. In CI or a source-free checkout use `npm run media:check -- --outputs-only`; source freshness cannot be checked without the private originals/cache. Review the pages on desktop and phone, alt text, crops, sound, pause controls and persistent playback.

To undo a replacement, restore the previous catalog `source` (visible in git history), then rebuild that ID. To undo a placement, restore its previous asset ID and rebuild the site. Old originals and incoming versions are retained. Do not delete an output just because it is absent from the home page: check its usages first. No cleanup command removes originals automatically.
