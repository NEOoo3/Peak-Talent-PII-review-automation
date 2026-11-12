// Effective selectors = (saved setup for this site) or (auto-detected) layered
// over the defaults in selectors.js. Only selectors are stored — never any
// document text — in chrome.storage.local (or localStorage on test.html).
(function (g) {
  'use strict';
  const P = g.PIIRA;

  const KEY = 'piira.setup.' + location.host;
  const hasChrome = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

  let saved = null;
  let detected = null;

  async function load() {
    try {
      if (hasChrome) saved = (await chrome.storage.local.get(KEY))[KEY] || null;
      else saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch (e) {
      saved = null;
    }
    return saved;
  }

  async function save(setup) {
    saved = { ...setup, savedAt: new Date().toISOString() };
    try {
      if (hasChrome) await chrome.storage.local.set({ [KEY]: saved });
      else localStorage.setItem(KEY, JSON.stringify(saved));
    } catch (e) { /* storage unavailable: keep in memory for this tab */ }
  }

  async function reset() {
    saved = null;
    detected = null;
    try {
      if (hasChrome) await chrome.storage.local.remove(KEY);
      else localStorage.removeItem(KEY);
    } catch (e) { /* ignore */ }
  }

  const uniq = (a) => [...new Set(a.filter(Boolean))];

  /** Merge a setup layer ({leftDocument, rightDocument, label:{...spec}}) over selectors.js. */
  function merge(layer) {
    const base = P.SELECTORS;
    if (!layer) return base;
    const lab = layer.label || {};
    return {
      ...base,
      leftDocument: layer.leftDocument ? [layer.leftDocument] : base.leftDocument,
      rightDocument: layer.rightDocument ? [layer.rightDocument] : base.rightDocument,
      rightLabelSpan: uniq([lab.rightLabelSpan, ...base.rightLabelSpan]),
      labelNameAttributes: uniq([...(lab.labelNameAttributes || []), ...base.labelNameAttributes]),
      labelClassPrefixes: uniq([...(lab.labelClassPrefixes || []), ...base.labelClassPrefixes]),
      labelNameFromChild: lab.labelNameFromChild || base.labelNameFromChild || '',
      ignoreInText: uniq([...(lab.ignoreInText || []), ...base.ignoreInText]),
    };
  }

  // Reviewer preferences (e.g. L1/L2 stage). Small, no document text.
  const PREFS_KEY = 'piira.prefs';
  let prefs = {};
  async function loadPrefs() {
    try {
      if (hasChrome) prefs = (await chrome.storage.local.get(PREFS_KEY))[PREFS_KEY] || {};
      else prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    } catch (e) { prefs = {}; }
    return prefs;
  }
  async function savePrefs(patch) {
    prefs = { ...prefs, ...patch };
    try {
      if (hasChrome) await chrome.storage.local.set({ [PREFS_KEY]: prefs });
      else localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (e) { /* keep in memory */ }
  }

  P.config = {
    loadPrefs,
    savePrefs,
    load,
    save,
    reset,
    merge,
    setDetected(d) { detected = d; },
    get saved() { return saved; },
    get detected() { return detected; },
  };
})(globalThis);
