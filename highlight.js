// Colour overlays using the CSS Custom Highlight API. Highlights are painted
// by the browser on top of existing text; the page's DOM and text are never
// modified. Styles live in highlight.css (injected by Chrome, unaffected by
// the site's Content-Security-Policy).
//
// Large documents: Chrome slows down badly when many thousands of highlight
// ranges are registered (every highlight change then takes seconds). So when
// a document has more than FULL_LIMIT ranges, only the part on screen plus a
// margin of two screens above and below is coloured, and the window follows
// the reviewer's scrolling.
(function (g) {
  'use strict';
  const P = g.PIIRA;

  const supported = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function';
  const FLASH = 'piira-flash';
  const RIGHT_OVERSCRUB = 'piira-right-overscrub';
  const RIGHT_ISSUE = 'piira-right-issue';
  const KNOWN_NAME = 'piira-known-name';
  const FULL_LIMIT = 1500;     // up to this many ranges per document: colour everything
  const NEED_SCREENS = 1;      // re-colour when less than this many screens are covered beyond the view
  const REGISTER_SCREENS = 2;  // ...and then colour this many screens above and below

  // name -> {key, ranges}: what is registered right now.
  const registered = new Map();
  // side -> {model, byName: Map(name -> sorted spans), all: sorted spans, priority: Map, window}
  const layers = new Map();
  let flashTimer = null;
  let scrollTimer = null;
  let listening = false;

  function clear() {
    if (P.labelTags) P.labelTags.clear(); // the label-name tags go with the colours
    if (!supported) return;
    for (const n of registered.keys()) CSS.highlights.delete(n);
    registered.clear();
    layers.clear();
  }

  const stillAttached = (ranges) => ranges.length > 0 &&
    ranges[0].startContainer.isConnected && ranges[ranges.length - 1].endContainer.isConnected;

  /** Register `spans` under `name`, unless exactly these spans are registered already. */
  function setHighlight(name, model, spans, priority) {
    const key = model.text.length + '|' + spans.map((x) => x.start + '-' + x.end).join(',');
    const prev = registered.get(name);
    if (prev && prev.key === key && stillAttached(prev.ranges)) return;
    const ranges = [];
    for (const x of spans) {
      const r = P.textModel.toRange(model, x.start, x.end);
      if (r) ranges.push(r);
    }
    if (!ranges.length) {
      CSS.highlights.delete(name);
      registered.delete(name);
      return;
    }
    const h = new Highlight(...ranges);
    if (priority) h.priority = priority;
    CSS.highlights.set(name, h);
    registered.set(name, { key, ranges });
  }

  // ------------------------------------------------------------ windowing

  /** Visible vertical band of a document container, clipped to the browser window. */
  function band(model) {
    const root = model.root;
    if (!root || !root.isConnected) return null;
    const r = root.getBoundingClientRect();
    const top = Math.max(r.top, 0);
    const bottom = Math.min(r.bottom, innerHeight);
    if (bottom <= top) return null;
    return { top, bottom, h: bottom - top };
  }

  function rectOf(model, span) {
    const range = P.textModel.toRange(model, span.start, span.end);
    return range ? range.getBoundingClientRect() : null;
  }

  /** Text-offset window covering `screens` screen-heights above and below the view. */
  function spanWindow(layer, screens) {
    const b = band(layer.model);
    const all = layer.all;
    if (!b || !all.length) return null;
    const top = b.top - screens * b.h;
    const bottom = b.bottom + screens * b.h;
    // Text order follows vertical position, so binary-search on each span's rectangle.
    let lo = 0;
    let hi = all.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const r = rectOf(layer.model, all[mid]);
      if (r && r.bottom < top) lo = mid + 1; else hi = mid;
    }
    const first = lo;
    hi = all.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const r = rectOf(layer.model, all[mid]);
      if (r && r.top <= bottom) lo = mid + 1; else hi = mid;
    }
    const last = lo - 1;
    if (last < first) return { from: 0, to: 0 };
    return { from: all[first].start, to: all[last].end };
  }

  function refreshLayer(layer) {
    let win = null; // null = colour everything
    if (layer.all.length > FULL_LIMIT) {
      const need = spanWindow(layer, NEED_SCREENS);
      const cur = layer.window;
      const covered = cur && need && need.from >= cur.from && need.to <= cur.to;
      win = covered ? cur : (need ? spanWindow(layer, REGISTER_SCREENS) : { from: 0, to: 0 });
      layer.window = win;
    }
    for (const [name, spans] of layer.byName) {
      let subset = spans;
      if (win) {
        const a = P.util.lowerBound(spans, win.from + 1, (x) => x.end);
        const z = P.util.lowerBound(spans, win.to, (x) => x.start);
        subset = spans.slice(a, z);
      }
      setHighlight(name, layer.model, subset, layer.priority.get(name) || 0);
    }
  }

  function refresh() {
    for (const layer of layers.values()) refreshLayer(layer);
  }

  function onScroll() {
    if (scrollTimer) return;
    scrollTimer = setTimeout(() => { scrollTimer = null; refresh(); }, 120);
  }

  function listen() {
    if (listening) return;
    listening = true;
    // capture: also hears scrolling inside the site's own scrollable panels
    addEventListener('scroll', onScroll, { capture: true, passive: true });
    addEventListener('resize', onScroll, { passive: true });
  }

  /**
   * @param model     text model of the LEFT document
   * @param findings  findings to colour (anything with a left range)
   * @param hidden    Set of label names the reviewer switched off
   * @param right     optional {model, findings, kind}: problems to mark on the RIGHT document.
   *                  kind 'overscrub' (label check, purple wavy) or 'issue' (redaction check, red wavy);
   *                  a finding's own `markKind` overrides it.
   *                  Or {model, named: {highlightName: {spans, priority}}} for agent mode's layers.
   * @param known     optional spans of names from the business names list, on the LEFT document
   */
  function render(model, findings, hidden, right, known) {
    if (!supported) return;
    const next = new Map();

    const left = { model, byName: new Map(), priority: new Map(), all: [], window: null };
    for (const f of findings) {
      if (!f.left || hidden.has(f.label)) continue;
      const name = `piira-${P.labelInfo(f.label).slug}`;
      if (!left.byName.has(name)) left.byName.set(name, []);
      left.byName.get(name).push(f.left);
      left.all.push(f.left);
    }
    if (known && known.length) {
      left.byName.set(KNOWN_NAME, known.map((k) => ({ start: k.start, end: k.end })));
      left.all.push(...left.byName.get(KNOWN_NAME));
    }
    next.set('left', left);

    if (right && right.model && right.named) {
      // Agent mode: several named layers on the right ({name: {spans, priority}}), e.g. pending and approved labels.
      const byName = new Map();
      const priority = new Map();
      const all = [];
      for (const [name, v] of Object.entries(right.named)) {
        const spans = v.spans.filter((s) => s && s.end > s.start);
        if (!spans.length) continue;
        byName.set(name, spans);
        priority.set(name, v.priority || 10);
        all.push(...spans);
      }
      next.set('right', { model: right.model, byName, priority, all, window: null });
    } else if (right && right.model) {
      // Each finding may carry its own kind (`markKind`); otherwise the call's kind applies.
      const byName = new Map();
      const priority = new Map();
      const all = [];
      for (const f of right.findings) {
        if (!f.right || !(f.right.end > f.right.start)) continue;
        const name = (f.markKind || right.kind) === 'issue' ? RIGHT_ISSUE : RIGHT_OVERSCRUB;
        if (!byName.has(name)) { byName.set(name, []); priority.set(name, 10); } // 10: above the site's label styling
        byName.get(name).push(f.right);
        all.push(f.right);
      }
      next.set('right', { model: right.model, byName, priority, all, window: null });
    }

    for (const [side, layer] of next) {
      for (const spans of layer.byName.values()) spans.sort((a, b) => a.start - b.start);
      layer.all.sort((a, b) => a.start - b.start);
      // Same document still shown: keep the current window (avoids re-colouring).
      const old = layers.get(side);
      if (old && old.model.root === layer.model.root) layer.window = old.window;
    }

    // Remove highlights that are no longer wanted at all.
    const wanted = new Set();
    for (const layer of next.values()) for (const n of layer.byName.keys()) wanted.add(n);
    for (const n of [...registered.keys()]) {
      if (!wanted.has(n)) { CSS.highlights.delete(n); registered.delete(n); }
    }

    layers.clear();
    for (const [k, v] of next) layers.set(k, v);
    if ([...layers.values()].some((l) => l.all.length > FULL_LIMIT)) listen();
    refresh();
  }

  // ------------------------------------------------------------ flash

  // Go to the exact text, not to the element that holds it: on the review site that element can be a whole code block or
  // document, so scrolling it into view did not move to the line (team feedback 2026-10-25). Each scrolling box around
  // the text, innermost first, is scrolled so the text sits in its middle; then the page. Instant, not smooth: a smooth
  // scroll inside nested boxes can stop halfway on a busy page.
  function scrollBox(el) {
    for (let e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      const st = getComputedStyle(e);
      if ((/(auto|scroll|overlay)/.test(st.overflowY) && e.scrollHeight > e.clientHeight + 4) ||
        (/(auto|scroll|overlay)/.test(st.overflowX) && e.scrollWidth > e.clientWidth + 4)) return e;
    }
    return null;
  }
  function scrollTo(range) {
    const node = range.startContainer;
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el) return;
    let rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) { el.scrollIntoView({ block: 'center', inline: 'nearest' }); return; }
    for (let box = scrollBox(el), guard = 0; box && guard < 8; box = scrollBox(box.parentElement), guard++) {
      const b = box.getBoundingClientRect();
      const dy = (rect.top + rect.height / 2) - (b.top + box.clientHeight / 2);
      const dx = rect.left < b.left + 8 || rect.right > b.left + box.clientWidth - 8 ? rect.left - b.left - 40 : 0;
      if (Math.abs(dy) > 2 || dx) box.scrollBy({ top: dy, left: dx, behavior: 'auto' });
      rect = range.getBoundingClientRect();
    }
    if (rect.top < 60 || rect.bottom > innerHeight - 20) {
      window.scrollBy({ top: (rect.top + rect.height / 2) - innerHeight / 2, behavior: 'auto' });
    }
  }

  /** Scroll to and blink the given ranges (one per document side). */
  function flash(ranges) {
    ranges = ranges.filter(Boolean);
    if (!ranges.length) return false;
    ranges.forEach(scrollTo);
    if (!supported) return true;
    const h = new Highlight(...ranges);
    h.priority = 100;
    let n = 0;
    clearInterval(flashTimer);
    CSS.highlights.set(FLASH, h);
    flashTimer = setInterval(() => {
      n++;
      if (n >= 7) { clearInterval(flashTimer); CSS.highlights.delete(FLASH); return; }
      if (n % 2) CSS.highlights.delete(FLASH); else CSS.highlights.set(FLASH, h);
    }, 280);
    return true;
  }

  P.highlight = { supported, render, clear, flash };
})(globalThis);
