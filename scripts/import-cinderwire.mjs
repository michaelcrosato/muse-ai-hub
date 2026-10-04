#!/usr/bin/env node
import { createHash } from "node:crypto";
// Package the source project's wasm-bindgen web output as one game HTML file.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = process.argv[2];
if (!webDir || process.argv.includes("--help")) {
	console.log(
		"Usage: node scripts/import-cinderwire.mjs <source-project/target/web>",
	);
	process.exit(webDir ? 0 : 1);
}

const wasm = readFileSync(join(resolve(webDir), "shardfall_bg.wasm"));
const glue = readFileSync(join(resolve(webDir), "shardfall.js"));
if (!wasm.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109]))) {
	throw new Error("shardfall_bg.wasm is not a WebAssembly binary");
}
const template = readFileSync(
	join(root, "scripts", "cinderwire-template.html"),
	"utf8",
);
const html = template
	.replace(
		"__CINDERWIRE_SHA256__",
		createHash("sha256").update(wasm).digest("hex"),
	)
	.replace(
		"__CINDERWIRE_MODULE__",
		`data:text/javascript;base64,${glue.toString("base64")}`,
	)
	.replace("__CINDERWIRE_WASM__", wasm.toString("base64"));
const output = join(root, "games", "cinderwire-20261004-musespark.html");
writeFileSync(output, html);
console.log(
	`Imported Cinderwire: ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)} MiB`,
);
console.log("Next: node scripts/inject-boot.mjs --inject --game cinderwire");
