// Extension options: the on-device model, highlights, and team sync (server address, API key, project).
'use strict';

const PREF_KEY = 'modelEnabled';
const $ = (id) => document.getElementById(id);
const SAMPLE = 'Ship To:\nAnkita Sharma\n128/357 H-2 Block, Kidwai Nagar, Near Swaroop School\nKanpur, Uttar Pradesh\n' +
  'notes: spoke with ravi kumar from zentrix analytics; the Field Services team will follow up.';

function send(msg, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, code: 'timeout', error: `no answer after ${timeoutMs / 1000} s` }), timeoutMs);
    chrome.runtime.sendMessage(msg, (res) => {
      clearTimeout(timer);
      const err = chrome.runtime.lastError;
      resolve(err ? { ok: false, code: 'unavailable', error: err.message } : (res || { ok: false, code: 'failed', error: 'empty answer' }));
    });
  });
}

const STATUS_TEXT = {
  idle: ['Installed, not loaded yet', ''],
  loading: ['Loading…', ''],
  ready: ['Ready', 'ok'],
  'not-installed': ['Not installed in this build', 'bad'],
  unsupported: ['This browser cannot run it', 'bad'],
  failed: ['Failed to load', 'bad'],
};

function show(status, detail) {
  const [text, cls] = STATUS_TEXT[status] || [status, ''];
  $('status').textContent = text;
  $('status').className = cls;
  $('detail').textContent = detail || '';
}

async function refreshStatus() {
  const page = await send({ target: 'pii-background', type: 'ensure-model-page' }, 15000);
  if (!page.ok) { show('failed', page.error); return; }
  const r = await send({ target: 'pii-model', type: 'status' }, 10000);
  if (r.ok) show(r.status, r.detail); else show('failed', r.error);
}

async function test() {
  $('test').disabled = true;
  $('result').hidden = false;
  $('result').textContent = 'Loading the model and checking a sample…';
  show('loading');
  const t0 = performance.now();
  await send({ target: 'pii-background', type: 'ensure-model-page' }, 15000);
  const r = await send({ target: 'pii-model', type: 'detect', text: SAMPLE, key: 'options-sample' }, 180000);
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  if (!r.ok) {
    $('result').textContent = `Failed (${r.code}): ${r.error}`;
  } else {
    const lines = r.entities.map((e) => `${e.label.padEnd(16)} ${Math.round(e.score * 100)}%  “${e.text.replace(/\n/g, ' ')}”`);
    $('result').textContent = `Sample:\n${SAMPLE}\n\nFound in ${secs} s (model ${r.ms} ms):\n${lines.join('\n') || '(nothing)'}`;
  }
  $('test').disabled = false;
  refreshStatus();
}

// One read-only line: what the offline knowledge base holds (npm run build-kb), or that it is not installed.
async function showKnowledgeBase() {
  try {
    const m = await (await fetch(chrome.runtime.getURL('data/kb/meta.json'))).json();
    const n = (x) => Number(x).toLocaleString();
    $('kb').textContent = `Knowledge base: ${n(m.companies)} companies · ${n(m.people)} public figures · ${n(m.domains)} websites (built ${m.built}). Works offline.`;
  } catch (e) {
    $('kb').textContent = 'Knowledge base: not installed in this build.';
  }
}

// ---------- Team sync (sw/cloud-sync.js does the network; this page only edits the settings)

const bg = (type, data, ms) => send({ target: 'pii-background', type, ...(data || {}) }, ms || 15000);
const when = (t) => (t ? new Date(t).toLocaleString() : 'never');

async function showCloud() {
  const s = await bg('cloud-status');
  if (!s.ok) { $('cloudStatus').textContent = 'Unavailable'; $('cloudStatus').className = 'bad'; $('cloudDetail').textContent = s.error || ''; return; }
  const [text, cls] = !s.enabled ? ['Off', '']
    : !s.endpoint || !s.hasKey ? ['Needs a server address and API key', 'bad']
    : !s.permitted ? ['Access to the server not granted — press Save', 'bad']
    : s.lastError ? ['Error', 'bad'] : ['On', 'ok'];
  $('cloudStatus').textContent = text;
  $('cloudStatus').className = cls;
  const lists = s.profiles.map((p) => `${p.project} v${p.version} (${p.entries})`).join(', ') || 'none yet';
  $('cloudDetail').textContent = [s.lastError, `Queued: ${s.queued}`, `Last sent: ${when(s.lastPush)}`, `Last list: ${when(s.lastPull)}`, `Team lists: ${lists}`]
    .filter(Boolean).join(' · ');
}

async function initCloud() {
  const c = await bg('cloud-config');
  if (!c.ok) return;
  $('cloudOn').checked = c.enabled;
  $('cloudUrl').value = c.endpoint || '';
  $('cloudKey').value = '';
  $('cloudKey').placeholder = c.hasKey ? '•••••••• (saved — type to replace)' : 'from your administrator';
  $('cloudProject').value = c.project || '';
  $('cloudShare').checked = c.share !== false;
  // Settings fixed by the organisation cannot be changed here.
  const p = c.policy || {};
  const locked = [];
  if (p.enabled === false) { $('cloudOn').disabled = true; locked.push('sync is switched off'); }
  if (p.endpoint) { $('cloudUrl').disabled = true; locked.push('the server address'); }
  if (p.apiKey) { $('cloudKey').disabled = true; locked.push('the API key'); }
  if (p.share === false) { $('cloudShare').disabled = true; locked.push('sharing is off'); }
  if (locked.length) { $('cloudPolicy').hidden = false; $('cloudPolicy').textContent = `Set by your organisation: ${locked.join(', ')}.`; }

  $('cloudSave').addEventListener('click', async () => {
    const endpoint = $('cloudUrl').value.trim().replace(/\/+$/, '');
    // Ask for access to this one server only (needs the click, so it comes first).
    if (endpoint && !$('cloudUrl').disabled) {
      let origin = '';
      try { origin = new URL(endpoint).origin; } catch (e) { origin = ''; }
      if (!origin) { $('cloudDetail').textContent = 'That is not a valid address.'; return; }
      const granted = await chrome.permissions.request({ origins: [origin + '/*'] });
      if (!granted) { $('cloudDetail').textContent = `Access to ${origin} was not granted, so sync cannot reach it.`; }
    }
    const patch = { enabled: $('cloudOn').checked, project: $('cloudProject').value.trim(), share: $('cloudShare').checked };
    if (!$('cloudUrl').disabled) patch.endpoint = endpoint;
    if ($('cloudKey').value && !$('cloudKey').disabled) patch.apiKey = $('cloudKey').value.trim();
    const r = await bg('cloud-save', { config: patch });
    $('cloudDetail').textContent = r.ok ? 'Saved.' : r.error;
    if (r.ok) { $('cloudKey').value = ''; await initCloudPlaceholders(); }
    showCloud();
  });
  $('cloudTest').addEventListener('click', async () => {
    $('cloudTest').disabled = true;
    const r = await bg('cloud-test');
    $('cloudTest').disabled = false;
    $('cloudDetail').textContent = r.ok ? `Connected: ${(r.service && r.service.service) || 'server'} ${(r.service && r.service.version) || ''}, key accepted.`
      : `Failed (${r.code}${r.status ? ' ' + r.status : ''}): ${r.error}`;
  });
  $('cloudFlush').addEventListener('click', async () => {
    $('cloudFlush').disabled = true;
    const r = await bg('cloud-flush', null, 60000);
    $('cloudFlush').disabled = false;
    $('cloudDetail').textContent = r.ok ? `Sent ${r.sent} answer${r.sent === 1 ? '' : 's'}${r.promoted ? `, ${r.promoted} added to the team list` : ''}.` : `Not sent (${r.code}): ${r.error || ''}`;
    showCloud();
  });
  showCloud();
}

async function initCloudPlaceholders() {
  const c = await bg('cloud-config');
  if (c.ok) $('cloudKey').placeholder = c.hasKey ? '•••••••• (saved — type to replace)' : 'from your administrator';
}

async function init() {
  const m = chrome.runtime.getManifest();
  const rel = /^(\S+)\s+([A-Za-z][\w-]*)\s+-\s+(.+)$/.exec(m.version_name || '');
  $('ver').textContent = rel ? `✦ ${rel[2]} · ${rel[1].replace(/\.0$/, '')} · ${rel[3]}` : `v${m.version_name || m.version}`;
  $('ver').title = `Version ${m.version_name || m.version}`;
  let policy = {};
  try { policy = await chrome.storage.managed.get('model'); } catch (e) { policy = {}; }
  const box = $('enabled');
  if (policy.model === 'on' || policy.model === 'off') {
    box.checked = policy.model === 'on';
    box.disabled = true;
    $('policy').hidden = false;
    $('policy').textContent = `Set by your organisation (${policy.model}).`;
  } else {
    box.checked = (await chrome.storage.local.get(PREF_KEY))[PREF_KEY] === true;
    box.addEventListener('change', () => chrome.storage.local.set({ [PREF_KEY]: box.checked }));
  }
  const tags = $('tags');
  tags.checked = (await chrome.storage.local.get('labelTags')).labelTags !== false;
  tags.addEventListener('change', () => chrome.storage.local.set({ labelTags: tags.checked }));
  const sel = $('selcheck');
  sel.checked = (await chrome.storage.local.get('selectCheck')).selectCheck !== false;
  sel.addEventListener('change', () => chrome.storage.local.set({ selectCheck: sel.checked }));
  $('test').addEventListener('click', test);
  showKnowledgeBase();
  refreshStatus();
  initCloud();
}

init();
