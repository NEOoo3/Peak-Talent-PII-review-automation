// Runs the GLiNER model for the content script. Lives in the offscreen document, so the 350 MB
// model is loaded once and kept while reviewing, outside the review site's page.
//
// Messages (chrome.runtime.sendMessage with target 'pii-model'):
//   {type: 'status'}                        -> {ok, status, detail}
//   {type: 'detect', key, text, budgetMs}   -> {ok, entities, partial, windows, done, ms} | {ok: false, code, error}
// Error codes: not-installed, unsupported, load-failed, too-large, cancelled, failed.
// Everything stays in the browser: files are read from the extension itself.
(function (g) {
  'use strict';
  const ML = g.PIIRA_ML;
  const PROMPTS = g.PIIRA_ML_PROMPTS;
  const MODEL_DIR = 'models/multi_pii/';
  const MAX_CHARS = 2000000;       // larger documents are not sent to the model
  const IDLE_CLOSE_MS = 15 * 60 * 1000; // free the memory after 15 idle minutes
  const LABELS = PROMPTS.PROMPTS.map((p) => p[0]);

  let status = 'idle';     // idle | loading | ready | failed | not-installed | unsupported
  let detail = '';
  let loading = null;      // Promise<Gliner>
  let model = null;
  let currentJob = 0;
  const cache = new Map(); // key -> result (last few documents)
  let idleTimer = null;

  const url = (p) => chrome.runtime.getURL(p);
  const fail = (code, error) => ({ ok: false, code, error: String(error && error.message || error) });

  function touch() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => window.close(), IDLE_CLOSE_MS);
  }

  // A missing extension file makes fetch() throw; small files only (never probe the 350 MB weights).
  async function exists(path) {
    try {
      const r = await fetch(url(path));
      return r.ok;
    } catch (e) {
      return false;
    }
  }

  function load() {
    if (model) return Promise.resolve(model);
    if (loading) return loading;
    loading = (async () => {
      status = 'loading';
      detail = '';
      if (!(await exists(MODEL_DIR + 'gliner_config.json')) || !(await exists('vendor/ort/ort-wasm-simd-threaded.mjs'))) {
        status = 'not-installed';
        detail = 'The model files are not in this build of the extension (run "npm run setup-model").';
        throw Object.assign(new Error(detail), { code: 'not-installed' });
      }
      if (typeof WebAssembly !== 'object' || typeof g.ort === 'undefined' || !g.ort.InferenceSession) {
        status = 'unsupported';
        detail = 'This browser cannot run the model (WebAssembly or the runtime is missing).';
        throw Object.assign(new Error(detail), { code: 'unsupported' });
      }
      const t0 = performance.now();
      const ort = g.ort;
      ort.env.wasm.wasmPaths = url('vendor/ort/');
      // Threads need cross-origin isolation (set for extension pages in manifest.json); without it, one thread.
      // At most half the cores (and 4): the model runs while the reviewer works, and taking nearly every
      // core made the whole browser stop answering while a task loaded.
      const cores = navigator.hardwareConcurrency || 2;
      ort.env.wasm.numThreads = g.crossOriginIsolated ? Math.max(1, Math.min(4, Math.floor(cores / 2))) : 1;
      ort.env.wasm.proxy = false;
      const [tokJson, weights] = await Promise.all([
        fetch(url(MODEL_DIR + 'tokenizer.json')).then((r) => r.json()),
        fetch(url(MODEL_DIR + 'onnx/model_int8.onnx')).then((r) => {
          if (!r.ok) throw new Error('model_int8.onnx is missing or unreadable');
          return r.arrayBuffer();
        }),
      ]);
      const session = await ort.InferenceSession.create(new Uint8Array(weights), { executionProviders: ['wasm'] });
      model = new ML.Gliner(ort, session, new ML.UnigramTokenizer(tokJson), { maxWidth: 12, maxWords: 200 });
      status = 'ready';
      detail = `loaded in ${Math.round(performance.now() - t0)} ms, ${ort.env.wasm.numThreads} thread${ort.env.wasm.numThreads > 1 ? 's' : ''}`;
      return model;
    })().catch((err) => {
      loading = null;
      if (!err.code) { status = 'failed'; detail = `Could not load the model: ${err.message || err}`; err.code = 'load-failed'; }
      throw err;
    });
    return loading;
  }

  async function detect({ key, text, budgetMs }) {
    if (typeof text !== 'string' || !text.trim()) return { ok: true, entities: [], partial: false, windows: 0, done: 0, ms: 0 };
    if (text.length > MAX_CHARS) return fail('too-large', `The document is too large for the model (${text.length.toLocaleString()} characters).`);
    if (key && cache.has(key)) return cache.get(key);
    const job = ++currentJob; // a newer document cancels this one between windows
    let m;
    try {
      m = await load();
    } catch (err) {
      return fail(err.code || 'load-failed', err);
    }
    const t0 = performance.now();
    // Only distinct lines with words go to the model; answers are copied to every repeat of a line.
    const plan = ML.planLines(text, m.maxWords);
    const wins = plan.windows;
    const raw = [];
    let done = 0;
    for (const w of wins) {
      if (job !== currentJob) return fail('cancelled', 'A newer document replaced this one.');
      if (budgetMs && performance.now() - t0 > budgetMs) break; // keep what is done; the rest stays rules-only
      let found;
      try {
        found = await m.predict(w.text, LABELS, 0.1);
      } catch (err) {
        return fail('failed', `The model failed on part of the document: ${err.message || err}`);
      }
      for (const e of found) {
        // The line the entity is on (spans across lines are cut to their first line).
        const line = w.lines.find((l) => e.start >= l.at && e.start < l.at + l.len);
        if (!line) continue;
        const s = e.start - line.at;
        const end = Math.min(e.end - line.at, line.len);
        for (const lineStart of plan.occurrences.get(line.key)) {
          raw.push({ label: e.label, score: e.score, start: lineStart + line.offset + s, end: lineStart + line.offset + end });
        }
      }
      done++;
    }
    const result = {
      ok: true, entities: PROMPTS.toSiteLabels(raw, text), partial: done < wins.length, windows: wins.length, done,
      words: plan.words, skippedLines: plan.skipped,
      ms: Math.round(performance.now() - t0),
    };
    if (key) {
      cache.set(key, result);
      if (cache.size > 5) cache.delete(cache.keys().next().value);
    }
    return result;
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.target !== 'pii-model') return false;
    if (sender.id !== chrome.runtime.id) return false; // only this extension
    touch();
    if (msg.type === 'status') {
      sendResponse({ ok: true, status, detail });
      return false;
    }
    if (msg.type === 'preload') {
      load().then(() => sendResponse({ ok: true, status, detail }), (err) => sendResponse(fail(err.code || 'load-failed', err)));
      return true;
    }
    if (msg.type === 'detect') {
      detect(msg).then(sendResponse, (err) => sendResponse(fail('failed', err)));
      return true; // answer asynchronously
    }
    return false;
  });

  touch();
})(globalThis);
