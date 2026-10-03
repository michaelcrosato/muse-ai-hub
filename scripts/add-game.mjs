#!/usr/bin/env node
/* Manifest helper for the Muse AI Hub.
 *
 *   node scripts/add-game.mjs --check              validate games/games.json
 *   node scripts/add-game.mjs --add <file>         register a game (see --help)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(ROOT, "games", "games.json");
const GAMES_DIR = join(ROOT, "games");
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h") || args.length === 0) {
  console.log(`Usage:
  node scripts/add-game.mjs --check
  node scripts/add-game.mjs --add <path-to-html> --title "Title" [options]

Options for --add:
  --id <slug>            defaults to filename slug
  --renderer <name>      2d, webgl, webgl2 (default), or webgpu
  --title <title>        required
  --description <text>   card blurb
  --tags <a,b,c>         comma-separated lowercase tags
  --controls <text>      e.g. "Arrows / WASD + Space"
  --engine <name>        defaults to "Muse Spark"
  --added <YYYY-MM-DD>   defaults to today`);
  process.exit(0);
}

if (args.includes("--check")) {
  const errors = validate(loadManifest());
  if (errors.length === 0) {
    const n = loadManifest().games.length;
    console.log(`OK — ${n} game(s), manifest valid.`);
  } else {
    console.error(`FAILED — ${errors.length} problem(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
} else if (args.includes("--add")) {
  addGame(parseFlags(args));
} else {
  console.error("Unknown command. Use --help.");
  process.exit(1);
}

function loadManifest() {
  return JSON.parse(readFileSync(MANIFEST, "utf8"));
}

function validate(manifest) {
  const errors = [];
  if (!manifest || !Array.isArray(manifest.games)) {
    return ['Manifest is missing a "games" array.'];
  }
  const seen = new Set();
  for (const g of manifest.games) {
    const where = g && g.id ? `"${g.id}"` : JSON.stringify(g);
    if (!g || typeof g !== "object") { errors.push(`${where}: not an object`); continue; }
    if (typeof g.id !== "string" || !ID_RE.test(g.id)) {
      errors.push(`${where}: bad id (lowercase letters, digits, dashes)`);
    } else if (seen.has(g.id)) {
      errors.push(`"${g.id}": duplicate id`);
    } else {
      seen.add(g.id);
    }
    if (typeof g.title !== "string" || !g.title.trim()) errors.push(`${where}: missing title`);
    if (typeof g.file !== "string" || !g.file.endsWith(".html") || /[/\\]/.test(g.file) || g.file.includes("..")) {
      errors.push(`${where}: bad file (bare .html filename only)`);
    } else if (!existsSync(join(GAMES_DIR, g.file))) {
      errors.push(`"${g.id}": file not found: games/${g.file}`);
    }
    if (g.tags !== undefined && (!Array.isArray(g.tags) || g.tags.some((t) => typeof t !== "string"))) {
      errors.push(`"${g.id}": tags must be an array of strings`);
    }
    if (g.added !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(g.added)) {
      errors.push(`"${g.id}": added must be YYYY-MM-DD`);
    }
    if (!g.boot || !["2d", "webgl", "webgl2", "webgpu"].includes(g.boot.renderer)) {
      errors.push(`"${g.id}": boot.renderer must be one of 2d, webgl, webgl2, webgpu`);
    }
    if (g.boot && g.boot.prefer !== undefined && !["2d", "webgl", "webgl2", "webgpu"].includes(g.boot.prefer)) {
      errors.push(`"${g.id}": boot.prefer must be one of 2d, webgl, webgl2, webgpu`);
    }
  }
  return errors;
}

function parseFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      out[key] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    }
  }
  return out;
}

function addGame(flags) {
  const file = typeof flags.add === "string" ? flags.add : null;
  if (!file || !file.endsWith(".html")) {
    console.error("Error: --add needs a path to an .html game file.");
    process.exit(1);
  }
  if (typeof flags.title !== "string" || !flags.title.trim()) {
    console.error("Error: --title is required.");
    process.exit(1);
  }
  const name = basename(file);
  if (!existsSync(join(GAMES_DIR, name))) {
    console.error(`Error: ${name} is not in games/ yet — copy it there first.`);
    process.exit(1);
  }
  const manifest = loadManifest();
  const id = typeof flags.id === "string"
    ? flags.id
    : name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/\.html$/, "") || "game";
  if (!ID_RE.test(id)) {
    console.error(`Error: bad id "${id}" (lowercase letters, digits, dashes).`);
    process.exit(1);
  }
  if (manifest.games.some((g) => g.id === id)) {
    console.error(`Error: id "${id}" already exists.`);
    process.exit(1);
  }
  const renderer = typeof flags.renderer === "string" ? flags.renderer : "webgl2";
  if (!["2d", "webgl", "webgl2", "webgpu"].includes(renderer)) {
    console.error(`Error: bad --renderer "${renderer}" (2d, webgl, webgl2, webgpu).`);
    process.exit(1);
  }
  const prefer = typeof flags.prefer === "string" ? flags.prefer : null;
  if (prefer && !["2d", "webgl", "webgl2", "webgpu"].includes(prefer)) {
    console.error(`Error: bad --prefer "${prefer}" (2d, webgl, webgl2, webgpu).`);
    process.exit(1);
  }
  manifest.games.push({
    id,
    title: flags.title.trim(),
    file: name,
    boot: prefer ? { renderer, prefer } : { renderer },
    description: typeof flags.description === "string" ? flags.description : "",
    tags: typeof flags.tags === "string"
      ? flags.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)
      : [],
    added: typeof flags.added === "string" ? flags.added : new Date().toISOString().slice(0, 10),
    controls: typeof flags.controls === "string" ? flags.controls : "",
    engine: typeof flags.engine === "string" ? flags.engine : "Muse Spark",
  });
  manifest.updated = new Date().toISOString().slice(0, 10);
  const errors = validate(manifest);
  if (errors.length > 0) {
    console.error("Refusing to write an invalid manifest:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Added "${id}". Playtest: play.html?id=${id}`);
}
