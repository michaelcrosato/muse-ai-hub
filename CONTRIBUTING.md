# Adding games to the Hub

Every game on the hub is **one self-contained `.html` file** plus **one entry**
in `games/games.json`. That is the whole contract — it stays the same whether
there are 7 games or 700.

## Steps

1. **Drop the file in `games/`**

   Keep filenames lowercase with dashes, e.g.
   `blastcorps-rumbleline-20261001-musespark.html`.
   The file must work standalone (inline CSS/JS, no external assets the hub
   has to know about).

2. **Register it in `games/games.json`**

   Either edit the JSON by hand or use the helper:

   ```bash
   node scripts/add-game.mjs --add games/your-game.html \
     --title "Your Game Title" \
     --description "One or two sentences, shown on the card." \
     --tags arcade,driving \
     --controls "Arrows / WASD + Space" \
     --renderer webgl2
   ```

   (`--renderer` is the minimum renderer the boot gate requires: `2d`,
   `webgl`, `webgl2`, or `webgpu`. Add `--prefer webgpu` when the game
   prefers one renderer but falls back to another.)

   Entry schema:

   | Field         | Required | Notes                                                        |
   |---------------|----------|--------------------------------------------------------------|
   | `id`          | yes      | Lowercase letters, digits, dashes. Stable — it's the play URL. |
   | `title`       | yes      | Display title.                                               |
   | `file`        | yes      | Bare filename only (no paths), must end in `.html`.          |
   | `description` | no       | 1–2 sentences for the card.                                  |
   | `tags`        | no       | Lowercase slugs, e.g. `clearance-racer`, `webgl`, `arcade`.  |
   | `added`       | no       | `YYYY-MM-DD`. Drives newest/oldest sort.                     |
   | `controls`    | no       | One-line hint shown in the player header.                    |
   | `engine`      | no       | e.g. `Muse Spark`.                                           |

3. **Wire the boot loader**

   Every game carries the MUSE SPARK BIOS boot screen (env checks, renderer
   probe, progress with step codes, screenshot-friendly failure report):

   ```bash
   node scripts/inject-boot.mjs --inject --game <id>
   ```

   Set `boot.renderer` in `games.json` to the minimum your game needs
   (`2d`, `webgl`, `webgl2`, `webgpu`; optional `boot.prefer` for the
   preferred-with-fallback renderer). Start from `boot/template.html` for new
   games — it shows the one-line gate your module script needs:
   `await window.MuseBoot.gameReady();`

   To keep hub dependencies out of the game HTML, register with
   `--boot-assets shared` (or set `boot.assets` to `"shared"`). The injector then
   references `../boot/muse-boot.css` and `../boot/muse-boot.js`. Serve the file
   within the hub so those shared assets remain available. The default `"inline"`
   mode embeds the boot loader for fully standalone game files.

4. **Validate**

   ```bash
   node scripts/add-game.mjs --check
   node scripts/inject-boot.mjs --check
   node --test tests/boot.test.mjs
   ```

   This checks schema, duplicate ids, file existence, current boot blocks in
   every game, and the boot loader's own test suite.

5. **Playtest**

   Serve the repo locally and open `play.html?id=<your-id>`, plus the card on
   `index.html`. Confirm search finds the title and the tag filter lists it.
   Watch the boot screen once; break something on purpose (e.g. `?noboot=1`
   skips pacing, blocking the CDN in devtools shows the failure report).

## Conventions

- **Ids are permanent.** Renaming an id breaks shared play links.
- **Keep tags tight.** Reuse an existing tag when one fits; new tags appear in
  the filter dropdown automatically.
- **Large files are fine** (some current games are multi-MB single files), but
  keep them playable — no server-side dependencies.
- The hub renders defensively: a malformed entry is skipped with a console
  warning rather than breaking the page. Still, run `--check` before pushing.
