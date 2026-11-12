// Team sync, from the page's side. The background does the network (sw/cloud-sync.js); this file
//   - pulls the project's team list when a task opens and hands it to the learning layer
//   - queues the reviewer's shareable answers (core/cloud-share.js decides what may leave)
//   - asks for the queue to be sent when the reviewer presses the site's Submit (it never presses it)
(function (g) {
  'use strict';
  const P = g.PIIRA;

  let last = { taskName: null, at: 0 };
  let state = { enabled: false, project: '', version: 0, entries: 0, queued: 0, error: '', checked: false };
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => { try { fn(state); } catch (e) { /* ignore */ } });

  async function refreshStatus() {
    const s = await P.ext.background('cloud-status', null, 8000);
    if (!s.ok) { state = { ...state, enabled: false, checked: true, error: s.code === 'unavailable' ? '' : s.error || '' }; emit(); return state; }
    state = { ...state, enabled: s.enabled, queued: s.queued, error: s.lastError || '', checked: true, permitted: s.permitted, hasKey: s.hasKey };
    emit();
    return state;
  }

  /**
   * The team list for the task's project. Returns true when the list changed (the caller re-analyses).
   * Asks the server at most once a minute per task unless `force`.
   */
  async function pull(taskName, force) {
    if (!P.ext.available()) return false;
    if (!force && last.taskName === taskName && Date.now() - last.at < 60000) return false;
    last = { taskName, at: Date.now() };
    const r = await P.ext.background('cloud-profile', { taskName, force: Boolean(force) }, 15000);
    let changed = false;
    if (r.profile) changed = P.learning.setTeam(r.profile);
    if (r.profile) changed = applySettings(r.profile) || changed;
    state = {
      ...state, project: r.project || state.project,
      version: r.profile ? r.profile.version : 0, entries: r.profile ? r.profile.entries.length : 0,
      error: r.ok || r.code === 'off' ? '' : (r.error || r.code || ''), offline: !r.ok && Boolean(r.profile),
    };
    await refreshStatus();
    return changed;
  }

  // A project's settings from its profile (set by an administrator on the server):
  //   labelSet     'golden' | 'standard': the label set for the project, when the reviewer left it on Auto
  //   thresholds   model score cut-offs: 'model.min', 'model.add', 'model.strong' (core/hybrid.js)
  const MODEL_KEYS = { 'model.min': 'min', 'model.add': 'add', 'model.strong': 'strong' };
  let defaults = null;
  function applySettings(profile) {
    let changed = false;
    const set = profile.labelSet === 'golden' || profile.labelSet === 'standard' ? profile.labelSet : null;
    if (set !== (P.TEAM_LABEL_SET || null)) { P.TEAM_LABEL_SET = set; changed = true; }
    if (!defaults) defaults = { ...P.SETTINGS.model };
    const next = { ...defaults };
    for (const [k, v] of Object.entries(profile.thresholds || {})) {
      if (MODEL_KEYS[k] && Number.isFinite(v) && v >= 0 && v <= 1) next[MODEL_KEYS[k]] = v;
    }
    if (JSON.stringify(next) !== JSON.stringify(P.SETTINGS.model)) { P.SETTINGS.model = next; changed = true; }
    return changed;
  }

  function queue(taskName, answer) {
    const item = P.cloudShare.shareItem(answer);
    if (!item || !P.ext.available()) return;
    P.ext.background('cloud-queue', { taskName, items: [item] }, 8000).then((r) => {
      if (r && r.ok && r.queued) { state = { ...state, queued: state.queued + r.queued }; emit(); }
    });
  }

  async function flush() {
    const r = await P.ext.background('cloud-flush', null, 30000);
    await refreshStatus();
    return r;
  }

  // The site's Submit: watched, never clicked. Capture phase, so it is seen before the site reacts.
  function watchSubmit() {
    document.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest && e.target.closest('button, [role="button"], input[type="submit"]');
      if (!btn) return;
      const text = (btn.textContent || btn.value || btn.getAttribute('aria-label') || '').trim();
      if (/^(?:submit|submit (?:task|review)|complete|finish)\b/i.test(text) && state.enabled) flush();
    }, true);
  }

  P.cloud = {
    pull, queue, flush, refreshStatus, watchSubmit,
    get state() { return state; },
    onChange(fn) { listeners.add(fn); },
  };
})(globalThis);
