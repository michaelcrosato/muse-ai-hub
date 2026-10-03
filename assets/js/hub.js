/* MUSE AI HUB — dashboard logic.
 * Data source: games/games.json (see CONTRIBUTING.md for the entry schema).
 * Games are plain .html files under games/; the hub never executes them
 * inline — they open in play.html inside an isolated iframe.
 */
"use strict";

const MANIFEST_URL = "games/games.json";
const GAMES_DIR = "games";

/* Deep solid cover colors. Keyed by hash so each game keeps its identity. */
const COVER_COLORS = [
  "#b33a00", "#0e6e5a", "#8f6b00", "#a12030",
  "#1f6f8b", "#3d5a1e", "#7a2d0e", "#5b4a00",
];

const state = {
  games: [],
  query: "",
  tag: "all",
  sort: "newest",
};

const els = {
  grid: document.getElementById("grid"),
  search: document.getElementById("search"),
  tagFilter: document.getElementById("tag-filter"),
  sort: document.getElementById("sort"),
  resultLine: document.getElementById("result-line"),
  statGames: document.getElementById("stat-games"),
  statTags: document.getElementById("stat-tags"),
  random: document.getElementById("random"),
  notice: document.getElementById("notice"),
};

boot();

async function boot() {
  wireToolbar();
  try {
    const games = await loadManifest(MANIFEST_URL);
    state.games = games;
    renderTagOptions();
    render();
  } catch (err) {
    showFatal(err);
  }
}

/* ---------- Data ---------- */

async function loadManifest(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status}).`);
  const data = await res.json();
  if (!data || !Array.isArray(data.games)) {
    throw new Error(`${url} is missing a "games" array.`);
  }
  const seen = new Set();
  const valid = [];
  for (const entry of data.games) {
    const problem = validateEntry(entry);
    if (problem) {
      console.warn(`Skipping game entry: ${problem}`, entry);
      continue;
    }
    if (seen.has(entry.id)) {
      console.warn(`Skipping duplicate game id: ${entry.id}`);
      continue;
    }
    seen.add(entry.id);
    valid.push(normalizeEntry(entry));
  }
  return valid;
}

function validateEntry(e) {
  if (!e || typeof e !== "object") return "entry is not an object";
  if (typeof e.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(e.id)) {
    return `bad id ${JSON.stringify(e.id)} (use lowercase letters, digits, dashes)`;
  }
  if (typeof e.title !== "string" || !e.title.trim()) return `bad title for ${e.id}`;
  if (typeof e.file !== "string" || !e.file.endsWith(".html")) {
    return `bad file for ${e.id} (must be an .html file under games/)`;
  }
  if (e.file.includes("/") || e.file.includes("\\") || e.file.includes("..")) {
    return `bad file for ${e.id} (no paths allowed, just a filename)`;
  }
  return null;
}

function normalizeEntry(e) {
  return {
    id: e.id,
    title: e.title.trim(),
    file: e.file,
    description: typeof e.description === "string" ? e.description : "",
    tags: Array.isArray(e.tags) ? e.tags.filter((t) => typeof t === "string") : [],
    added: typeof e.added === "string" ? e.added : "",
    controls: typeof e.controls === "string" ? e.controls : "",
    engine: typeof e.engine === "string" ? e.engine : "",
  };
}

/* ---------- Rendering ---------- */

function render() {
  const games = filteredGames();
  els.resultLine.textContent = resultText(games.length);
  els.statGames.textContent = String(state.games.length);
  els.statTags.textContent = String(allTags().length);

  els.grid.innerHTML = "";
  if (games.length === 0) {
    els.grid.appendChild(emptyCard());
    return;
  }
  for (const game of games) {
    els.grid.appendChild(gameCard(game));
  }
}

function filteredGames() {
  const q = state.query.trim().toLowerCase();
  let list = state.games.filter((g) => {
    if (state.tag !== "all" && !g.tags.includes(state.tag)) return false;
    if (!q) return true;
    const hay = `${g.title} ${g.description} ${g.tags.join(" ")}`.toLowerCase();
    return q.split(/\s+/).every((word) => hay.includes(word));
  });
  list = [...list];
  if (state.sort === "az") list.sort((a, b) => a.title.localeCompare(b.title));
  else if (state.sort === "oldest") list.sort((a, b) => a.added.localeCompare(b.added));
  else list.sort((a, b) => b.added.localeCompare(a.added) || a.title.localeCompare(b.title));
  return list;
}

function resultText(n) {
  if (state.games.length === 0) return "No games registered yet";
  const noun = n === 1 ? "game" : "games";
  let text = `Showing ${n} of ${state.games.length} ${noun}`;
  if (state.tag !== "all") text += ` · tagged "${state.tag}"`;
  if (state.query.trim()) text += ` · matching "${state.query.trim()}"`;
  return text;
}

function gameCard(g) {
  const article = document.createElement("article");
  article.className = "card";

  const playUrl = `play.html?id=${encodeURIComponent(g.id)}`;

  const coverLink = document.createElement("a");
  coverLink.className = "cover";
  coverLink.href = playUrl;
  coverLink.setAttribute("aria-label", `Play ${g.title}`);
  coverLink.innerHTML = coverArt(g) +
    `<span class="play-overlay" aria-hidden="true"><span class="play-badge">Play</span></span>`;

  const body = document.createElement("div");
  body.className = "card-body";

  const title = document.createElement("h2");
  title.className = "card-title";
  const titleLink = document.createElement("a");
  titleLink.href = playUrl;
  titleLink.textContent = g.title;
  title.appendChild(titleLink);

  body.appendChild(title);
  if (g.description) {
    const desc = document.createElement("p");
    desc.className = "card-desc";
    desc.textContent = g.description;
    body.appendChild(desc);
  }
  if (g.tags.length > 0) {
    const row = document.createElement("div");
    row.className = "tag-row";
    for (const tag of g.tags) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "tag";
      chip.textContent = tag;
      chip.addEventListener("click", () => {
        state.tag = tag;
        els.tagFilter.value = tag;
        render();
      });
      row.appendChild(chip);
    }
    body.appendChild(row);
  }

  const meta = document.createElement("div");
  meta.className = "card-meta";
  const left = document.createElement("span");
  left.textContent = g.added || "undated";
  const right = document.createElement("span");
  right.textContent = g.engine || "html";
  meta.append(left, right);
  body.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "card-actions";
  const play = document.createElement("a");
  play.className = "btn btn-primary";
  play.href = playUrl;
  play.textContent = "Play";
  const raw = document.createElement("a");
  raw.className = "btn btn-ghost";
  raw.href = `${GAMES_DIR}/${g.file}`;
  raw.target = "_blank";
  raw.rel = "noopener";
  raw.textContent = "Raw file";
  actions.append(play, raw);
  body.appendChild(actions);

  article.append(coverLink, body);
  return article;
}

function emptyCard() {
  const div = document.createElement("div");
  div.className = "empty";
  const strong = document.createElement("strong");
  strong.textContent = "No games match those filters.";
  const p = document.createElement("p");
  p.textContent = "Clear the search or pick a different tag.";
  div.append(strong, p);
  return div;
}

/* Deterministic generative cover: solid color + pinstripes + initials. */
function coverArt(g) {
  const bg = COVER_COLORS[hash(g.id) % COVER_COLORS.length];
  const initials = g.title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
  const safe = escapeHtml(initials || "▶");
  return `<svg viewBox="0 0 320 160" preserveAspectRatio="xMidYMid slice" aria-hidden="true">` +
    `<rect width="320" height="160" fill="${bg}"/>` +
    `<g stroke="rgba(0,0,0,0.25)" stroke-width="6">` +
    Array.from({ length: 9 }, (_, i) => {
      const x = i * 44 - 40;
      return `<line x1="${x}" y1="170" x2="${x + 90}" y2="-10"/>`;
    }).join("") +
    `</g>` +
    `<text x="24" y="122" font-family="Arial Narrow, Arial, sans-serif" font-weight="900" ` +
    `font-size="92" fill="rgba(255,255,255,0.92)" letter-spacing="2">${safe}</text>` +
    `</svg>`;
}

/* ---------- Toolbar ---------- */

function wireToolbar() {
  els.search.addEventListener("input", () => {
    state.query = els.search.value;
    render();
  });
  els.tagFilter.addEventListener("change", () => {
    state.tag = els.tagFilter.value;
    render();
  });
  els.sort.addEventListener("change", () => {
    state.sort = els.sort.value;
    render();
  });
  els.random.addEventListener("click", () => {
    const pool = filteredGames();
    if (pool.length === 0) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    window.location.href = `play.html?id=${encodeURIComponent(pick.id)}`;
  });
}

function renderTagOptions() {
  els.tagFilter.innerHTML = "";
  const all = document.createElement("option");
  all.value = "all";
  all.textContent = "All tags";
  els.tagFilter.appendChild(all);
  for (const tag of allTags()) {
    const opt = document.createElement("option");
    opt.value = tag;
    opt.textContent = tag;
    els.tagFilter.appendChild(opt);
  }
  els.tagFilter.value = state.tag;
}

function allTags() {
  const tags = new Set();
  for (const g of state.games) for (const t of g.tags) tags.add(t);
  return [...tags].sort();
}

/* ---------- Errors ---------- */

function showFatal(err) {
  console.error(err);
  els.resultLine.textContent = "Hub failed to load";
  els.notice.hidden = false;
  els.notice.textContent = `${err.message} Check that games/games.json exists and is valid JSON.`;
}

/* ---------- Helpers ---------- */

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
