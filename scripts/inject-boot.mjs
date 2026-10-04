#!/usr/bin/env node
/* Inject (or verify) the MUSE SPARK BIOS boot loader in game files.
 *
 * Inlines boot assets by default; boot.assets="shared" references the hub's
 * boot files instead. Adds a module gate. Re-runnable and versioned.
 *
 *   node scripts/inject-boot.mjs --inject [--game <id>]
 *   node scripts/inject-boot.mjs --check  [--game <id>]
 *   node scripts/inject-boot.mjs --remove [--game <id>]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(ROOT, "games", "games.json");
const GAMES_DIR = join(ROOT, "games");
const BOOT_JS_PATH = join(ROOT, "boot", "muse-boot.js");
const BOOT_CSS_PATH = join(ROOT, "boot", "muse-boot.css");
const RENDERERS = ["2d", "webgl", "webgl2", "webgpu"];
const RE_CSS = /<!--MUSE-BOOT-CSS-BEGIN v[^-]*-->[\s\S]*?<!--MUSE-BOOT-CSS-END-->/;
const RE_BODY = /<!--MUSE-BOOT-BODY-BEGIN v[^-]*-->[\s\S]*?<!--MUSE-BOOT-BODY-END-->/;
const RE_GATE = /\/\*MUSE-BOOT-GATE v[^*]*\*\/[^\n]*\n?/;
const RE_HEAD_CLOSE = /<\/head\s*>/i;
const RE_BODY_OPEN = /<body[^>]*>/i;
const RE_MODULE = /<script\s+type="module"[^>]*>/i;

const BOOT_JS = readFileSync(BOOT_JS_PATH, "utf8");
const BOOT_CSS = readFileSync(BOOT_CSS_PATH, "utf8");
const VERSION = (/var VERSION = '([^']+)'/.exec(BOOT_JS) || [])[1];
if (!VERSION) {
  console.error("Could not parse VERSION from boot/muse-boot.js");
  process.exit(1);
}
if (BOOT_JS.toLowerCase().includes("</script")) {
  console.error("boot/muse-boot.js contains a literal </script — it cannot be inlined safely.");
  process.exit(1);
}

const args = process.argv.slice(2);
const onlyGame = flagValue("--game");

if (args.includes("--help") || args.includes("-h") || args.length === 0) {
  console.log(`Usage:
  node scripts/inject-boot.mjs --inject [--game <id>]   inline boot loader into game file(s)
  node scripts/inject-boot.mjs --check  [--game <id>]   verify boot blocks are current
  node scripts/inject-boot.mjs --remove [--game <id>]   strip boot blocks from game file(s)`);
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
let games = manifest.games;
if (onlyGame) {
  games = games.filter((g) => g.id === onlyGame);
  if (games.length === 0) {
    console.error(`Unknown game id: ${onlyGame}`);
    process.exit(1);
  }
}

if (args.includes("--inject")) {
  for (const game of games) injectGame(game);
  console.log(`Injected boot v${VERSION} into ${games.length} game(s).`);
} else if (args.includes("--check")) {
  const errors = games.flatMap(checkGame);
  if (errors.length === 0) {
    console.log(`OK — ${games.length} game(s) carry boot v${VERSION}.`);
  } else {
    console.error(`FAILED — ${errors.length} problem(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
} else if (args.includes("--remove")) {
  for (const game of games) removeGame(game);
  console.log(`Removed boot blocks from ${games.length} game(s).`);
} else {
  console.error("Unknown command. Use --help.");
  process.exit(1);
}

function flagValue(name) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
}

function escAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function bootRenderer(game) {
  const r = game && game.boot && game.boot.renderer;
  return RENDERERS.includes(r) ? r : null;
}

function cssBlock(game) {
  return (
    `<!--MUSE-BOOT-CSS-BEGIN v${VERSION}-->\n` +
    (game.boot.assets === "shared"
      ? `<link rel="stylesheet" href="../boot/muse-boot.css">\n`
      : `<style>\n${BOOT_CSS}\n</style>\n`) +
    `<!--MUSE-BOOT-CSS-END-->`
  );
}

function bodyBlock(game) {
  const prefer = game.boot && game.boot.prefer && RENDERERS.includes(game.boot.prefer)
    ? ` data-boot-prefer="${game.boot.prefer}"`
    : "";
  return (
    `<!--MUSE-BOOT-BODY-BEGIN v${VERSION}-->\n` +
    `<div id="muse-boot" class="mb" data-boot-id="${escAttr(game.id)}" ` +
    `data-boot-title="${escAttr(game.title)}" data-boot-renderer="${bootRenderer(game)}"${prefer} ` +
    `data-boot-version="${VERSION}">\n` +
    `  <div class="mb-term">\n` +
    `    <div class="mb-head">MUSE SPARK BIOS v${VERSION}</div>\n` +
    `    <div class="mb-static">BOOTING: ${escAttr(game.title)}\nStarting... if this screen never changes, JavaScript failed to run. Screenshot this page and send it to the devs.</div>\n` +
    `    <div id="mb-log" class="mb-log"></div>\n` +
    `    <div class="mb-progress"><div id="mb-bar-fill" class="mb-bar-fill"></div></div>\n` +
    `    <div class="mb-status"><span id="mb-step" class="mb-cursor"></span><span id="mb-pct">0%</span></div>\n` +
    `    <div id="mb-fail" class="mb-fail" hidden>\n` +
    `      <div class="mb-fail-title" id="mb-fail-title"></div>\n` +
    `      <div id="mb-fail-detail"></div>\n` +
    `      <pre class="mb-report" id="mb-report"></pre>\n` +
    `      <div class="mb-btn-row"><button class="mb-btn" id="mb-copy" type="button">COPY REPORT</button><button class="mb-btn mb-btn-ghost" id="mb-retry" type="button">RETRY</button></div>\n` +
    `    </div>\n` +
    `  </div>\n` +
    `</div>\n` +
    (game.boot.assets === "shared"
      ? `<script src="../boot/muse-boot.js"></script>\n`
      : `<script>\n${BOOT_JS}\n</script>\n`) +
    `<!--MUSE-BOOT-BODY-END-->`
  );
}

function gateLine() {
  return `/*MUSE-BOOT-GATE v${VERSION}*/ await window.MuseBoot.gameReady();\n`;
}

function injectGame(game) {
  const renderer = bootRenderer(game);
  if (!renderer) {
    console.error(`Error: game "${game.id}" needs games.json boot.renderer (${RENDERERS.join("/")}).`);
    process.exit(1);
  }
  const path = join(GAMES_DIR, game.file);
  let html = readFileSync(path, "utf8");
  const origLen = html.length;

  if (RE_CSS.test(html)) html = html.replace(RE_CSS, () => cssBlock(game));
  else if (RE_HEAD_CLOSE.test(html)) html = html.replace(RE_HEAD_CLOSE, () => cssBlock(game) + "\n</head>");
  else fail(game, "no </head> found");

  if (RE_BODY.test(html)) html = html.replace(RE_BODY, () => bodyBlock(game));
  else if (RE_BODY_OPEN.test(html)) html = html.replace(RE_BODY_OPEN, (m) => m + "\n" + bodyBlock(game));
  else fail(game, "no <body> found");

  if (RE_GATE.test(html)) html = html.replace(RE_GATE, gateLine());
  else if (RE_MODULE.test(html)) html = html.replace(RE_MODULE, (m) => m + "\n" + gateLine());
  else fail(game, "no <script type=\"module\"> found");

  writeFileSync(path, html);
  console.log(`  ${game.id}: ${origLen} -> ${html.length} bytes`);
}

function checkGame(game) {
  const errors = [];
  const renderer = bootRenderer(game);
  if (!renderer) errors.push(`"${game.id}": games.json boot.renderer missing/invalid`);
  let html;
  try {
    html = readFileSync(join(GAMES_DIR, game.file), "utf8");
  } catch {
    return [`"${game.id}": file not found: games/${game.file}`];
  }
  const want = `v${VERSION}`;
  const has = (re) => {
    const m = re.exec(html);
    return m ? m[0].includes(want) : false;
  };
  if (!has(/<!--MUSE-BOOT-CSS-BEGIN v[^-]*-->[\s\S]*?<!--MUSE-BOOT-CSS-END-->/)) {
    errors.push(`"${game.id}": boot CSS block missing or stale (want ${want})`);
  }
  if (!has(/<!--MUSE-BOOT-BODY-BEGIN v[^-]*-->[\s\S]*?<!--MUSE-BOOT-BODY-END-->/)) {
    errors.push(`"${game.id}": boot body block missing or stale (want ${want})`);
  }
  if (!has(/\/\*MUSE-BOOT-GATE v[^*]*\*\//)) {
    errors.push(`"${game.id}": module gate line missing or stale (want ${want})`);
  }
  if (game.boot?.assets === "shared") {
    if (!RE_CSS.exec(html)?.[0].includes('<link rel="stylesheet" href="../boot/muse-boot.css">')) {
      errors.push(`"${game.id}": shared boot CSS reference missing`);
    }
    if (!RE_BODY.exec(html)?.[0].includes('<script src="../boot/muse-boot.js"></script>')) {
      errors.push(`"${game.id}": shared boot JS reference missing`);
    }
  }
  return errors;
}

function removeGame(game) {
  const path = join(GAMES_DIR, game.file);
  let html = readFileSync(path, "utf8");
  html = html.replace(RE_CSS, "").replace(RE_BODY, "").replace(RE_GATE, "");
  writeFileSync(path, html);
}

function fail(game, why) {
  console.error(`Error: game "${game.id}": ${why}.`);
  process.exit(1);
}
