// Turns a document container into plain text, keeping a map from every text
// character back to its DOM text node so we can highlight and scroll to a
// detection without ever modifying the page.
(function (g) {
  'use strict';
  const P = g.PIIRA;

  const BLOCK = new Set(['ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE',
    'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION',
    'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'TR', 'UL', 'CAPTION']);
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME', 'OBJECT', 'BUTTON', 'INPUT',
    'SELECT', 'TEXTAREA', 'IMG', 'VIDEO', 'AUDIO']);
  const HOST_ID = 'piira-host';

  // The review site's own panel chrome, when the detected document panel includes it: the file heading
  // ("right.gitignore-3143dca5"), "Reference · read-only", "Annotate here", "20 annotations". Matched by
  // text, so it works whatever class names the site uses; only small elements are checked.
  const CHROME = [
    /^(?:left|right|original|reviewed|redacted)\.[\w.~@-]*-[0-9a-f]{6,}$/i,
    /^(?:reference|annotations?|original|reviewed)\s*[·•|-]\s*read-only$/i,
    /^annotate here$/i,
    /^\d+\s+annotations?$/i,
    /^\d+\s+match(?:es)?\s+in the (?:left|right) document$/i,
  ];
  /** Is this short text the site's panel chrome rather than document text? */
  function isPanelChrome(t) {
    const v = String(t || '').replace(/\s+/g, ' ').trim();
    return v.length > 0 && v.length <= 120 && CHROME.some((re) => re.test(v));
  }

  /**
   * @param {Element} root
   * @param {string} ignoreSelector  elements whose text is not document text
   * @returns {{text, segments, nodeIndex, root}}
   */
  function build(root, ignoreSelector) {
    const parts = [];
    const segments = [];
    let len = 0;
    let lastChar = '\n';
    const preCache = new WeakMap();

    const push = (s) => { parts.push(s); len += s.length; lastChar = s[s.length - 1]; };
    const newline = () => { if (len > 0 && lastChar !== '\n') push('\n'); };

    const isPre = (el) => {
      if (!el) return false;
      if (preCache.has(el)) return preCache.get(el);
      let v = false;
      try { v = /^(pre|break-spaces)/.test(getComputedStyle(el).whiteSpace); } catch (e) { v = false; }
      preCache.set(el, v);
      return v;
    };

    const matchesIgnore = (el) => {
      if (!ignoreSelector) return false;
      try { return el.matches(ignoreSelector); } catch (e) { return false; }
    };

    function text(node) {
      const raw = node.data;
      if (!raw) return;
      if (isPre(node.parentElement)) {
        segments.push({ node, start: len, end: len + raw.length, map: null });
        push(raw);
        return;
      }
      let out = '';
      const map = [];
      let prev = lastChar;
      for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '\f' || ch === ' ') {
          if (prev === ' ' || prev === '\n' || prev === '\t') continue;
          out += ' ';
          map.push(i);
          prev = ' ';
        } else {
          out += ch;
          map.push(i);
          prev = ch;
        }
      }
      if (!out) return;
      segments.push({ node, start: len, end: len + out.length, map: Int32Array.from(map) });
      push(out);
    }

    function walk(node) {
      if (node.nodeType === 3) { text(node); return; }
      if (node.nodeType !== 1) return;
      const el = node;
      if (SKIP.has(el.tagName) || el.id === HOST_ID || el.hidden || matchesIgnore(el)) return;
      if (el !== root && el.childElementCount < 8 && isPanelChrome(el.textContent)) return;
      if (el.tagName === 'BR') { push('\n'); return; }
      const block = BLOCK.has(el.tagName);
      if (block) newline();
      if ((el.tagName === 'TD' || el.tagName === 'TH') && len > 0 && lastChar !== '\n' && lastChar !== '\t') push('\t');
      for (let c = el.firstChild; c; c = c.nextSibling) walk(c);
      if (block) newline();
    }

    walk(root);
    const nodeIndex = new Map();
    segments.forEach((s, i) => nodeIndex.set(s.node, i));
    return { text: parts.join(''), segments, nodeIndex, root };
  }

  // First segment whose end > pos.
  function firstSegAfter(segs, pos) {
    let lo = 0;
    let hi = segs.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (segs[mid].end > pos) hi = mid; else lo = mid + 1; }
    return lo < segs.length ? lo : -1;
  }
  // Last segment whose start <= pos.
  function lastSegBefore(segs, pos) {
    let lo = 0;
    let hi = segs.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (segs[mid].start <= pos) lo = mid + 1; else hi = mid; }
    return lo - 1;
  }
  const raw = (seg, i) => (seg.map ? seg.map[i] : i);

  /** DOM Range for text offsets [start, end), or null if the DOM changed. */
  function toRange(model, start, end) {
    const segs = model.segments;
    if (!segs.length || end <= start) return null;
    const si = firstSegAfter(segs, start);
    const ei = lastSegBefore(segs, end - 1);
    if (si < 0 || ei < 0 || si > ei) return null;
    const s = segs[si];
    const e = segs[ei];
    if (!s.node.isConnected || !e.node.isConnected) return null;
    try {
      const r = document.createRange();
      r.setStart(s.node, raw(s, Math.max(start, s.start) - s.start));
      r.setEnd(e.node, raw(e, Math.min(end, e.end) - e.start - 1) + 1);
      return r;
    } catch (err) {
      return null;
    }
  }

  /** Text offsets covered by an element, or null. */
  function rangeOfElement(model, el) {
    let start = Infinity;
    let end = -Infinity;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = model.nodeIndex.get(n);
      if (i === undefined) continue;
      const seg = model.segments[i];
      start = Math.min(start, seg.start);
      end = Math.max(end, seg.end);
    }
    if (start === Infinity) return null;
    // Trim surrounding whitespace.
    while (start < end && /\s/.test(model.text[start])) start++;
    while (end > start && /\s/.test(model.text[end - 1])) end--;
    return end > start ? { start, end } : null;
  }

  /** Text offset in a text model for a DOM position inside one of its text nodes, or -1. */
  function offsetOf(model, node, off) {
    const i = model.nodeIndex.get(node);
    if (i === undefined) return -1;
    const seg = model.segments[i];
    if (!seg.map) return seg.start + Math.min(off, seg.end - seg.start);
    let k = 0;
    while (k < seg.map.length && seg.map[k] < off) k++;
    return seg.start + k;
  }

  P.textModel = { build, toRange, rangeOfElement, isPanelChrome, offsetOf };
})(globalThis);
