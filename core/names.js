// First names and surnames (data/names.js, built from Wikidata by scripts/build-names.js), so a person's
// name is recognised with no "Mr." or "Name:" in front:
//   - two or three name words together: "Suresh Patel", "Ami Babu T C", "Priya Raman"
//   - one name word where a person is meant: "Thanks Rohan", "Gupta sent the invoice", "ask Sneha to…"
// Names that are also ordinary English words ("Will", "Grace", "Brown") count only next to an
// unambiguous name, or after "Hi", "Dear", "Thanks", "cc"…
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const D = P.NAME_DATA || { first: '', last: '', ambiguous: '' };
  const set = (s) => new Set(s ? s.split(' ') : []);
  const FIRST = set(D.first);
  const LAST = set(D.last);
  const AMBIGUOUS = set(D.ambiguous);

  /** 'first' | 'last' | 'both' | 'ambiguous' | null for one capitalised word ("Divya", "GUPTA" → Gupta). */
  function kind(word) {
    const w = /^\p{Lu}+$/u.test(word) && word.length > 1 ? word[0] + word.slice(1).toLowerCase() : word;
    if (AMBIGUOUS.has(w)) return 'ambiguous';
    const f = FIRST.has(w);
    const l = LAST.has(w);
    return f && l ? 'both' : f ? 'first' : l ? 'last' : null;
  }

  P.names = { kind, size: FIRST.size + LAST.size };
})(globalThis);
