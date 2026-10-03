# Muse AI Hub

A dashboard and development zone for browser games built with **Muse Spark**.
Browse the collection, search and filter, and play any game instantly — every
game is a single self-contained HTML file.

Live site: deployed on Vercel from this repo.
Repo: `github.com/michaelcrosato/muse-ai-hub` (public).

## How it works

- `index.html` — the hub dashboard (search, tag filters, sorting, game cards).
- `play.html?id=<game-id>` — the player page; runs the game in an isolated iframe.
- `games/games.json` — the manifest. One entry per game; the hub renders from this.
- `games/*.html` — the games themselves. Drop a file here, add a manifest entry, done.
- `assets/` — hub CSS and JS. Zero dependencies, zero build step, works offline.

The hub is static on purpose: no backend to maintain, scales to hundreds of
games, and deploys anywhere (Vercel, GitHub Pages, any static host).

## Run it locally

Any static file server works. From the repo root:

```bash
python3 -m http.server 8080
# or
npx serve .
```

Then open `http://localhost:8080` in a browser.

## Add a game

See [CONTRIBUTING.md](CONTRIBUTING.md). Short version:

1. Copy your game file into `games/`.
2. Register it: `node scripts/add-game.mjs --add games/your-game.html --title "Your Title" --tags arcade,driving`
3. Check it: `node scripts/add-game.mjs --check`, then playtest via `play.html?id=<id>`.

## Deploy (Vercel)

This repo is Vercel-ready with no build settings required:

- Framework preset: **Other** (static)
- Build command: *(empty)*
- Output directory: `.` (repo root)

Or import the repo at [vercel.com/new](https://vercel.com/new) and accept the
defaults — `vercel.json` in the repo handles the rest.

## License

MIT — see [LICENSE](LICENSE).
