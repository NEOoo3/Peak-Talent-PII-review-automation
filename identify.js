
(function (g) {
  'use strict';
  const P = g.PIIRA;

  const CATEGORY = { PI_TODO: 'PI_TODO', BI_TODO: 'BI_TODO', CRED_TODO: 'CRED_TODO', NOT_PII: 'NOT_PII', CHECK: 'CHECK', IDENTIFIED: 'IDENTIFIED' };
  const TODO = { PI: 'PI_TODO', BI: 'BI_TODO', CRED: 'CRED_TODO' };

  /**
   * @param l1 result of compare.compareDocuments
   * @returns {findings, stats}
   */
  function fromCompare(l1) {
    const findings = [];
    for (const f of l1.findings) {
      const group = P.labelGroup(f.label);
      const todo = TODO[group] || CATEGORY.PI_TODO;
      const base = { ...f, group, id: 'L1|' + f.id };
      // Knowledge base hints, shown under Details (information only).
      const kbNote = f.kb && f.kb.publicFigure ? ` Also the name of a public figure (Wikipedia in ${f.kb.links} languages) — still PII here unless it clearly refers to them.`
        : f.kb && f.kb.company ? ` A known company (Wikipedia in ${f.kb.links} languages).` : '';
      switch (f.category) {
        case 'CORRECT':
          if (f.label === 'Overscrubbed') {
            findings.push({ ...base, category: CATEGORY.NOT_PII, status: 'extra', suggest: 'not', note: 'Marked Overscrubbed; no PII found here.' });
          } else {
            findings.push({ ...base, category: CATEGORY.IDENTIFIED, status: 'labeled', suggest: 'yes', note: `Labeled ${f.label}.${kbNote}` });
          }
          break;
        case 'MISSED':
          findings.push({ ...base, category: todo, status: 'unlabeled', suggest: 'yes', note: `Not labeled yet — label it as ${f.label}.${kbNote}` });
          break;
        case 'WRONG_LABEL':
          findings.push({ ...base, category: todo, status: 'wrong', suggest: 'yes', note: `Labeled ${f.rightLabel} — it looks like ${f.label}.` });
          break;
        case 'OVERSCRUB':
          findings.push({ ...base, category: CATEGORY.NOT_PII, group: null, status: 'extra', suggest: 'not', note: f.note });
          break;
        case 'NEEDS_REVIEW':
          if (!group || f.source === 'right') {
            findings.push({ ...base, category: CATEGORY.CHECK, status: 'check', suggest: 'unsure', note: f.note });
          } else {
            const labeled = Boolean(f.rightLabel);
            findings.push({ ...base, category: todo, status: labeled ? 'check' : 'unlabeled', suggest: 'unsure', note: f.note });
          }
          break;
        default:
          findings.push({ ...base, category: CATEGORY.CHECK, status: 'check', suggest: 'unsure' });
      }
    }
    const stats = { byCategory: {}, byLabel: l1.stats.byLabel, byGroup: { PI: 0, BI: 0, CRED: 0 } };
    for (const c of Object.keys(CATEGORY)) stats.byCategory[c] = 0;
    for (const f of findings) {
      stats.byCategory[f.category]++;
      if ((Object.values(TODO).includes(f.category) || f.category === CATEGORY.IDENTIFIED) && f.group) stats.byGroup[f.group]++;
    }
    return { findings, stats, alignment: l1.alignment };
  }

  P.identify = { CATEGORY, fromCompare };
})(globalThis);
