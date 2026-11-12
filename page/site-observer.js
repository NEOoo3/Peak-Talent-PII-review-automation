// What the reviewer changed in the site's labels since the last look, as answers to learn from:
//   label added (not by Auto-Fill) or changed to X  -> {span, answer: X}
//   Overscrubbed added, or a label changed to it     -> {span, answer: 'Overscrubbed'} (the original is not PII)
//   label removed (Overscrubbed excepted)            -> {span, answer: 'NOT_PII'}
// Labels are matched by their text, not their position, so a page that shifts offsets is fine. A sudden
// mass disappearance is the page redrawing, not the reviewer: no answers then. Pure; content.js learns them.
(function (g) {
  'use strict';
  const P = g.PIIRA;

  const normValue = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  /** The key Auto-Fill records for the labels it put on the page itself. */
  const autoKey = (label, text) => `${label}|${normValue(text)}`;

  /**
   * @param before / after  the right document's labels ({label, text, start, end, known, placeholder}) then and now
   * @param autoApplied     Set of autoKey()s Auto-Fill applied in this task (not the reviewer's answers)
   * @returns [{span, answer}] in no particular order
   */
  function diff(before, after, autoApplied) {
    if (!before || !after) return [];
    const usable = (l) => l.known && !l.placeholder && normValue(l.text);
    const prev = before.filter(usable);
    const next = after.filter(usable);
    if (!prev.length && !next.length) return [];
    if (prev.length >= 3 && next.length < prev.length / 2) return [];
    const byText = (list) => {
      const m = new Map();
      for (const l of list.slice().sort((a, b) => a.start - b.start)) {
        const k = normValue(l.text);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(l);
      }
      return m;
    };
    const a = byText(prev);
    const b = byText(next);
    const out = [];
    for (const k of new Set([...a.keys(), ...b.keys()])) {
      const was = a.get(k) || [];
      const now = b.get(k) || [];
      for (let i = 0; i < Math.max(was.length, now.length); i++) {
        const o = was[i];
        const n = now[i];
        if (o && n) { if (o.label !== n.label) out.push({ span: n, answer: n.label }); continue; }
        if (n) { if (!(autoApplied && autoApplied.has(autoKey(n.label, n.text)))) out.push({ span: n, answer: n.label }); continue; }
        if (o.label !== 'Overscrubbed') out.push({ span: o, answer: P.learning ? P.learning.NOT_PII : 'NOT_PII' });
      }
    }
    return out;
  }

  P.siteObserver = { diff, autoKey };
})(globalThis);
