# Sean Carney Entertainment website

The website for SCE, a luxury live-music house for weddings and private events (Solo, Duo and Band). An Astro static site on Cloudflare Workers, with a small API layer for inquiries, availability and the Scout concierge.

Start with **[docs/STATUS.md](docs/STATUS.md)**, the single source of truth for project state.

## Repository layout

| Path | What it holds |
| :--- | :--- |
| `apps/web/` | The site: Astro pages, components, typed JSON content, Worker APIs, tests ([README](apps/web/README.md)) |
| `docs/current/` | Active documentation: positioning, design, architecture, integrations, launch, media management |
| `docs/security/` | Security baseline (OWASP ASVS 5.0), audit baseline and SBOM |
| `docs/research/` | Competitor and luxury-brand research reports and notes |
| `docs/archive/` | Superseded documentation, dated by pivot (ignore unless asked) |
| `scripts/` | Sean's Mac workflow (`setup-mac.sh`, `publish.sh`) |
| `scripts/media/` | Media tooling: catalog-driven preparation, checks, built-site asset verification, tests |
| `reference/` | Snapshot of the previous site and competitor/inspiration captures (heavy media stays local) |
| `resources/` | Private, git-ignored: untouched Drive originals, briefs, contracts, incoming replacements |
| `.github/` | CI (type check, tests, build, dependency audit) and Dependabot |

## Quick start

```sh
cd apps/web
npm ci
npm run dev          # http://localhost:4321
```

Copy `apps/web/.env.example` to `apps/web/.env` for local API keys. A blank key disables that integration; the site still runs and logs what it would send.

## Common tasks

| Task | Command (from `apps/web`) |
| :--- | :--- |
| Full gate (types, tests, build, audit) | `npm run verify` |
| Unit tests | `npm test` |
| Scout evals (needs a running server and API key) | `npm run eval:scout` |
| Media: list, build, replace, check, report | `npm run media:<command>` (see `docs/current/11-media-management.md`) |
| Regenerate browser/install icons | `npm run brand:icons` |
| Publish (Mac) | `bash scripts/publish.sh "<description>"` from the repo root |

Python media tests, from the repo root: `py -m unittest scripts/media/test_media.py` (`python3` on macOS; needs Pillow).
