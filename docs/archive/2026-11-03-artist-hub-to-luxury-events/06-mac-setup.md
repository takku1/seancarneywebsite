# Mac setup and publishing (for Sean)

Everything needed to run the website on your Mac, see changes as you make them, and publish them. Written for a Mac with nothing set up yet. One-time setup takes about 20–30 minutes, mostly waiting for downloads.

## Before you start
- **macOS 13.5 or newer** (Apple menu > About This Mac). Older? Update first: System Settings > General > Software Update.
- **A GitHub account.** Create one at [github.com/signup](https://github.com/signup) if you don't have one, then send your username to Dillon.
- **Access to the project.** The repository is private. Dillon adds you at github.com/takku1/seancarneywebsite/settings/access, and you accept the invite email.
- **The setup file.** Dillon sends you `setup-mac.sh` (AirDrop, Messages or email). Save it to Downloads. Once you have access you can also get it from the repo: `scripts/setup-mac.sh` > "Download raw file".

## One-time setup
1. Open **Terminal**: press Cmd+Space, type `Terminal`, press Return.
2. Paste this and press Return:
   ```
   bash ~/Downloads/setup-mac.sh
   ```
3. Follow the prompts. Along the way:
   - A window asks to install the **Command Line Tools**: click Install, agree, and wait (it can take 10 minutes or more).
   - Homebrew asks for your **Mac password**. Nothing appears while you type it; that's normal. Press Return.
   - A browser window opens to **sign in to GitHub**. Terminal shows a short code; enter it in the browser and approve.
   - You're asked for your **name and email** for saved changes. Press Return to accept the suggestion (it uses GitHub's private address, so your personal email stays out of the project).
4. When it says **All set**, close Terminal and open a new window.

The project lives in `~/Code/seancarneywebsite`. The script is safe to run again any time (it only does what's missing), so if something is interrupted, just run it again.

Extras: `bash ~/Downloads/setup-mac.sh --extras` also installs VS Code (an editor) and ffmpeg (for video cuts). Add `--cloudflare` to log in to Cloudflare, which is only needed to deploy.

## Working on the site
```
cd ~/Code/seancarneywebsite/apps/web
npm run dev
```
Open **http://localhost:4321**. The page updates as you save files. Press Ctrl+C in Terminal to stop.

Most content lives in `apps/web/src/data/` (releases, shows, press, videos, credits, FAQs, event pages). It's plain text in JSON format: keep the quotes, commas and brackets exactly as they are around your edits. If something is off, the site stops with a message naming the file and line.

## Publishing your changes
```
cd ~/Code/seancarneywebsite
bash scripts/publish.sh "Add March show dates"
```
This one command, in order:
1. brings in anything new from GitHub first (your work is never overwritten),
2. checks the site builds, the same check GitHub runs, so a broken site is never published,
3. stops if anything looks like a password or API key,
4. saves your changes with your description and pushes them to GitHub (`main`).

If it stops, it says why and nothing is published. Fix what it names and run it again, or ask Dillon.

## Good to know
- Settings and keys go in `apps/web/.env`. That file is never published.
- `docs/STATUS.md` is the overview of where the project stands.
- Every push to `main` runs the checks on GitHub (the Actions tab of the repo).
