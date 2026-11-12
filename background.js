// Background service worker:
//   - opens the hidden offscreen page that runs the on-device model and the detection engine
//     (offscreen/offscreen.html) when a review tab asks for it; the tab then talks to that page directly,
//     so a long run never depends on this worker staying awake
//   - keeps the learning memory in IndexedDB (sw/memory.js)
//   - team sync with the PIIRA server, when configured (sw/cloud-sync.js)
'use strict';

importScripts('core/cloud-share.js', 'sw/store.js', 'sw/memory.js', 'sw/cloud-sync.js');

const OFFSCREEN = 'offscreen/offscreen.html';
let creating = null; // one creation at a time, even when several tabs ask together

async function hasOffscreen() {
  if (chrome.runtime.getContexts) {
    const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL(OFFSCREEN)] });
    return ctx.length > 0;
  }
  return false;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  if (!creating) {
    creating = chrome.offscreen.createDocument({
      url: OFFSCREEN,
      reasons: ['WORKERS'],
      justification: 'Runs the on-device PII detection engine and model; document text never leaves the browser.',
    }).catch((err) => {
      // Another request created it in the meantime.
      if (!/single offscreen|already exists/i.test(String(err && err.message))) throw err;
    }).finally(() => { creating = null; });
  }
  await creating;
}

// One handler per message type. Each returns a promise of the answer.
const HANDLERS = {
  'ensure-model-page': async () => { await ensureOffscreen(); return { ok: true }; },
  'mem-load': () => PiiraMemory.load(),
  'mem-write': (msg) => PiiraMemory.write(msg),
  'cloud-status': () => PiiraCloud.status(),
  'cloud-config': async () => {
    const c = await PiiraCloud.config();
    return { ok: true, enabled: c.enabled, endpoint: c.endpoint, hasKey: Boolean(c.apiKey), project: c.project, share: c.share, policy: c.policy };
  },
  'cloud-save': (msg) => PiiraCloud.saveConfig(msg.config || {}),
  'cloud-test': () => PiiraCloud.test(),
  'cloud-profile': (msg) => PiiraCloud.profile(msg.taskName, Boolean(msg.force)),
  'cloud-queue': (msg) => PiiraCloud.queue(msg.taskName, msg.items),
  'cloud-flush': () => PiiraCloud.flush(),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'pii-background' || sender.id !== chrome.runtime.id) return false;
  const handler = HANDLERS[msg.type];
  if (!handler) return false;
  Promise.resolve()
    .then(() => handler(msg, sender))
    .then((res) => sendResponse(res), (err) => sendResponse({ ok: false, code: 'failed', error: String((err && err.message) || err) }));
  return true;
});
