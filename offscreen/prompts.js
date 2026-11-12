// What the model is asked to find, and how its answers become site labels. Shared by the offscreen
// page and the Node evaluation (ml/gliner-runner.js).
(function (g) {
  'use strict';

  // [prompt, site label]. "department" gives the model a place for "Field Services" other than
  // "organization"; it is never reported.
  const PROMPTS = [
    ['person', 'Person Name'],
    ['organization', 'Business Name'],
    ['address', 'Address'],
    ['username', 'Person Username'],
    ['department', null],
  ];

  /**
   * Model entities [{label: prompt, start, end, score}] -> [{label (site label), prompt, start, end, text, score}].
   * Spans never cross a line break (the longest-lettered part is kept) and are trimmed of spaces.
   */
  function toSiteLabels(entities, text) {
    const out = [];
    for (const e of entities) {
      const label = (PROMPTS.find((p) => p[0] === e.label) || [])[1];
      if (!label) continue;
      let s = e.start;
      let end = e.end;
      const span = text.slice(s, end);
      if (span.includes('\n')) {
        let off = 0;
        let best = null;
        for (const part of span.split('\n')) {
          const n = (part.match(/\p{L}/gu) || []).length;
          if (!best || n > best.n) best = { off, len: part.length, n };
          off += part.length + 1;
        }
        s += best.off;
        end = s + best.len;
      }
      while (s < end && /\s/.test(text[s])) s++;
      while (end > s && /\s/.test(text[end - 1])) end--;
      if (end <= s) continue;
      out.push({ label, prompt: e.label, start: s, end, text: text.slice(s, end), score: Math.round(e.score * 100) / 100 });
    }
    return out.sort((a, b) => a.start - b.start);
  }

  const api = { PROMPTS, toSiteLabels };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else g.PIIRA_ML_PROMPTS = api;
})(globalThis);
