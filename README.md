# Sean Carney Entertainment website

The website for SCE, a luxury live-music house for weddings and private events (Solo, Duo and Band). The existing Astro/Cloudflare implementation is the working design and behavior reference. SHA-BAM is the selected production hosting and client-portal target; native migration and account acceptance are pending. See [the migration plan](docs/current/17-sha-bam-migration.md) and [setup kit](docs/current/18-sha-bam-setup-kit.md).

Start with **[docs/STATUS.md](docs/STATUS.md)**, the single source of truth for project state.

## Repository layout

| Path | What it holds |
| :--- | :--- |
| `apps/web/` | The site: Astro pages, components, typed JSON content, Worker APIs, tests ([README](apps/web/README.md)) |
| `docs/current/` | Active documentation: positioning, design, architecture, integrations, launch, media management |
| `docs/security/` | Security baseline (OWASP ASVS 5.0), audit baseline and SBOM |
| `docs/research/` | Competitor and luxury-brand research reports and notes |
| `docs/archive/` | Superseded documentation, dated by pivot (ignore unless asked) |
| `scripts/` | Sean's Mac workflow (`setup-mac.sh`, `publish.sh`); staging checks (`staging.sh`, `docs/current/13-staging.md`) |
| `scripts/media/` | Media tooling: catalog-driven preparation, checks, built-site asset verification, tests |
| `reference/` | Snapshot of the previous site and competitor/inspiration captures (heavy media stays local) |
| `resources/` | Private, git-ignored: untouched Drive originals, briefs, contracts, incoming replacements |
| `.github/` | Manual CI (type check, tests, build, dependency audit; run from the Actions tab) and Dependabot |

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
| Full gate (types, tests, build, audit); run before pushing | `npm run verify` |
| Unit tests | `npm test` |
| Browser and runtime test: the listed pages, API guards and inquiry journeys (after `npm run build`; uses installed Chrome) | `npm run test:browser` |
| Scout evals (needs a running server and API key) | `npm run eval:scout` |
| Media: list, build, replace, check, report | `npm run media:<command>` (see `docs/current/11-media-management.md`) |
| Regenerate browser/install icons | `npm run brand:icons` |
| Publish (Mac) | `bash scripts/publish.sh "<description>"` from the repo root |

Publish-script tests, from the repo root: `bash scripts/test_publish.sh`. Check without saving: `bash scripts/publish.sh --check`. Pre-push checks (unit tests and type check when `apps/web` changes; `setup-mac.sh` turns them on): `git config core.hooksPath scripts/hooks`.

Python media tests, from the repo root: `py -m unittest scripts/media/test_media.py` (`python3` on macOS; needs Pillow).
