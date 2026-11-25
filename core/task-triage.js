// TAKE / PASS for the whole task, from the team's "Task Review: Pass / Skip Guidelines".
// One verdict per file: green TAKE = review and annotate it, red PASS = skip it.
// (The guide's own words are PASS = take the task, SKIP = skip it.)
//
//   PASS  no annotations on the page, even on a small task
//   PASS  only Overscrubbed annotations and no real PII/BII (unless the scan finds PII still showing)
//   PASS  a very large document (15+ scrolls)
//   TAKE  any genuine PII/BII annotation: PII/BII is the priority, more so when it outnumbers the
//         overscrubbing or is mostly about a person
//
// "Sampling Imperfection" is judged by the reviewer; the page gives the tool no sign of it.
(function (g) {
  'use strict';
  const P = g.PIIRA;

  const MAX_SCROLLS = 15;
  const isOverscrub = (l) => /overscrub/i.test(l.label || '') || /overscrub/i.test(l.rawLabel || '');

  /**
   * Count the labels on the right document.
   * @param labels P.compare.readLabels() output ({label, rawLabel, placeholder})
   * @returns {{pii:number, person:number, over:number}} person = PII – Personal labels
   */
  function countLabels(labels) {
    const c = { pii: 0, person: 0, over: 0 };
    for (const l of labels || []) {
      if (l.placeholder) continue;
      if (isOverscrub(l)) { c.over++; continue; }
      c.pii++;
      if (P.labelGroup && P.labelGroup(l.label) === 'PI') c.person++;
    }
    return c;
  }

  /**
   * How many screens tall the document is: its scroll height over the visible height of the box
   * that scrolls it (the nearest scrolling parent, else the page).
   */
  function scrollsOf(el) {
    if (!el) return 0;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 4 && n.clientHeight > 50) {
        return n.scrollHeight / n.clientHeight;
      }
    }
    const se = document.scrollingElement || document.documentElement;
    const view = innerHeight || se.clientHeight;
    return view > 50 ? se.scrollHeight / view : 0;
  }

  /**
   * @param c {pii, person, over} from countLabels; missed = real PII the scan finds still showing;
   *        scrolls = scrollsOf(right document)
   * @returns {{verdict:'TAKE'|'PASS', reason:string}} reason is short enough for the L2 field
   */
  function decide({ pii = 0, person = 0, over = 0, missed = 0, scrolls = 0 }) {
    const n = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;
    if (scrolls >= MAX_SCROLLS) return { verdict: 'PASS', reason: `Skipped: the document is very large (about ${Math.round(scrolls)} scrolls).` };
    if (!pii && !over) return { verdict: 'PASS', reason: 'Skipped: no annotations are present in this task.' };
    if (!pii) {
      if (missed) return { verdict: 'TAKE', reason: `Only overscrubbing is labeled (${over}), but ${n(missed, 'PII/BII value')} ${missed === 1 ? 'is' : 'are'} still showing.` };
      return { verdict: 'PASS', reason: `Skipped: the task contains only overscrubbing (${n(over, 'annotation')}) and no PII/BII annotations.` };
    }
    if (pii >= over) return { verdict: 'TAKE', reason: `${n(pii, 'PII/BII annotation')} vs ${over} overscrubbing.` };
    if (person * 2 > pii) return { verdict: 'TAKE', reason: `${n(pii, 'PII/BII annotation')} vs ${over} overscrubbing; most are person information.` };
    return { verdict: 'TAKE', reason: `${n(pii, 'PII/BII annotation')} vs ${over} overscrubbing; genuine PII/BII comes first.` };
  }

  P.triage = { MAX_SCROLLS, countLabels, scrollsOf, decide };
})(globalThis);
