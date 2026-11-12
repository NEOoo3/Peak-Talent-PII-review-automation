// Label-name tags on the LEFT document: a small pill with the label ("Person Name", "Address · model")
// above the start of each detected value, in the label's colour. Drawn in a separate layer over the
// page (fixed position, closed shadow root, clicks pass through), so the site's DOM and text — which
// the analysis reads — are never changed. Only the part of the document on screen is tagged, and the
// tags follow scrolling. Switch: "Show label names" in the extension options (on by default).
(function (g) {
  'use strict';
  const P = g.PIIRA;

  const MAX_TAGS = 300;  // tags drawn at once (the visible part of the document)
  const PREF_KEY = 'labelTags';

  let host = null;
  let layer = null;
  let current = null;    // {model, spans, container}
  let frame = 0;
  let listening = false;
  let enabled = true;

  const SHORT = { 'Vehicle Number Plate': 'Vehicle Plate', 'Person Username': 'Username' };

  const CSS_TEXT = `
    :host { all: initial; }
    .layer { position: fixed; inset: 0; pointer-events: none; overflow: hidden; }
    .tag {
      position: fixed; transform: translateY(-100%); white-space: nowrap;
      font: 600 10px/14px system-ui, -apple-system, "Segoe UI", sans-serif; letter-spacing: 0.01em;
      padding: 0 5px; border-radius: 7px; border: 1px solid var(--c);
      color: var(--c); background: #ffffffeb; box-shadow: 0 1px 2px #0000001f;
    }
    .tag.model { border-style: dashed; }
    @media (prefers-color-scheme: dark) {
      .tag { background: #1e1e1eeb; color: color-mix(in srgb, var(--c) 60%, white); }
    }
  `;

  function ensureHost() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.setAttribute('data-piira-label-tags', '');
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483645;';
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS_TEXT;
    layer = document.createElement('div');
    layer.className = 'layer';
    root.append(style, layer);
    document.documentElement.append(host);
  }

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; draw(); });
  }

  function listen() {
    if (listening) return;
    listening = true;
    addEventListener('scroll', schedule, { capture: true, passive: true });
    addEventListener('resize', schedule, { passive: true });
  }

  const firstRect = (model, span) => {
    const range = P.textModel.toRange(model, span.start, span.end);
    if (!range) return null;
    const rects = range.getClientRects();
    return rects.length ? rects[0] : null;
  };

  function draw() {
    if (!layer) return;
    layer.replaceChildren();
    if (!current || !enabled) return;
    const { model, spans, container } = current;
    if (!container || !container.isConnected || !spans.length) return;
    const box = container.getBoundingClientRect();
    const top = Math.max(box.top, 0);
    const bottom = Math.min(box.bottom, innerHeight);
    if (bottom <= top) return;

    // Text order follows vertical position: binary-search the first span on screen.
    let lo = 0;
    let hi = spans.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const r = firstRect(model, spans[mid]);
      if (r && r.bottom < top) lo = mid + 1; else hi = mid;
    }
    const placed = []; // [left, right, top] of tags drawn, to keep tags on a line from overlapping
    let n = 0;
    for (let i = lo; i < spans.length && n < MAX_TAGS; i++) {
      const s = spans[i];
      const r = firstRect(model, s);
      if (!r) continue;
      if (r.top > bottom) break;
      if (r.bottom < top || r.left > box.right || r.right < box.left) continue;
      const el = document.createElement('span');
      el.className = s.model ? 'tag model' : 'tag';
      el.textContent = (SHORT[s.label] || s.label) + (s.model ? ' · model' : '');
      el.style.setProperty('--c', P.labelInk ? P.labelInk(s.label) : P.labelInfo(s.label).color);
      el.title = s.title;
      let x = Math.max(box.left, r.left);
      const y = r.top;
      layer.append(el);
      const w = el.offsetWidth;
      for (const p of placed) if (Math.abs(p[2] - y) < 4 && x < p[1] + 2 && x + w > p[0]) x = p[1] + 2;
      if (x + w > box.right) x = Math.max(box.left, box.right - w);
      el.style.left = `${Math.round(x)}px`;
      el.style.top = `${Math.round(y - 1)}px`;
      placed.push([x, x + w, y]);
      n++;
    }
  }

  /**
   * @param model     text model of the LEFT document
   * @param findings  findings with a left range and a label (same list as the colour highlights)
   * @param hidden    labels the reviewer switched off in the panel
   */
  function render(model, findings, hidden) {
    if (!model || !model.root) { clear(); return; }
    const spans = findings
      .filter((f) => f.left && f.label && f.left.end > f.left.start && !hidden.has(f.label) && f.label !== 'Overscrubbed')
      .map((f) => ({ start: f.left.start, end: f.left.end, label: f.label, model: f.source === 'model',
        title: P.describe(f) }))
      .sort((a, b) => a.start - b.start)
      // one tag per span (a value can appear in several findings)
      .filter((s, i, a) => !i || s.start !== a[i - 1].start || s.end !== a[i - 1].end);
    current = { model, spans, container: model.root };
    ensureHost();
    listen();
    schedule();
  }

  function clear() {
    current = null;
    if (layer) layer.replaceChildren();
  }

  // The reviewer's option (extension options page); on by default.
  function readOption() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.get(PREF_KEY).then((v) => { enabled = v[PREF_KEY] !== false; schedule(); }, () => {});
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[PREF_KEY]) { enabled = changes[PREF_KEY].newValue !== false; schedule(); }
      });
    } catch (err) { /* no storage: keep the default */ }
  }
  readOption();

  P.labelTags = { render, clear, PREF_KEY };
})(globalThis);
