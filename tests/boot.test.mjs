/* Maintained tests for the MUSE SPARK BIOS boot loader.
 * Runs boot/muse-boot.js inside node:vm with stub DOM globals — no browser,
 * no framework. Run:  node --test tests/
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BOOT_SRC = readFileSync(join(ROOT, "boot", "muse-boot.js"), "utf8");

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function makeSandbox(config = {}) {
  const cfg = {
    webgl: true, webgl2: true, webgpu: true, canvas2d: true, modules: true,
    gpuLabel: "stub-adapter", search: "?noboot=1", need: "webgl2", prefer: null,
    withPromise: true, protocol: "https:",
    ...config,
  };
  const listeners = {};

  function makeEl(tag) {
    const el = {
      tagName: String(tag).toUpperCase(),
      children: [],
      style: {},
      className: "",
      textContent: "",
      innerHTML: "",
      hidden: false,
      attributes: {},
      noModule: true,
      getAttribute(k) { return this.attributes[k] ?? null; },
      setAttribute(k, v) { this.attributes[k] = String(v); },
      appendChild(c) { this.children.push(c); return c; },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); },
      addEventListener() {},
      getElementsByClassName() { return []; },
      select() {},
      click() {},
    };
    if (tag === "script" && !cfg.modules) delete el.noModule;
    if (tag === "canvas") {
      el.getContext = (kind) => {
        const ok = (kind === "2d" && cfg.canvas2d) ||
          (kind === "webgl" && cfg.webgl) ||
          (kind === "experimental-webgl" && cfg.webgl) ||
          (kind === "webgl2" && cfg.webgl2);
        if (!ok) return null;
        return { getExtension: () => null, getParameter: () => "stub-gpu" };
      };
    }
    return el;
  }

  const byId = {};
  for (const id of ["mb-log", "mb-bar-fill", "mb-pct", "mb-step", "mb-fail-title",
    "mb-fail-detail", "mb-report", "mb-copy", "mb-retry"]) {
    byId[id] = makeEl("div");
  }
  const failBox = makeEl("div");
  failBox.hidden = true;
  byId["mb-fail"] = failBox;
  const root = makeEl("div");
  root.attributes = {
    "data-boot-id": "test-game",
    "data-boot-title": "Test Game",
    "data-boot-renderer": cfg.need,
    "data-boot-version": "test",
  };
  if (cfg.prefer) root.attributes["data-boot-prefer"] = cfg.prefer;
  const statik = makeEl("div");
  root.getElementsByClassName = () => [statik];
  byId["muse-boot"] = root;

  const store = {};
  const sandbox = {
    console,
    setTimeout, clearTimeout, Date, Object, String, JSON, decodeURIComponent,
    devicePixelRatio: 2,
    screen: { width: 1920, height: 1080 },
    location: { search: cfg.search, protocol: cfg.protocol, reload() {} },
    navigator: {
      userAgent: "test-agent/1.0",
      platform: "TestOS",
      language: "en-US",
      hardwareConcurrency: 8,
      deviceMemory: 8,
      onLine: true,
      maxTouchPoints: 0,
    },
    document: {
      getElementById: (id) => byId[id] || null,
      createElement: (tag) => makeEl(tag),
      documentElement: { requestFullscreen() {} },
      body: { appendChild() {}, removeChild() {} },
      execCommand: () => true,
      addEventListener() {},
    },
    AudioContext: function () {},
    Worker: function () {},
    WebAssembly: {},
    localStorage: {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    addEventListener: (evt, fn) => {
      (listeners[evt] = listeners[evt] || []).push(fn);
    },
    emit: (evt, data) => {
      for (const fn of listeners[evt] || []) fn(data);
    },
    __listeners: listeners,
    __byId: byId,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  if (cfg.withPromise) sandbox.Promise = Promise;
  if (cfg.webgpu) {
    sandbox.navigator.gpu = {
      requestAdapter: async () => ({ label: cfg.gpuLabel }),
    };
  }
  vm.createContext(sandbox);
  if (!cfg.withPromise) vm.runInContext("Promise = undefined;", sandbox);
  vm.runInContext(BOOT_SRC, sandbox, { filename: "muse-boot.js" });
  return sandbox;
}

describe("muse-boot source", () => {
  it("contains no literal </script (inline-safe)", () => {
    assert.ok(!BOOT_SRC.toLowerCase().includes("</script"));
  });

  it("is ES5-only (no const/let/class/arrow/template literals)", () => {
    const stripped = BOOT_SRC
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1")
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""');
    assert.ok(!/\b(const|let|class|yield)\b/.test(stripped), "ES6+ keyword found");
    assert.ok(!/=>/.test(stripped), "arrow function found");
    assert.ok(!/`/.test(stripped), "template literal found");
  });
});

describe("muse-boot happy path", () => {
  it("boots, resolves gameReady, reaches 100% with step codes", async () => {
    const sb = makeSandbox({ search: "" });
    const api = await withTimeout(sb.MuseBoot.gameReady(), 8000, "gameReady");
    assert.equal(typeof api.version, "string");
    assert.equal(sb.MuseBoot.status(), "ready");
    assert.equal(sb.__byId["mb-pct"].textContent, "100%");
    const codes = sb.MuseBoot.steps().map((s) => s.code);
    for (const want of ["MB-001", "MB-010", "MB-020", "MB-030", "MB-040", "MB-050"]) {
      assert.ok(codes.includes(want), `missing step ${want}`);
    }
    assert.ok(sb.MuseBoot.steps().every((s) => s.ok));
  });

  it("report contains game, status, diagnostics, and renderer lines", async () => {
    const sb = makeSandbox();
    await withTimeout(sb.MuseBoot.gameReady(), 5000, "gameReady");
    const report = sb.MuseBoot.report();
    assert.ok(report.includes("MUSE SPARK BIOS BOOT REPORT"));
    assert.ok(report.includes("Test Game [test-game]"));
    assert.ok(report.includes("status: READY"));
    assert.ok(report.includes("webgl2: yes"));
    assert.ok(report.includes("webgpu: yes"));
    assert.ok(report.includes("need: webgl2"));
    assert.equal(typeof sb.__MUSE_BOOT_REPORT__, "string");
  });

  it("boots fast with ?noboot=1", async () => {
    const sb = makeSandbox({ search: "?noboot=1" });
    const t0 = Date.now();
    await withTimeout(sb.MuseBoot.gameReady(), 5000, "gameReady");
    assert.ok(Date.now() - t0 < 2500, "noboot should skip pacing delays");
    assert.equal(sb.MuseBoot.status(), "ready");
  });

  it("works without native Promise (polyfill path)", async () => {
    const sb = makeSandbox({ withPromise: false });
    assert.equal(typeof sb.Promise, "function", "polyfill should install");
    await withTimeout(sb.MuseBoot.gameReady(), 5000, "gameReady");
    assert.equal(sb.MuseBoot.status(), "ready");
  });
});

describe("muse-boot failure paths", () => {
  it("fails MB-E201 when the required renderer is missing", async () => {
    const sb = makeSandbox({ webgl2: false, webgl: false, webgpu: false, need: "webgl2" });
    let fail = null;
    sb.MuseBoot.onFail((f) => { fail = f; });
    let settled = false;
    sb.MuseBoot.gameReady().then(() => { settled = true; });
    await withTimeout(
      (async () => {
        for (let i = 0; i < 100 && sb.MuseBoot.status() === "booting"; i++) {
          await new Promise((r) => setTimeout(r, 50));
        }
      })(),
      5000,
      "boot to fail"
    );
    assert.equal(sb.MuseBoot.status(), "failed");
    assert.equal(fail && fail.code, "MB-E201");
    assert.equal(sb.__byId["mb-fail"].hidden, false);
    assert.ok(sb.MuseBoot.report().includes("MB-E201"));
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(settled, false, "gameReady must stay pending after failure");
  });

  it("fails MB-E202 when ES modules are unsupported", async () => {
    const sb = makeSandbox({ modules: false });
    await withTimeout(
      (async () => {
        for (let i = 0; i < 100 && sb.MuseBoot.status() === "booting"; i++) {
          await new Promise((r) => setTimeout(r, 50));
        }
      })(),
      5000,
      "boot to fail"
    );
    assert.equal(sb.MuseBoot.status(), "failed");
    assert.ok(sb.MuseBoot.report().includes("MB-E202"));
  });

  it("fails MB-E302 when a script resource fails during boot", async () => {
    const sb = makeSandbox({ search: "" });
    sb.emit("error", { target: { src: "https://cdn.example/three.module.js" } });
    await withTimeout(
      (async () => {
        for (let i = 0; i < 100 && sb.MuseBoot.status() === "booting"; i++) {
          await new Promise((r) => setTimeout(r, 50));
        }
      })(),
      5000,
      "boot to fail"
    );
    assert.equal(sb.MuseBoot.status(), "failed");
    assert.ok(sb.MuseBoot.report().includes("MB-E302"));
  });

  it("fails MB-E501 when the game crashes right after boot", async () => {
    const sb = makeSandbox();
    await withTimeout(sb.MuseBoot.gameReady(), 5000, "gameReady");
    assert.equal(sb.MuseBoot.status(), "ready");
    sb.emit("error", { message: "boom", filename: "game.js", lineno: 42 });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(sb.MuseBoot.status(), "failed");
    assert.ok(sb.MuseBoot.report().includes("MB-E501"));
    assert.ok(sb.MuseBoot.report().includes("boom"));
  });

  it("requires webgpu when configured, passes when present", async () => {
    const sb = makeSandbox({ need: "webgpu", webgl2: false, webgl: false });
    await withTimeout(sb.MuseBoot.gameReady(), 5000, "gameReady");
    assert.equal(sb.MuseBoot.status(), "ready");
    assert.equal(sb.MuseBoot.diag().webgpu, true);
  });
});
