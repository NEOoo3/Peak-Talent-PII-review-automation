// The detection engine, off the review page: the same rule detectors the content script carries
// (manifest.json content_scripts, up to core/engine.js), run in this hidden offscreen page, so a large
// document never stalls the site. The content script falls back to running them itself when this page
// is not available (test pages, a closed offscreen document).
//
// Message (chrome.runtime.sendMessage, target 'pii-engine'):
//   {type: 'detect', key, text, hint, settings, labelSet, extraKnownNames} -> {ok, detections, ms} | {ok: false, code, error}
(function (g) {
  'use strict';

  const LAST = 'core/engine.js';
  let ready = null;
  let knownExtra = null;
  const cache = new Map();   // key -> detections (last few documents)

  // Load each script the content script uses for detection, in the manifest's order. An offscreen page
  // has only part of chrome.runtime (no getManifest), so the manifest is read as a file.
  async function loadScripts() {
    const manifest = await (await fetch(chrome.runtime.getURL('manifest.json'))).json();
    const list = manifest.content_scripts[0].js;
    const upto = list.indexOf(LAST);
    if (upto < 0) throw new Error(`${LAST} is not in manifest.json content_scripts`);
    const files = list.slice(0, upto + 1);
    return files.reduce((p, file) => p.then(() => new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = chrome.runtime.getURL(file);
      s.onload = resolve;
      s.onerror = () => reject(new Error(`could not load ${file}`));
      document.head.append(s);
    })), Promise.resolve());
  }

  function init() {
    if (!ready) {
      ready = loadScripts().then(() => Promise.all([g.PIIRA.kb ? g.PIIRA.kb.load() : null])).catch((err) => { ready = null; throw err; });
    }
    return ready;
  }

  async function detect(msg) {
    await init();
    const P = g.PIIRA;
    // Same settings as the page: label set, scope, address rules…
    if (msg.labelSet) P.setLabelSet(msg.labelSet);
    if (msg.settings && typeof msg.settings === 'object') Object.assign(P.SETTINGS, msg.settings);
    P.TASK_CLIENT_NAMES = Array.isArray(msg.taskClientNames) ? msg.taskClientNames : [];
    P.LEARNED_BUSINESS_NAMES = Array.isArray(msg.learnedBusinessNames) ? msg.learnedBusinessNames : [];
    const extra = JSON.stringify(msg.extraKnownNames || []);
    if (extra !== knownExtra) { await P.knownNames.load(msg.extraKnownNames || []); knownExtra = extra; cache.clear(); }
    const key = `${msg.key}:${P.labelSet()}:${JSON.stringify(P.SETTINGS)}:${msg.project}:${P.TASK_CLIENT_NAMES.join(',')}:${P.LEARNED_BUSINESS_NAMES.join(',')}`;
    if (cache.has(key)) return { ok: true, detections: cache.get(key), ms: 0, cached: true };
    const t0 = performance.now();
    const detections = P.engine.run(msg.text, { hint: msg.hint || null, project: msg.project || null });
    cache.set(key, detections);
    if (cache.size > 4) cache.delete(cache.keys().next().value);
    return { ok: true, detections, ms: Math.round(performance.now() - t0) };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.target !== 'pii-engine' || sender.id !== chrome.runtime.id) return false;
    if (msg.type === 'detect') {
      detect(msg).then(sendResponse, (err) => sendResponse({ ok: false, code: 'failed', error: String((err && err.message) || err) }));
      return true;
    }
    if (msg.type === 'ping') { sendResponse({ ok: true }); return false; }
    return false;
  });
})(globalThis);
