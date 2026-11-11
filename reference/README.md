# Reference snapshots (research fixtures)

Frozen captures, kept for migration and research. **They are not current authority:** the live offer, wording and claims are in `apps/web/src/data/` and `docs/current/`. Where they disagree, `docs/current/` wins.

| Folder | What it is | Used for |
|---|---|---|
| `current-site/` | The earlier SmartSite and its events sub-site (HTML and text; media is gitignored) | 301 redirects, provenance of testimonials and claims (`apps/web/src/data/testimonials.json` → `source`) |
| `competitors/` | Competitor page captures (`README.md` inside) | Positioning research only; never reuse their copy, images or design |
| `inspiration/` | Luxury brand references (`README.md` inside) | Visual direction research |

Rules:
- Never edit a snapshot; add a new dated capture instead.
- Nothing here is bundled into the site (the app only reads `apps/web/`).
- Only text and HTML are committed (about 5 MB); media stays local (`.gitignore`).
