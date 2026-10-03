/* MUSE SPARK BIOS — standardized game boot loader.
 *
 * Runs before any game code: paints a retro boot screen, checks the
 * environment, probes renderers (2d / webgl / webgl2 / webgpu), shows progress
 * with step codes, then hands off to the game. On failure it shows a
 * screenshot-friendly report instead of starting the game.
 *
 * Compatibility: plain ES5, no dependencies. Uses only a tiny DOM surface
 * (getElementById, createElement, appendChild, textContent, addEventListener,
 * canvas getContext) so it runs even on very old browsers — where it will
 * typically report exactly WHY the game cannot start.
 *
 * Game integration (one line at the top of the game's module script):
 *   await window.MuseBoot.gameReady();
 * The promise resolves when boot passes. It stays pending forever when boot
 * fails, so the game never starts behind the failure screen.
 */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';
  var BOOT_MIN_MS = 1400;
  var STEP_DELAY_MS = 170;
  var CRASH_WATCH_MS = 20000;
  var WEBGPU_TIMEOUT_MS = 3000;

  /* Minimal Promise polyfill (only installed when missing). */
  if (typeof global.Promise === 'undefined') {
    global.Promise = function (executor) {
      var callbacks = [];
      var settled = false;
      var value;
      function resolve(v) {
        if (settled) return;
        settled = true;
        value = v;
        var copy = callbacks.slice();
        callbacks = [];
        for (var i = 0; i < copy.length; i++) {
          (function (cb) {
            global.setTimeout(function () { cb(value); }, 0);
          })(copy[i]);
        }
      }
      this.then = function (cb) {
        if (settled) {
          global.setTimeout(function () { cb(value); }, 0);
        } else {
          callbacks.push(cb);
        }
        return this;
      };
      try {
        executor(resolve, function () { resolve(undefined); });
      } catch (e) {
        resolve(undefined);
      }
    };
  }

  var DOCUMENT = global.document;
  var NAVIGATOR = global.navigator || {};
  var LOCATION = global.location || { search: '', protocol: 'unknown:' };
  var SCREEN = global.screen || {};

  function now() { return new Date().getTime(); }

  function $(id) {
    try {
      return DOCUMENT.getElementById(id);
    } catch (e) {
      return null;
    }
  }

  function on(target, evt, fn, capture) {
    if (target && target.addEventListener) {
      try {
        target.addEventListener(evt, fn, !!capture);
      } catch (e) { /* ignore */ }
    } else if (target && target.attachEvent) {
      try {
        target.attachEvent('on' + evt, fn);
      } catch (e) { /* ignore */ }
    }
  }

  function logConsole(msg) {
    try {
      if (global.console && global.console.log) global.console.log('[muse-boot] ' + msg);
    } catch (e) { /* ignore */ }
  }

  function parseQuery(search) {
    var out = {};
    var q = String(search || '').replace(/^\?/, '');
    if (!q) return out;
    var parts = q.split('&');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split('=');
      var k = '';
      try {
        k = decodeURIComponent(kv[0]);
      } catch (e) {
        k = kv[0];
      }
      out[k] = kv.length > 1 ? kv[1] : '1';
    }
    return out;
  }

  var FLAVOR = [
    'Reticulating structural beams...',
    'Warming up the wrecking ball...',
    'Bribing the building inspector...',
    'Polishing the convoy hubcaps...',
    'Teaching pixels to explode...',
    'Inflating the airbags...',
    'Sharpening the bulldozer...',
    'Convincing gravity to cooperate...'
  ];

  var state = {
    status: 'booting',
    t0: now(),
    lines: [],
    steps: [],
    diag: {},
    probes: {},
    warnings: [],
    fail: null,
    readyQueue: [],
    failHooks: [],
    need: 'webgl2',
    prefer: null,
    gameId: 'unknown',
    gameTitle: 'Muse Spark Game',
    noboot: false,
    flavorIdx: 0,
    dom: null,
    crashTimer: null,
    bootedAt: null
  };

  /* ---------------- DOM ---------------- */

  function ensureDom() {
    if (state.dom) return state.dom;
    var root = $('muse-boot');
    if (!root) return null;
    state.dom = {
      root: root,
      statik: root.getElementsByClassName ? root.getElementsByClassName('mb-static')[0] : null,
      log: $('mb-log'),
      fill: $('mb-bar-fill'),
      pct: $('mb-pct'),
      step: $('mb-step'),
      fail: $('mb-fail'),
      failTitle: $('mb-fail-title'),
      failDetail: $('mb-fail-detail'),
      report: $('mb-report'),
      copy: $('mb-copy'),
      retry: $('mb-retry')
    };
    if (state.dom.copy) {
      on(state.dom.copy, 'click', function () { copyReport(); });
    }
    if (state.dom.retry) {
      on(state.dom.retry, 'click', function () {
        try {
          LOCATION.reload();
        } catch (e) { /* ignore */ }
      });
    }
    flushLines();
    return state.dom;
  }

  function addLine(cls, text) {
    state.lines.push({ cls: cls, text: text });
    logConsole(text);
    var dom = ensureDom();
    if (!dom || !dom.log) return;
    if (dom.statik) dom.statik.style.display = 'none';
    var div = null;
    try {
      div = DOCUMENT.createElement('div');
      div.className = cls;
      div.textContent = text;
      dom.log.appendChild(div);
    } catch (e) { /* ignore */ }
  }

  function flushLines() {
    var dom = state.dom;
    if (!dom || !dom.log) return;
    if (dom.statik && state.lines.length > 0) dom.statik.style.display = 'none';
    try {
      dom.log.innerHTML = '';
    } catch (e) { /* ignore */ }
    for (var i = 0; i < state.lines.length; i++) {
      try {
        var div = DOCUMENT.createElement('div');
        div.className = state.lines[i].cls;
        div.textContent = state.lines[i].text;
        dom.log.appendChild(div);
      } catch (e) { /* ignore */ }
    }
  }

  function setProgress(pct, stepText) {
    var dom = ensureDom();
    if (!dom) return;
    try {
      if (dom.fill) dom.fill.style.width = String(Math.max(0, Math.min(100, pct))) + '%';
      if (dom.pct) dom.pct.textContent = String(Math.round(pct)) + '%';
      if (dom.step) dom.step.textContent = stepText || '';
    } catch (e) { /* ignore */ }
  }

  function show() {
    var dom = ensureDom();
    if (dom && dom.root) {
      try {
        dom.root.hidden = false;
        dom.root.style.display = '';
      } catch (e) { /* ignore */ }
    }
  }

  function hide() {
    var dom = ensureDom();
    if (dom && dom.root) {
      try {
        dom.root.hidden = true;
        dom.root.style.display = 'none';
      } catch (e) { /* ignore */ }
    }
  }

  /* ---------------- Probes ---------------- */

  function probeContext2d() {
    try {
      var c = DOCUMENT.createElement('canvas');
      return !!(c && c.getContext && c.getContext('2d'));
    } catch (e) {
      return false;
    }
  }

  function probeWebGL(kind) {
    try {
      var c = DOCUMENT.createElement('canvas');
      if (!c || !c.getContext) return { ok: false };
      var gl = null;
      if (kind === 'webgl2') {
        gl = c.getContext('webgl2');
      } else {
        gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      }
      if (!gl) return { ok: false };
      var out = { ok: true };
      try {
        var ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) out.renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
      } catch (e2) { /* blocked or unavailable */ }
      try {
        var lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      } catch (e3) { /* ignore */ }
      return out;
    } catch (e) {
      return { ok: false };
    }
  }

  function probeWebGPU(cb) {
    var done = false;
    function fin(res) {
      if (done) return;
      done = true;
      cb(res);
    }
    try {
      var gpu = NAVIGATOR.gpu;
      if (!gpu || !gpu.requestAdapter) {
        fin({ ok: false, reason: 'navigator.gpu missing' });
        return;
      }
      global.setTimeout(function () {
        fin({ ok: false, reason: 'adapter request timed out' });
      }, WEBGPU_TIMEOUT_MS);
      gpu.requestAdapter().then(function (adapter) {
        if (!adapter) {
          fin({ ok: false, reason: 'no adapter returned' });
          return;
        }
        var label = '';
        try {
          if (adapter.info) label = adapter.info.device || adapter.info.description || '';
          if (!label && adapter.label) label = adapter.label;
        } catch (e) { /* ignore */ }
        fin({ ok: true, adapter: label || 'adapter ok' });
      }, function (err) {
        var msg = err;
        try {
          msg = (err && err.message) || String(err);
        } catch (e) { /* ignore */ }
        fin({ ok: false, reason: String(msg) });
      });
    } catch (e) {
      var msg2 = e;
      try {
        msg2 = (e && e.message) || String(e);
      } catch (e2) { /* ignore */ }
      fin({ ok: false, reason: String(msg2) });
    }
  }

  function probeModules() {
    try {
      var s = DOCUMENT.createElement('script');
      return ('noModule' in s);
    } catch (e) {
      return false;
    }
  }

  function probeStorage() {
    try {
      var ls = global.localStorage;
      if (!ls) return false;
      var key = '__muse_boot_test__';
      ls.setItem(key, '1');
      ls.removeItem(key);
      return true;
    } catch (e) {
      return false;
    }
  }

  function collectEnv() {
    var d = state.diag;
    d.bootVersion = VERSION;
    try {
      d.ua = String(NAVIGATOR.userAgent || 'n/a');
    } catch (e) {
      d.ua = 'n/a';
    }
    try {
      d.platform = String(NAVIGATOR.platform || NAVIGATOR.userAgentData && NAVIGATOR.userAgentData.platform || 'n/a');
    } catch (e) {
      d.platform = 'n/a';
    }
    try {
      d.language = String(NAVIGATOR.language || 'n/a');
    } catch (e) {
      d.language = 'n/a';
    }
    d.cores = NAVIGATOR.hardwareConcurrency || 'n/a';
    d.memoryGB = NAVIGATOR.deviceMemory || 'n/a';
    try {
      d.screen = (SCREEN.width || '?') + 'x' + (SCREEN.height || '?');
    } catch (e) {
      d.screen = 'n/a';
    }
    d.dpr = global.devicePixelRatio || 'n/a';
    d.touch = (typeof NAVIGATOR.maxTouchPoints === 'number') ? NAVIGATOR.maxTouchPoints : 'n/a';
    try {
      d.protocol = String(LOCATION.protocol || 'n/a');
    } catch (e) {
      d.protocol = 'n/a';
    }
    d.online = (typeof NAVIGATOR.onLine === 'boolean') ? (NAVIGATOR.onLine ? 'yes' : 'no') : 'n/a';
    try {
      d.time = new Date().toISOString();
    } catch (e) {
      d.time = String(now());
    }
  }

  function collectFeatures() {
    var d = state.diag;
    d.modules = probeModules();
    d.canvas2d = probeContext2d();
    var gl1 = probeWebGL('webgl');
    var gl2 = probeWebGL('webgl2');
    state.probes.canvas2d = d.canvas2d;
    state.probes.webgl = !!gl1.ok;
    state.probes.webgl2 = !!gl2.ok;
    d.webgl = !!gl1.ok;
    d.webgl2 = !!gl2.ok;
    d.gpu = gl2.renderer || gl1.renderer || 'n/a';
    try {
      d.audio = !!(global.AudioContext || global.webkitAudioContext);
    } catch (e) {
      d.audio = false;
    }
    d.storage = probeStorage();
    try {
      d.workers = (typeof global.Worker !== 'undefined');
    } catch (e) {
      d.workers = false;
    }
    try {
      d.wasm = (typeof global.WebAssembly === 'object');
    } catch (e) {
      d.wasm = false;
    }
    try {
      var de = DOCUMENT.documentElement;
      d.fullscreen = !!(de && (de.requestFullscreen || de.webkitRequestFullscreen || de.msRequestFullscreen));
    } catch (e) {
      d.fullscreen = false;
    }
  }

  /* ---------------- Steps ---------------- */

  function stepLine(code, name, ok, detail) {
    var dots = ' .............................. ';
    var label = '[' + code + '] ' + name;
    var status = ok ? 'OK' : 'FAIL';
    var line = label + dots.slice(0, Math.max(4, 34 - label.length)) + status;
    if (detail) line += ' — ' + detail;
    addLine(ok ? 'mb-line-ok' : 'mb-line-fail', line);
    state.steps.push({ code: code, name: name, ok: !!ok, detail: detail || '' });
  }

  function flavorLine() {
    var q = FLAVOR[state.flavorIdx % FLAVOR.length];
    state.flavorIdx += 1;
    addLine('mb-line-dim', '  ' + q);
  }

  function recordWarning(text) {
    state.warnings.push(text);
    addLine('mb-line-dim', '  ! ' + text);
  }

  var STEP_DEFS = [
    { code: 'MB-001', name: 'POWER-ON' },
    { code: 'MB-010', name: 'ENV SCAN' },
    { code: 'MB-020', name: 'FEATURE SCAN' },
    { code: 'MB-030', name: 'RENDERER PROBE' },
    { code: 'MB-040', name: 'GATE CHECK' },
    { code: 'MB-050', name: 'HANDOFF' }
  ];

  function runSteps() {
    var delay = state.noboot ? 0 : STEP_DELAY_MS;
    var i = 0;

    function header() {
      addLine('mb-line-info', 'MUSE SPARK BIOS v' + VERSION);
      addLine('mb-line-info', 'BOOTING: ' + state.gameTitle + ' [' + state.gameId + ']');
      addLine('mb-line-dim', '----------------------------------------');
    }

    function next() {
      if (state.status !== 'booting') return;
      if (i >= STEP_DEFS.length) {
        finishSequence();
        return;
      }
      var def = STEP_DEFS[i];
      i += 1;
      setProgress(Math.round(((i - 1) / STEP_DEFS.length) * 100), def.code + ' ' + def.name);
      global.setTimeout(function () {
        if (state.status !== 'booting') return;
        runOne(def, function () {
          flavorLine();
          next();
        });
      }, delay);
    }

    function runOne(def, done) {
      switch (def.code) {
        case 'MB-001':
          stepLine(def.code, def.name, true, 't+' + (now() - state.t0) + 'ms');
          done();
          break;
        case 'MB-010':
          collectEnv();
          stepLine(def.code, def.name, true, String(state.diag.platform) + ' / ' + String(state.diag.screen));
          if (state.diag.protocol === 'file:') {
            recordWarning('Page opened via file:// — some browsers block game files here. Prefer http(s).');
          }
          if (state.diag.online === 'no') {
            recordWarning('Browser reports OFFLINE — CDN imports may fail.');
          }
          done();
          break;
        case 'MB-020':
          collectFeatures();
          if (!state.diag.modules) {
            stepLine(def.code, def.name, false, 'ES modules unsupported');
            finishFail('MB-E202', 'BROWSER TOO OLD', 'This browser cannot run ES module scripts, which every Muse Spark game needs. Update to a current Chrome, Edge, Firefox, or Safari.');
            return;
          }
          stepLine(def.code, def.name, true, 'mods+canvas+audio+store');
          if (!state.diag.storage) recordWarning('localStorage unavailable — saves/settings may not persist.');
          if (!state.diag.audio) recordWarning('Web Audio unavailable — game will be silent.');
          done();
          break;
        case 'MB-030':
          probeWebGPU(function (res) {
            if (state.status !== 'booting') return;
            state.probes.webgpu = !!res.ok;
            state.diag.webgpu = !!res.ok;
            state.diag.webgpuAdapter = res.ok ? (res.adapter || 'ok') : ('no (' + (res.reason || 'unknown') + ')');
            var have = [];
            if (state.probes.webgl) have.push('GL');
            if (state.probes.webgl2) have.push('GL2');
            if (state.probes.webgpu) have.push('GPU');
            stepLine(def.code, def.name, true, have.length > 0 ? ('have: ' + have.join('+')) : 'none detected');
            done();
          });
          break;
        case 'MB-040': {
          var gate = evaluateGate(state.need);
          if (!gate.ok) {
            stepLine(def.code, def.name, false, 'need ' + state.need.toUpperCase());
            finishFail(gate.code, gate.title, gate.detail);
            return;
          }
          var extra = 'need ' + state.need.toUpperCase() + ' present';
          if (state.prefer && !state.probes[state.prefer]) {
            recordWarning('Preferred renderer ' + state.prefer.toUpperCase() + ' missing — using fallback.');
          }
          stepLine(def.code, def.name, true, extra);
          done();
          break;
        }
        case 'MB-050':
          stepLine(def.code, def.name, true, state.readyQueue.length + ' waiter(s)');
          done();
          break;
        default:
          done();
          break;
      }
    }

    function finishSequence() {
      if (state.status !== 'booting') return;
      var wait = state.noboot ? 0 : Math.max(0, BOOT_MIN_MS - (now() - state.t0));
      global.setTimeout(function () {
        if (state.status !== 'booting') return;
        finishOk();
      }, wait);
    }

    header();
    next();
  }

  function evaluateGate(need) {
    var p = state.probes;
    var avail = {
      '2d': !!p.canvas2d,
      webgl: !!p.webgl,
      webgl2: !!p.webgl2,
      webgpu: !!p.webgpu
    };
    if (!avail[need]) {
      var names = { '2d': 'Canvas 2D', webgl: 'WebGL', webgl2: 'WebGL2', webgpu: 'WebGPU' };
      return {
        ok: false,
        code: 'MB-E201',
        title: 'RENDERER UNAVAILABLE',
        detail: 'This game needs ' + (names[need] || need) + ' but this browser/device did not provide it. ' +
          'Try a current Chrome or Edge with hardware acceleration enabled.'
      };
    }
    return { ok: true };
  }

  /* ---------------- Finish ---------------- */

  function finishOk() {
    if (state.status !== 'booting') return;
    state.status = 'ready';
    state.bootedAt = now();
    setProgress(100, 'MB-900 READY');
    addLine('mb-line-ok', '[MB-900] READY ............ OK');
    publishReport();
    var queue = state.readyQueue.slice();
    state.readyQueue = [];
    global.setTimeout(function () {
      hide();
      startCrashWatch();
      for (var i = 0; i < queue.length; i++) {
        try {
          queue[i](api);
        } catch (e) { /* ignore waiter errors */ }
      }
    }, state.noboot ? 0 : 350);
  }

  function finishFail(code, title, detail) {
    if (state.status === 'failed') return;
    state.status = 'failed';
    state.fail = { code: code, title: title, detail: detail || '' };
    state.steps.push({ code: code, name: title, ok: false, detail: detail || '' });
    setProgress(100, code + ' ' + title);
    addLine('mb-line-fail', '[' + code + '] ' + title + ' .... FAIL');
    if (detail) addLine('mb-line-info', '  ' + detail);
    stopCrashWatch();
    renderFailBox();
    publishReport();
    show();
    for (var i = 0; i < state.failHooks.length; i++) {
      try {
        state.failHooks[i](state.fail);
      } catch (e) { /* ignore */ }
    }
  }

  function renderFailBox() {
    var dom = ensureDom();
    if (!dom) return;
    try {
      if (dom.root && dom.root.className.indexOf('mb-failed') === -1) {
        dom.root.className += ' mb-failed';
      }
      if (dom.failTitle) dom.failTitle.textContent = 'BOOT FAILED — ' + state.fail.code + ' ' + state.fail.title;
      if (dom.failDetail) dom.failDetail.textContent = state.fail.detail;
      if (dom.report) dom.report.textContent = buildReport();
      if (dom.fail) {
        dom.fail.hidden = false;
        dom.fail.style.display = '';
      }
    } catch (e) { /* ignore */ }
  }

  /* ---------------- Report ---------------- */

  function yn(v) {
    if (v === true) return 'yes';
    if (v === false) return 'no';
    return String(v);
  }

  function buildReport() {
    var d = state.diag;
    var out = [];
    out.push('MUSE SPARK BIOS BOOT REPORT v' + VERSION);
    out.push('game: ' + state.gameTitle + ' [' + state.gameId + ']');
    out.push('time: ' + (d.time || 'n/a') + '  status: ' + state.status.toUpperCase());
    if (state.fail) {
      out.push('fail: ' + state.fail.code + ' ' + state.fail.title);
      out.push('  ' + state.fail.detail);
    }
    out.push('steps:');
    for (var i = 0; i < state.steps.length; i++) {
      var s = state.steps[i];
      out.push('  [' + s.code + '] ' + s.name + ' ' + (s.ok ? 'OK' : 'FAIL') + (s.detail ? ' — ' + s.detail : ''));
    }
    out.push('diagnostics:');
    out.push('  ua: ' + (d.ua || 'n/a'));
    out.push('  platform: ' + (d.platform || 'n/a') + '  lang: ' + (d.language || 'n/a'));
    out.push('  cores: ' + yn(d.cores) + '  memGB: ' + yn(d.memoryGB) + '  screen: ' + (d.screen || 'n/a') +
      '  dpr: ' + yn(d.dpr) + '  touch: ' + yn(d.touch));
    out.push('  protocol: ' + (d.protocol || 'n/a') + '  online: ' + yn(d.online));
    out.push('  modules: ' + yn(d.modules) + '  canvas2d: ' + yn(d.canvas2d) +
      '  webgl: ' + yn(d.webgl) + '  webgl2: ' + yn(d.webgl2) + '  webgpu: ' + yn(d.webgpu));
    out.push('  gpu: ' + (d.gpu || 'n/a'));
    out.push('  webgpuAdapter: ' + (d.webgpuAdapter || 'n/a'));
    out.push('  audio: ' + yn(d.audio) + '  storage: ' + yn(d.storage) +
      '  workers: ' + yn(d.workers) + '  wasm: ' + yn(d.wasm) + '  fullscreen: ' + yn(d.fullscreen));
    if (state.warnings.length > 0) {
      out.push('warnings:');
      for (var w = 0; w < state.warnings.length; w++) out.push('  ! ' + state.warnings[w]);
    }
    out.push('need: ' + state.need + (state.prefer ? ' (prefer ' + state.prefer + ')' : ''));
    return out.join('\n');
  }

  function publishReport() {
    try {
      global.__MUSE_BOOT_REPORT__ = buildReport();
    } catch (e) { /* ignore */ }
  }

  function copyReport() {
    var text = buildReport();
    function done(btnText) {
      var dom = state.dom;
      if (dom && dom.copy) {
        try {
          dom.copy.textContent = btnText;
        } catch (e) { /* ignore */ }
      }
    }
    try {
      if (NAVIGATOR.clipboard && NAVIGATOR.clipboard.writeText) {
        NAVIGATOR.clipboard.writeText(text).then(function () {
          done('COPIED!');
        }, function () {
          fallbackCopy(text, done);
        });
        return;
      }
    } catch (e) { /* fall through */ }
    fallbackCopy(text, done);
  }

  function fallbackCopy(text, done) {
    try {
      var ta = DOCUMENT.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      DOCUMENT.body.appendChild(ta);
      ta.select();
      DOCUMENT.execCommand('copy');
      DOCUMENT.body.removeChild(ta);
      done('COPIED!');
    } catch (e) {
      done('COPY FAILED — SCREENSHOT INSTEAD');
    }
  }

  /* ---------------- Crash watch ---------------- */

  function startCrashWatch() {
    stopCrashWatch();
    try {
      state.crashTimer = global.setTimeout(function () {
        state.crashTimer = null;
      }, CRASH_WATCH_MS);
    } catch (e) { /* ignore */ }
  }

  function stopCrashWatch() {
    if (state.crashTimer) {
      try {
        global.clearTimeout(state.crashTimer);
      } catch (e) { /* ignore */ }
      state.crashTimer = null;
    }
  }

  function describeError(evt) {
    var msg = '';
    try {
      msg = (evt && evt.message) || 'unknown error';
    } catch (e) {
      msg = 'unknown error';
    }
    var where = '';
    try {
      if (evt && evt.filename) where = ' @ ' + evt.filename + ':' + (evt.lineno || '?');
    } catch (e) { /* ignore */ }
    return String(msg) + where;
  }

  function hookErrors() {
    /* Runtime errors (bubble phase). */
    on(global, 'error', function (evt) {
      try {
        if (evt && evt.target && (evt.target.src || evt.target.href)) return; /* resource: handled below */
      } catch (e) { /* ignore */ }
      var desc = describeError(evt);
      if (state.status === 'booting') {
        recordWarning('Script error during boot: ' + desc);
      } else if (state.status === 'ready' && state.crashTimer) {
        show();
        finishFail('MB-E501', 'GAME CRASHED DURING STARTUP', desc);
      }
    }, false);

    /* Resource load errors (capture phase): failed CDN/module scripts. */
    on(global, 'error', function (evt) {
      var t = null;
      try {
        t = evt && evt.target;
      } catch (e) { /* ignore */ }
      if (!t || !(t.src || t.href)) return;
      var url = '';
      try {
        url = t.src || t.href || String(t.tagName);
      } catch (e) {
        url = 'resource';
      }
      if (state.status === 'booting') {
        finishFail('MB-E302', 'GAME FILE FAILED TO LOAD', 'A script or import failed to load: ' + url +
          '. Check your connection (CDN imports need the network).');
      } else if (state.status === 'ready' && state.crashTimer) {
        recordWarning('Resource failed after boot: ' + url);
      }
    }, true);

    on(global, 'unhandledrejection', function (evt) {
      var desc = 'unhandled rejection';
      try {
        var r = evt && evt.reason;
        desc = (r && (r.stack || r.message)) || String(r);
      } catch (e) { /* ignore */ }
      if (state.status === 'booting') {
        recordWarning('Async error during boot: ' + String(desc).slice(0, 200));
      } else if (state.status === 'ready' && state.crashTimer) {
        show();
        finishFail('MB-E501', 'GAME CRASHED DURING STARTUP', String(desc).slice(0, 300));
      }
    }, false);
  }

  /* ---------------- Public API ---------------- */

  function gameReady(cfg) {
    return new global.Promise(function (resolve) {
      if (cfg && typeof cfg === 'object') {
        if (typeof cfg.renderer === 'string') state.need = cfg.renderer;
        if (typeof cfg.prefer === 'string') state.prefer = cfg.prefer;
      }
      if (state.status === 'ready') {
        var gate = evaluateGate(state.need);
        if (!gate.ok && state.status === 'ready') {
          /* Late override demanding more than we probed: fail now. */
          show();
          state.status = 'booting';
          finishFail(gate.code, gate.title, gate.detail);
          return;
        }
        resolve(api);
        return;
      }
      if (state.status === 'failed') {
        /* Stay pending forever: the game must not start behind a fail screen. */
        return;
      }
      state.readyQueue.push(resolve);
    });
  }

  function gameStarted() {
    stopCrashWatch();
    hide();
  }

  var api = {
    version: VERSION,
    gameReady: gameReady,
    gameStarted: gameStarted,
    show: show,
    hide: hide,
    report: buildReport,
    copyReport: copyReport,
    onFail: function (fn) {
      if (typeof fn === 'function') {
        if (state.status === 'failed') {
          try {
            fn(state.fail);
          } catch (e) { /* ignore */ }
        } else {
          state.failHooks.push(fn);
        }
      }
    },
    status: function () { return state.status; },
    steps: function () { return state.steps.slice(); },
    diag: function () {
      var copy = {};
      for (var k in state.diag) {
        if (Object.prototype.hasOwnProperty.call(state.diag, k)) copy[k] = state.diag[k];
      }
      return copy;
    }
  };

  /* ---------------- Auto-run ---------------- */

  function readConfig() {
    try {
      var root = $('muse-boot');
      if (root && root.getAttribute) {
        var id = root.getAttribute('data-boot-id');
        var title = root.getAttribute('data-boot-title');
        var need = root.getAttribute('data-boot-renderer');
        var prefer = root.getAttribute('data-boot-prefer');
        if (id) state.gameId = id;
        if (title) state.gameTitle = title;
        if (need) state.need = need;
        if (prefer) state.prefer = prefer;
      }
    } catch (e) { /* ignore */ }
    try {
      var q = parseQuery(LOCATION.search);
      if (q.noboot === '1') state.noboot = true;
    } catch (e) { /* ignore */ }
  }

  readConfig();
  hookErrors();
  ensureDom();
  publishReport();
  runSteps();

  global.MuseBoot = api;
})(typeof window !== 'undefined' ? window : this);
