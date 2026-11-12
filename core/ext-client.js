// Messages from the page to the extension's own background and offscreen pages, as promises that never
// reject: {ok: false, code, error} on any failure. On test pages (no extension) every call answers
// {ok: false, code: 'unavailable'}, and callers fall back to working in the page.
(function (g) {
  'use strict';
  const P = g.PIIRA;

  const available = () => typeof chrome !== 'undefined' && Boolean(chrome.runtime && chrome.runtime.id);

  function send(msg, timeoutMs) {
    return new Promise((resolve) => {
      if (!available()) { resolve({ ok: false, code: 'unavailable', error: 'not running as an extension' }); return; }
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
        done({ ok: false, code: 'unavailable', error: String((err && err.message) || err) });
      }
    });
  }

  /** To the background service worker. */
  const background = (type, data, timeoutMs) => send({ target: 'pii-background', type, ...(data || {}) }, timeoutMs || 10000);

  P.ext = { available, send, background };
})(globalThis);
