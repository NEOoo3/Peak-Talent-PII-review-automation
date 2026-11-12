// Finds the task's two documents. Tried in order:
//   1. a setup saved for this site (click setup or "Looks right — save")
//   2. a setup from the organisation's policy (core/policy.js)
//   3. the selectors in selectors.js
//   4. auto-detection (two side-by-side panels with mostly the same words)
(function (g) {
  'use strict';
  const P = g.PIIRA;

  // Auto-detection walks the whole page, so it runs at most this often while nothing is found.
  const AUTODETECT_EVERY_MS = 2500;
  let lastAutodetect = 0;

  const resolver = () => P.compare.labelResolver(P.SELECTORS);

  function autodetect() {
    const now = Date.now();
    if (now - lastAutodetect < AUTODETECT_EVERY_MS) return P.config.detected;
    lastAutodetect = now;
    const panels = P.autodetect.findPanels();
    if (!panels) { P.config.setDetected(null); return null; }
    const pattern = P.autodetect.detectLabelPattern(panels.right, resolver());
    const layer = {
      leftDocument: P.autodetect.cssFor(panels.left),
      rightDocument: P.autodetect.cssFor(panels.right),
      label: pattern ? pattern.spec : null,
      labelVia: pattern ? pattern.via : '',
      similarity: panels.similarity,
    };
    P.config.setDetected(layer);
    return layer;
  }

  /** @returns {{loc, S, source:'saved'|'managed'|'selectors.js'|'auto'|'none', layer}} */
  function resolve() {
    const saved = P.config.saved;
    if (saved) {
      const S = P.config.merge(saved);
      const loc = P.dom.locate(S);
      if (loc.ok) return { loc, S, source: 'saved', layer: saved };
    }
    const managed = P.policy.current.pageSetup;
    if (managed) {
      const S = P.config.merge(managed);
      const loc = P.dom.locate(S);
      if (loc.ok) return { loc, S, source: 'managed', layer: managed };
    }
    const defaults = P.dom.locate(P.SELECTORS);
    if (defaults.ok) return { loc: defaults, S: P.SELECTORS, source: 'selectors.js', layer: null };

    let layer = P.config.detected;
    let loc = layer ? P.dom.locate(P.config.merge(layer)) : null;
    if (!loc || !loc.ok) {
      layer = autodetect();
      loc = layer ? P.dom.locate(P.config.merge(layer)) : null;
    }
    if (loc && loc.ok) {
      // No labels yet when the task opened? Look for the label pattern again.
      if (!layer.label) {
        const pattern = P.autodetect.detectLabelPattern(loc.right, resolver());
        if (pattern) { layer.label = pattern.spec; layer.labelVia = pattern.via; }
      }
      return { loc, S: P.config.merge(layer), source: 'auto', layer };
    }
    return { loc: saved ? P.dom.locate(P.config.merge(saved)) : defaults, S: null, source: 'none', layer: null };
  }

  /**
   * A task often opens with no labels yet, so no label pattern could be found.
   * Look again on each analysis until labels appear; returns true when found.
   */
  function findLabels(layout) {
    if (!layout.layer || layout.layer.label || layout.source === 'none') return false;
    const pattern = P.autodetect.detectLabelPattern(layout.loc.right, resolver());
    if (!pattern) return false;
    layout.layer = { ...layout.layer, label: pattern.spec, labelVia: pattern.via };
    layout.S = P.config.merge(layout.layer);
    if (layout.source === 'auto') P.config.setDetected(layout.layer); // so "Looks right — save" keeps it
    return true;
  }

  /** Forget the last auto-detection so the next resolve() looks at the page afresh. */
  function redetect() {
    P.config.setDetected(null);
    lastAutodetect = 0;
  }

  P.layout = { resolve, redetect, findLabels };
})(globalThis);
