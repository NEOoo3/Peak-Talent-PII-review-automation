// Team sync with the PIIRA control plane (server: ../piira-cloud). Runs only in the service worker:
// the page never sees the server address, the API key or the network.
//
//   pull   GET  {endpoint}/v1/projects/{project}/profile       the team's list for a project (cached, ETag)
//   push   POST {endpoint}/v1/projects/{project}/corrections   queued shareable corrections (core/cloud-share.js)
//   test   GET  {endpoint}/v1/health
//
// Off unless an endpoint and key are configured (options page or organisation policy) and the reviewer
// granted the extension access to that one server. Everything else keeps working without it.
'use strict';

const PiiraCloud = (() => {
  const CONFIG_KEY = 'piira.cloud';
  const PROFILE_TTL = 10 * 60 * 1000;   // pull a project's profile again after 10 minutes
  const TIMEOUT = 8000;
  const MAX_OUTBOX = 5000;
  const BATCH = 200;
  let flushTimer = null;
  let flushing = null;

  const validEndpoint = (u) => {
    try {
      const url = new URL(u);
      return url.protocol === 'https:' || (url.protocol === 'http:' && /^(?:localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname));
    } catch (e) { return false; }
  };

  /** Settings: the organisation policy (chrome.storage.managed "cloud") wins over the reviewer's own. */
  async function config() {
    const local = (await chrome.storage.local.get(CONFIG_KEY))[CONFIG_KEY] || {};
    let managed = {};
    try { managed = (await chrome.storage.managed.get('cloud')).cloud || {}; } catch (e) { managed = {}; }
    if (!local.installId) {
      local.installId = crypto.randomUUID();
      await chrome.storage.local.set({ [CONFIG_KEY]: local });
    }
    const endpoint = String(managed.endpoint || local.endpoint || '').trim().replace(/\/+$/, '');
    return {
      enabled: managed.enabled === false ? false : Boolean(managed.enabled || local.enabled),
      endpoint,
      apiKey: String(managed.apiKey || local.apiKey || ''),
      project: String(local.project || '').trim(),
      share: managed.share !== false && local.share !== false,
      policy: { enabled: managed.enabled, endpoint: Boolean(managed.endpoint), apiKey: Boolean(managed.apiKey), share: managed.share },
      installId: local.installId,
    };
  }

  async function saveConfig(patch) {
    const local = (await chrome.storage.local.get(CONFIG_KEY))[CONFIG_KEY] || {};
    const next = { ...local };
    for (const k of ['enabled', 'endpoint', 'apiKey', 'project', 'share']) if (k in patch) next[k] = patch[k];
    if (next.endpoint) next.endpoint = String(next.endpoint).trim().replace(/\/+$/, '');
    if (next.endpoint && !validEndpoint(next.endpoint)) return { ok: false, code: 'bad-endpoint', error: 'Use an https:// address (http:// only for localhost).' };
    await chrome.storage.local.set({ [CONFIG_KEY]: next });
    return { ok: true };
  }

  async function call(c, method, path, body, extraHeaders) {
    if (!c.enabled) return { ok: false, code: 'off', error: 'Team sync is off.' };
    if (!c.endpoint || !validEndpoint(c.endpoint)) return { ok: false, code: 'bad-endpoint', error: 'No valid server address set.' };
    if (!c.apiKey) return { ok: false, code: 'no-key', error: 'No API key set.' };
    const origin = new URL(c.endpoint).origin;
    if (!(await chrome.permissions.contains({ origins: [origin + '/*'] }))) {
      return { ok: false, code: 'no-permission', error: `Access to ${origin} not granted: press Save in the extension options.` };
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const res = await fetch(c.endpoint + path, {
        method, signal: ctrl.signal, credentials: 'omit', cache: 'no-store',
        headers: {
          'Content-Type': 'application/json', 'X-API-Key': c.apiKey, 'X-Reviewer': c.installId,
          'X-Client': `piira/${chrome.runtime.getManifest().version}`, ...(extraHeaders || {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 304) return { ok: true, notModified: true };
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const code = res.status === 401 || res.status === 403 ? 'auth' : 'http';
        return { ok: false, code, status: res.status, error: (data && (typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail))) || res.statusText };
      }
      return { ok: true, data, etag: res.headers.get('ETag') };
    } catch (err) {
      return { ok: false, code: err.name === 'AbortError' ? 'timeout' : 'network', error: String((err && err.message) || err) };
    } finally {
      clearTimeout(timer);
    }
  }

  // Keep only well-formed entries: a value and one of the two shareable labels.
  function cleanProfile(p, project) {
    if (!p || typeof p !== 'object') return null;
    const entries = (Array.isArray(p.entries) ? p.entries : [])
      .filter((e) => e && typeof e.value === 'string' && e.value.length <= 120 && (e.label === 'Business Name' || e.label === 'NOT_PII'))
      .map((e) => ({ value: e.value, label: e.label, reviewers: +e.reviewers || 0, source: e.source === 'admin' ? 'admin' : 'quorum' }));
    return {
      project: String(p.project || project), version: +p.version || 0, updatedAt: p.updatedAt || null,
      labelSet: p.labelSet === 'golden' || p.labelSet === 'standard' ? p.labelSet : null,
      thresholds: p.thresholds && typeof p.thresholds === 'object' ? p.thresholds : {},
      entries,
    };
  }

  async function setStatus(patch) {
    const cur = (await PiiraStore.get('meta', 'cloud-status')) || { id: 'cloud-status' };
    await PiiraStore.apply([{ store: 'meta', put: { ...cur, ...patch, id: 'cloud-status' } }]);
  }

  /** The project for a task: the reviewer's override, else the task name's first part. */
  async function projectFor(taskName) {
    const c = await config();
    return c.project || PIIRA.cloudShare.projectOf(taskName);
  }

  /** The team profile of a project: fresh from the server, else the cached copy (works offline). */
  async function profile(taskName, force) {
    const c = await config();
    const project = c.project || PIIRA.cloudShare.projectOf(taskName);
    const cached = await PiiraStore.get('profiles', project);
    if (!c.enabled) return { ok: false, code: 'off', project, profile: null };
    if (!force && cached && Date.now() - cached.fetchedAt < PROFILE_TTL) return { ok: true, project, profile: cached.profile, cached: true };
    const r = await call(c, 'GET', `/v1/projects/${encodeURIComponent(project)}/profile`, null,
      cached && cached.etag ? { 'If-None-Match': cached.etag } : null);
    if (r.ok && r.notModified && cached) {
      await PiiraStore.apply([{ store: 'profiles', put: { ...cached, fetchedAt: Date.now() } }]);
      await setStatus({ lastPull: Date.now(), lastError: '' });
      return { ok: true, project, profile: cached.profile };
    }
    const prof = r.ok ? cleanProfile(r.data, project) : null;
    if (prof) {
      await PiiraStore.apply([{ store: 'profiles', put: { project, profile: prof, fetchedAt: Date.now(), etag: r.etag || '' } }]);
      await setStatus({ lastPull: Date.now(), lastError: '' });
      scheduleFlush(2000);   // a good moment to send what is waiting
      return { ok: true, project, profile: prof };
    }
    await setStatus({ lastError: r.error || 'Bad profile from the server.', lastErrorAt: Date.now() });
    return { ok: false, code: r.code || 'bad-profile', error: r.error, project, profile: cached ? cached.profile : null, cached: Boolean(cached) };
  }

  /** Queue shareable corrections; anything that is not shareable is dropped here, again. */
  async function queue(taskName, items) {
    const c = await config();
    if (!c.enabled || !c.share) return { ok: true, queued: 0, reason: c.enabled ? 'sharing off' : 'sync off' };
    const project = c.project || PIIRA.cloudShare.projectOf(taskName);
    const clean = (Array.isArray(items) ? items : []).map((i) => PIIRA.cloudShare.shareItem({ ...i, from: i.detectedAs || i.from }))
      .filter(Boolean);
    if (!clean.length) return { ok: true, queued: 0 };
    const n = await PiiraStore.count('outbox');
    const room = Math.max(0, MAX_OUTBOX - n);
    await PiiraStore.apply(clean.slice(0, room).map((item) => ({ store: 'outbox', put: { project, item } })));
    scheduleFlush(30000);
    return { ok: true, queued: Math.min(room, clean.length), project };
  }

  function scheduleFlush(ms) {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => { flush().catch(() => {}); }, ms);
  }

  /** Send the outbox, oldest first, a batch per project; stop at the first failure (kept for next time). */
  async function flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      const c = await config();
      if (!c.enabled || !c.share) return { ok: false, code: 'off', sent: 0 };
      let sent = 0;
      let promoted = 0;
      for (;;) {
        const rows = await PiiraStore.head('outbox', BATCH);
        if (!rows.length) break;
        const project = rows[0].project;
        const batch = rows.filter((r) => r.project === project);
        const r = await call(c, 'POST', `/v1/projects/${encodeURIComponent(project)}/corrections`, { items: batch.map((b) => b.item) });
        if (!r.ok) {
          // A bad request will never succeed: drop it instead of blocking the queue.
          if (r.code === 'http' && r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) {
            await PiiraStore.apply(batch.map((b) => ({ store: 'outbox', del: b.id })));
            continue;
          }
          await setStatus({ lastError: r.error, lastErrorAt: Date.now() });
          return { ok: false, code: r.code, error: r.error, sent };
        }
        await PiiraStore.apply(batch.map((b) => ({ store: 'outbox', del: b.id })));
        sent += batch.length;
        promoted += (r.data && Array.isArray(r.data.promoted) ? r.data.promoted.length : 0);
        // The project list changed on the server: the next pull fetches it.
        if (r.data && r.data.version) {
          const cached = await PiiraStore.get('profiles', project);
          if (cached && cached.profile.version !== r.data.version) await PiiraStore.apply([{ store: 'profiles', put: { ...cached, fetchedAt: 0 } }]);
        }
      }
      await setStatus({ lastPush: Date.now(), lastSent: sent, lastPromoted: promoted, lastError: '' });
      return { ok: true, sent, promoted };
    })();
    try { return await flushing; } finally { flushing = null; }
  }

  async function status() {
    const c = await config();
    const [queued, st, profiles] = await Promise.all([PiiraStore.count('outbox'), PiiraStore.get('meta', 'cloud-status'), PiiraStore.all('profiles')]);
    let permitted = false;
    try { permitted = Boolean(c.endpoint && validEndpoint(c.endpoint) && await chrome.permissions.contains({ origins: [new URL(c.endpoint).origin + '/*'] })); } catch (e) { permitted = false; }
    return {
      ok: true, enabled: c.enabled, endpoint: c.endpoint, hasKey: Boolean(c.apiKey), project: c.project, share: c.share,
      policy: c.policy, permitted, queued,
      lastPull: st && st.lastPull, lastPush: st && st.lastPush, lastSent: st && st.lastSent, lastError: (st && st.lastError) || '',
      profiles: profiles.map((p) => ({ project: p.project, version: p.profile.version, entries: p.profile.entries.length, fetchedAt: p.fetchedAt })),
    };
  }

  async function test() {
    const c = await config();
    const r = await call({ ...c, enabled: true }, 'GET', '/v1/health');
    if (!r.ok) return r;
    // Health needs no key; check the key too with a harmless read.
    const p = await call({ ...c, enabled: true }, 'GET', `/v1/projects/${encodeURIComponent(c.project || 'default')}/profile`);
    return p.ok ? { ok: true, service: r.data } : { ...p, service: r.data };
  }

  return { config, saveConfig, profile, queue, flush, status, test, projectFor, validEndpoint };
})();
