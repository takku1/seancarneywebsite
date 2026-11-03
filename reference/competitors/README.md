# Competitor captures

Reference for positioning and structure; read alongside `docs/research/reports/2026-11-03 Competitor and luxury teardown.md`. Never reuse copy, images or design from these sites.

| Folder | Site | Pages | Source |
|---|---|---|---|
| `moses-lin/` | moseslinmusic.com (LA / Orange County, destination) | 8 | Internet Archive snapshots 2023–2025 (live site returned 502 on 2026-11-03); URLs in `index.json` |
| `dylan-galvin/` | dylangalvin.com (DC / Virginia / Maryland) | 29 (all 23 core + 6 of 68 blog posts) | live site |
| `johnny-rockett/` | johnnyrockettmusic.com (Charlotte, NC) | 8 | live site |

Per site:
- `text/*.md`: readable page text (headings, paragraphs, lists, quotes). Committed.
- `pages/*.meta.json`: title, description, heading outline, navigation, calls to action, form fields, type and color samples, JSON-LD, video embeds. Committed.
- `index.json`, `assets.json`: page list and asset inventory. Committed.
- `pages/*.html` (rendered DOM), `shots/*-desktop.jpg` / `*-mobile.jpg` (full-page screenshots), `media/` (images and CSS): **local only** (gitignored), third-party material kept for internal reference.

Method: Playwright with the system Chrome, one page every 1.5 s, every URL checked against the site's robots.txt Disallow rules. Captured 2026-11-03. Sites that block automated access were not captured (see `reference/inspiration/README.md`).
