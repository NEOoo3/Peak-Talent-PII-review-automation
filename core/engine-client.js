// Runs detection off the review page (offscreen/engine-host.js) and falls back to running it here.
// The page stays responsive on large documents; the result is the same either way.
(function (g) {
  'use strict';
  const P = g.PIIRA;

  let remoteBroken = false;   // after a failure, stop trying for this page (the local engine is used)

  /**
   * Detections for `text`, like P.engine.runAsync. `current()` says whether the caller still wants the
   * answer (a newer analysis replaces this one); returns null when it does not.
   */
  async function run(text, current, opts) {
    const o = opts || {};
    if (P.ext.available() && !remoteBroken) {
      const page = await P.ext.background('ensure-model-page', null, 15000);
      if (page.ok) {
        const r = await P.ext.send({
          target: 'pii-engine', type: 'detect', key: P.util.hash(text) + ':' + text.length, text, hint: o.hint || null,
          project: o.project || null, taskClientNames: P.TASK_CLIENT_NAMES || [], learnedBusinessNames: P.LEARNED_BUSINESS_NAMES || [],
          settings: P.SETTINGS, labelSet: P.labelSet(), extraKnownNames: (P.policy.current && P.policy.current.extraKnownNames) || [],
        }, 60000);
        if (!current()) return null;
        if (r.ok && Array.isArray(r.detections)) { lastSource = 'offscreen'; lastMs = r.ms; return r.detections; }
        remoteBroken = true;
        console.warn('[PII Review Automation] offscreen detection unavailable, detecting in the page:', r.error || r.code);
      }
    }
    lastSource = 'page';
    const t0 = performance.now();
    const found = await P.engine.runAsync(text, current, o);
    lastMs = Math.round(performance.now() - t0);
    return found;
  }

  let lastSource = '';
  let lastMs = 0;

  P.engineClient = { run, get source() { return lastSource; }, get ms() { return lastMs; } };
})(globalThis);
