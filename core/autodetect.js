// Works out the page structure on a real task page without hand-written
// selectors:
//   findPanels()          two side-by-side elements with mostly the same words
//   detectLabelPattern()  how labeled PII spans are marked inside the RIGHT panel
//   labelSpecFor()        same, for one element the reviewer clicked
//   cssFor()              a stable CSS selector for an element
// Only page structure is inspected; nothing is stored except selectors.
(function (g) {
  'use strict';
  const P = g.PIIRA;

  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME', 'HEAD', 'META', 'LINK',
    'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'OPTION', 'IMG', 'VIDEO', 'AUDIO']);
  const HOST_ID = 'piira-host';
  const WORD_RE = /[\p{L}\p{N}]{3,}/gu;

  // ------------------------------------------------------------ selectors

  const UNSTABLE_CLASS = /^(?:css|sc|jsx|emotion|styled|tw|svelte|astro|chakra|mantine)-|^[a-z]{1,3}-?[a-z0-9]{5,}$|[0-9a-f]{6,}|^(?:active|selected|hover|focus|focused|open|opened|closed|visible|hidden|show|disabled|is-|has-)/i;
  const isStableId = (id) => id && id.length < 60 && !/\d{4,}|[0-9a-f]{8,}|^:r|^(?:ember|react|radix|headlessui|mui)/i.test(id);
  const stableClasses = (el) => [...el.classList].filter((c) => c.length < 40 && !UNSTABLE_CLASS.test(c) &&
    !(/\d/.test(c) && /[a-z]/i.test(c) && c.length >= 6)).slice(0, 3);

  function unique(sel, el, root) {
    try {
      const found = (root || document).querySelectorAll(sel);
      return found.length === 1 && found[0] === el;
    } catch (e) {
      return false;
    }
  }

  /** A short, stable, unique CSS selector for el. */
  function cssFor(el, depth) {
    depth = depth || 0;
    const tag = el.tagName.toLowerCase();
    if (isStableId(el.id) && unique('#' + CSS.escape(el.id), el)) return '#' + CSS.escape(el.id);
    for (const a of ['data-testid', 'data-test', 'data-qa', 'data-cy', 'data-test-id', 'data-panel', 'data-role', 'aria-label', 'role', 'name']) {
      const v = el.getAttribute(a);
      if (!v || v.length > 60) continue;
      const s = `${tag}[${a}="${CSS.escape(v)}"]`;
      if (unique(s, el)) return s;
    }
    const cls = stableClasses(el);
    const withCls = tag + cls.map((c) => '.' + CSS.escape(c)).join('');
    if (cls.length && unique(withCls, el)) return withCls;
    const parent = el.parentElement;
    if (!parent || parent === document.documentElement || depth > 6) return withCls;
    const sameTag = [...parent.children].filter((c) => c.tagName === el.tagName);
    const step = sameTag.length > 1 ? `${withCls}:nth-of-type(${sameTag.indexOf(el) + 1})` : withCls;
    const parentSel = parent === document.body ? 'body' : cssFor(parent, depth + 1);
    const s = `${parentSel} > ${step}`;
    return s;
  }

  // ------------------------------------------------------------ panels

  function wordSet(text) {
    const set = new Set();
    WORD_RE.lastIndex = 0;
    let m;
    let n = 0;
    while ((m = WORD_RE.exec(text)) !== null && n < 4000) { set.add(m[0].toLowerCase()); n++; }
    return set;
  }

  function jaccard(a, b) {
    let inter = 0;
    const [small, big] = a.size < b.size ? [a, b] : [b, a];
    for (const w of small) if (big.has(w)) inter++;
    return inter / (a.size + b.size - inter || 1);
  }

  /** Find the LEFT/RIGHT documents: side-by-side, not nested, mostly the same words. */
  function findPanels() {
    if (!document.body) return null;
    const vw = Math.max(document.documentElement.clientWidth, innerWidth || 0);
    const cands = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (SKIP.has(el.tagName) || el.id === HOST_ID) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 160 || r.height < 40 || r.width > vw * 0.8) continue;
      const len = el.textContent.length;
      if (len < 80) continue;
      cands.push({ el, r, len, words: null });
      if (cands.length > 1500) break;
    }
    const words = (c) => (c.words || (c.words = wordSet(c.el.textContent)));

    const pairs = [];
    for (let i = 0; i < cands.length; i++) {
      const a = cands[i];
      for (let j = 0; j < cands.length; j++) {
        if (i === j) continue;
        const b = cands[j];
        if (a.r.right > b.r.left + 8) continue;                        // a must be left of b
        const vOverlap = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (vOverlap < 0.4 * Math.min(a.r.height, b.r.height)) continue; // side by side
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const ratio = Math.min(a.len, b.len) / Math.max(a.len, b.len);
        if (ratio < 0.4) continue;
        const sim = jaccard(words(a), words(b));
        if (sim < 0.35) continue;
        pairs.push({ left: a, right: b, sim, minLen: Math.min(a.len, b.len), area: a.r.width * a.r.height + b.r.width * b.r.height });
      }
    }
    if (!pairs.length) return null;
    // Prefer pairs covering (nearly) the most text, then most similar, then the tightest box.
    const maxLen = Math.max(...pairs.map((p) => p.minLen));
    const best = pairs.filter((p) => p.minLen >= 0.85 * maxLen)
      .sort((p, q) => Math.round(q.sim * 50) - Math.round(p.sim * 50) || p.area - q.area)[0];
    return { left: best.left.el, right: best.right.el, similarity: Math.round(best.sim * 100) / 100 };
  }

  // ------------------------------------------------------------ labels

  /**
   * How does this one element carry a label name? Returns
   * {key, name, spec} or null. spec is a partial selectors object.
   */
  const BLOCK = new Set(['P', 'DIV', 'LI', 'TD', 'TH', 'TR', 'SECTION', 'ARTICLE', 'UL', 'OL', 'TABLE', 'BODY', 'MAIN',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'FORM', 'HEADER', 'FOOTER', 'ASIDE', 'NAV']);

  /** Name from a "badge" child, e.g. <span>Ravi <sup class="tag">Person Name</sup></span>; else null. */
  function badgeName(child, el, resolve) {
    if (child.children.length || BLOCK.has(el.tagName)) return null;
    const t = child.textContent.trim();
    if (!t || /^[\[<{(]/.test(t)) return null;              // "[PERSON_NAME]" is a placeholder, not a badge
    if (el.textContent.trim().length <= t.length) return null;
    if (labelSpecFor(child, resolve, true)) return null;      // the child is itself a labeled span
    return resolve(t);
  }

  const q = (s) => s.replace(/["\\]/g, '\\$&');

  function labelSpecFor(el, resolve, noBadge) {
    const tag = el.tagName.toLowerCase();
    for (const attr of el.attributes) {
      if (['class', 'style', 'id', 'href', 'src', 'role', 'type', 'for', 'name', 'autocomplete', 'rel', 'target', 'lang', 'dir', 'alt']
        .includes(attr.name)) continue;
      const name = resolve(attr.value);
      if (name) {
        return { key: 'attr:' + attr.name, name, via: `attribute ${attr.name}="${attr.value}"`,
          spec: { rightLabelSpan: `[${CSS.escape(attr.name)}]`, labelNameAttributes: [attr.name] } };
      }
    }
    for (const cls of el.classList) {
      for (let k = 0; k < cls.length; k++) {
        if (k > 0 && !/[-_]/.test(cls[k - 1])) continue;
        const name = resolve(cls.slice(k));
        if (!name) continue;
        const prefix = cls.slice(0, k);
        if (!prefix) continue; // a bare class like "person" is too ambiguous to select on
        return { key: 'class:' + prefix, name, via: `class "${cls}"`,
          spec: { rightLabelSpan: `[class^="${q(prefix)}"], [class*=" ${q(prefix)}"]`, labelClassPrefixes: [prefix] } };
      }
    }
    // A small child "badge" holding the label name: <span>Ravi <sup class="tag">Person Name</sup></span>
    if (noBadge) return null;
    for (const child of el.children) {
      const name = badgeName(child, el, resolve);
      if (!name) continue;
      const childSel = child.tagName.toLowerCase() + stableClasses(child).map((c) => '.' + CSS.escape(c)).join('');
      const elSel = tag + stableClasses(el).map((c) => '.' + CSS.escape(c)).join('');
      return { key: 'badge:' + elSel + '>' + childSel, name, via: `label text inside <${childSel}>`,
        spec: { rightLabelSpan: `${elSel}:has(> ${childSel})`, labelNameFromChild: `:scope > ${childSel}`, ignoreInText: [childSel] } };
    }
    return null;
  }

  /** Most common label pattern inside the RIGHT panel, or null. */
  function detectLabelPattern(rightEl, resolve) {
    const counts = new Map();
    const badges = new Set();
    for (const el of rightEl.querySelectorAll('*')) {
      if (SKIP.has(el.tagName) || el.textContent.length > 400) continue;
      const found = labelSpecFor(el, resolve);
      if (!found) continue;
      if (found.key.startsWith('badge:')) found.spec.ignoreInText.forEach((s) => badges.add(s));
      const cur = counts.get(found.key) || { n: 0, spec: found.spec, via: found.via };
      cur.n++;
      counts.set(found.key, cur);
      // Also record a badge on an attribute/class-labeled span, so its text is ignored.
      for (const child of el.children) {
        if (badgeName(child, el, resolve)) {
          badges.add(child.tagName.toLowerCase() + stableClasses(child).map((c) => '.' + CSS.escape(c)).join(''));
        }
      }
    }
    if (!counts.size) return null;
    const order = (k) => (k.startsWith('attr:') ? 0 : k.startsWith('class:') ? 1 : 2);
    const [key, best] = [...counts.entries()].sort((a, b) => b[1].n - a[1].n || order(a[0]) - order(b[0]))[0];
    const spec = { ...best.spec, ignoreInText: [...new Set([...(best.spec.ignoreInText || []), ...badges])] };
    return { key, count: best.n, via: best.via, spec };
  }

  P.autodetect = { findPanels, detectLabelPattern, labelSpecFor, cssFor };
})(globalThis);
