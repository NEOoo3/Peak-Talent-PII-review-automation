// Content-script side of the on-device model: asks the background worker to open the model page,
// then sends it the document. Every failure becomes a status the panel can show, and the review
// carries on with the rules alone:
//   off · not-installed · unsupported · loading · running · ready · partial · failed · timeout · too-large · unavailable
(function (g) {
  'use strict';
  const P = g.PIIRA;

  const PREF_KEY = 'modelEnabled';
  const TIMEOUT_MS = 120000;     // give up waiting for an answer after 2 minutes
  const BUDGET_MS = 60000;       // the model page stops after 1 minute and returns what it has

  const MESSAGES = {
    off: 'Model suggestions are off (extension options).',
    'not-installed': 'Model not installed in this build — rules only.',
    unsupported: 'This browser cannot run the model — rules only.',
    loading: 'Model: loading (first time takes a few seconds)…',
    running: 'Model: checking names, companies and addresses…',
    ready: 'Model: done.',
    partial: 'Model: checked part of a large document; the rest is rules only.',
    failed: 'Model failed — rules only.',
    timeout: 'Model took too long — rules only.',
    'too-large': 'Document too large for the model — rules only.',
    unavailable: 'Model unavailable (extension was updated or reloaded) — reload the page.',
  };

  const hasChrome = () => typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;

  /** chrome.runtime.sendMessage as a promise that never rejects: {ok:false, code, error} on any failure. */
  function send(msg, timeoutMs) {
    return new Promise((resolve) => {
      if (!hasChrome()) { resolve({ ok: false, code: 'unavailable', error: 'extension context is gone' }); return; }
      let settled = false;
      const done = (r) => { if (!settled) { settled = true; clearTimeout(timer); resolve(r); } };
      const timer = setTimeout(() => done({ ok: false, code: 'timeout', error: `no answer after ${Math.round(timeoutMs / 1000)} s` }), timeoutMs);
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          const err = chrome.runtime.lastError;
          if (err) done({ ok: false, code: /receiving end does not exist|message port closed/i.test(err.message) ? 'no-page' : 'unavailable', error: err.message });
          else done(res || { ok: false, code: 'failed', error: 'empty answer' });
        });
      } catch (err) {
        // "Extension context invalidated": the extension was reloaded under this page.
        done({ ok: false, code: 'unavailable', error: String(err && err.message || err) });
      }
    });
  }

  async function ensurePage() {
    const r = await send({ target: 'pii-background', type: 'ensure-model-page' }, 15000);
    return r.ok ? null : r;
  }

  /**
   * Model entities for `text`: {status, entities, error?, ms?}. Never throws.
   * `key` identifies the text (hash) so the model page can answer repeats from its cache.
   */
  async function detect(text, key, onStatus) {
    const say = (s) => { if (onStatus) onStatus(s); };
    const problem = await ensurePage();
    if (problem) return { status: problem.code === 'timeout' ? 'timeout' : 'unavailable', entities: [], error: problem.error };
    say('running');
    let r = await send({ target: 'pii-model', type: 'detect', key, text, budgetMs: BUDGET_MS }, TIMEOUT_MS);
    if (!r.ok && r.code === 'no-page') {
      // The model page closed itself (idle) between the two messages: open it again once.
      const again = await ensurePage();
      if (again) return { status: 'unavailable', entities: [], error: again.error };
      r = await send({ target: 'pii-model', type: 'detect', key, text, budgetMs: BUDGET_MS }, TIMEOUT_MS);
    }
    if (!r.ok) {
      const status = { 'not-installed': 'not-installed', unsupported: 'unsupported', timeout: 'timeout', 'too-large': 'too-large',
        cancelled: 'cancelled', 'no-page': 'unavailable', unavailable: 'unavailable' }[r.code] || 'failed';
      if (status !== 'cancelled') console.warn('[PII Review Automation] model:', r.code, r.error);
      return { status, entities: [], error: r.error };
    }
    return { status: r.partial ? 'partial' : 'ready', entities: r.entities || [], ms: r.ms, windows: r.windows, done: r.done };
  }

  /** Is the model switched on? Policy decides first ('off' / 'on'), else the reviewer's option (default off). */
  async function enabled(policy) {
    const mode = policy && policy.model;
    if (mode === 'off') return false;
    if (mode === 'on') return true;
    try {
      if (!hasChrome() || !chrome.storage || !chrome.storage.local) return false;
      const v = await chrome.storage.local.get(PREF_KEY);
      return v[PREF_KEY] === true;
    } catch (err) {
      return false;
    }
  }

  P.modelClient = { detect, enabled, send, MESSAGES, PREF_KEY };
})(globalThis);
