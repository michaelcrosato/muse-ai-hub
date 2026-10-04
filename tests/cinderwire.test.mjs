import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
	readFileSync(join(root, "games/games.json"), "utf8"),
);
const game = manifest.games.find((entry) => entry.id === "cinderwire");
const html = readFileSync(join(root, "games", game.file), "utf8");
const encoded = /<script id="cinderwire-wasm"[^>]*>([^<]+)<\/script>/.exec(
	html,
)?.[1];
const wasm = Buffer.from(encoded || "", "base64");

test("Cinderwire embeds a complete, valid WebAssembly game", () => {
	assert.ok(
		WebAssembly.validate(wasm),
		"embedded game compiles as WebAssembly",
	);
	const expected =
		/name="cinderwire-wasm-sha256" content="([a-f0-9]{64})"/.exec(html)?.[1];
	assert.equal(
		createHash("sha256").update(wasm).digest("hex"),
		expected,
		"binary matches its checksum",
	);
	assert.ok(
		wasm.includes(Buffer.from('name = "Cinderwire: The Helix Ledger"')),
		"mission 1 data embedded",
	);
	assert.ok(
		wasm.includes(Buffer.from('name = "Cinderwire: The Ash Exchange"')),
		"mission 2 data embedded",
	);
});

test("Cinderwire embeds its glue and references shared hub dependencies", () => {
	assert.equal(game.boot.renderer, "webgpu");
	assert.equal(game.boot.assets, "shared");
	assert.match(
		html,
		/id="cinderwire-module"[^>]*>data:text\/javascript;base64,/,
	);
	assert.deepEqual(
		[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(
			(match) => match[1],
		),
		["../boot/muse-boot.js"],
	);
	assert.deepEqual(
		[...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map(
			(match) => match[1],
		),
		["../boot/muse-boot.css"],
	);
	assert.ok(!html.includes("__CINDERWIRE_"), "all payload placeholders filled");
});
