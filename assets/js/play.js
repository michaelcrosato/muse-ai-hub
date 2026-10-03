/* MUSE AI HUB — single-game player page. */
"use strict";

const MANIFEST_URL = "games/games.json";
const GAMES_DIR = "games";

boot();

async function boot() {
  const id = new URLSearchParams(window.location.search).get("id");
  const titleEl = document.getElementById("player-title");
  const hintEl = document.getElementById("player-hint");
  const frame = document.getElementById("frame");
  const fullscreenBtn = document.getElementById("fullscreen");
  const newTabLink = document.getElementById("new-tab");

  if (!id) return fail(titleEl, frame, "No game selected.", "Pick one from the hub.");

  let game;
  try {
    game = await findGame(id);
  } catch (err) {
    console.error(err);
    return fail(titleEl, frame, "Hub data failed to load.", err.message);
  }
  if (!game) return fail(titleEl, frame, `Unknown game: "${id}".`, "It may have been renamed — back to the hub to browse.");

  document.title = `${game.title} — Muse AI Hub`;
  titleEl.textContent = game.title;
  if (game.controls) hintEl.textContent = game.controls;

  const fileUrl = `${GAMES_DIR}/${game.file}`;
  frame.title = game.title;
  frame.src = fileUrl;
  newTabLink.href = fileUrl;

  fullscreenBtn.addEventListener("click", () => {
    const wrap = document.getElementById("frame-wrap");
    if (document.fullscreenElement) document.exitFullscreen();
    else if (wrap.requestFullscreen) wrap.requestFullscreen();
  });
}

async function findGame(id) {
  const res = await fetch(MANIFEST_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load ${MANIFEST_URL} (HTTP ${res.status}).`);
  const data = await res.json();
  if (!data || !Array.isArray(data.games)) {
    throw new Error(`${MANIFEST_URL} is missing a "games" array.`);
  }
  return data.games.find((g) => g && g.id === id) || null;
}

function fail(titleEl, frame, heading, detail) {
  titleEl.textContent = heading;
  frame.remove();
  const wrap = document.getElementById("frame-wrap");
  const div = document.createElement("div");
  div.className = "empty";
  div.style.margin = "24px";
  const strong = document.createElement("strong");
  strong.textContent = heading;
  const p = document.createElement("p");
  p.textContent = detail;
  const back = document.createElement("p");
  const a = document.createElement("a");
  a.href = "index.html";
  a.textContent = "← Back to the hub";
  back.appendChild(a);
  div.append(strong, p, back);
  wrap.appendChild(div);
}
