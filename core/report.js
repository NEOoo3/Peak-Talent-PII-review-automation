// Reporting and test data, all saved as a file on the reviewer's computer (nothing is sent anywhere):
//   - "Report" on a finding or on the select-to-check card: a small JSON file describing a wrong label or
//     missed PII, to send to the maintainer (it contains a few lines of the document).
//   - "Save task for testing": the original document plus the reviewer's answers (labels on the right,
//     Yes / Not PII decisions) as test data for `npm run score` (it contains the whole original document).
// Pure builders (unit-tested) + one download helper.
(function (g) {
  'use strict';
  const P = g.PIIRA;

  /** "2.2.0 Andromeda - Dates": the full version_name, saved in reports. */
  function version() {
    try {
      const m = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest && chrome.runtime.getManifest();
      if (m) return m.version_name || m.version;
    } catch (err) { /* not in the extension (test page, Node) */ }
    return P.VERSION || 'dev';
  }

  /** The release shown to reviewers: version_name "2.2.0 Andromeda - Dates" → {version, codename, tag}.
   *  Each approved update takes the next constellation in alphabetical order (Andromeda, Bootes, Cassiopeia…). */
  function release() {
    const v = version();
    const m = /^(\S+)\s+([A-Za-z][\w-]*)\s+-\s+(.+)$/.exec(v);
    return m ? { version: m[1], codename: m[2], tag: m[3] } : { version: v, codename: '', tag: '' };
  }

  const around =(text, start, end, n) => (text == null || start == null ? null
    : text.slice(Math.max(0, start - n), Math.min(text.length, end + n)));

  /** A finding the reviewer thinks is wrong. */
  function findingReport({ finding: f, stage, fileName, leftText, rightText, comment }) {
    return {
      format: 'pii-review-report', kind: 'finding', version: version(), created: new Date().toISOString(), stage, fileName: fileName || '',
      finding: { category: f.category, label: f.label || null, type: f.type || null, rightLabel: f.rightLabel || null, text: f.text,
        note: f.note || '', rule: f.rule || null, source: f.source || null, confidence: f.confidence ?? null },
      context: { left: f.left ? around(leftText, f.left.start, f.left.end, 200) : null, right: f.right ? around(rightText, f.right.start, f.right.end, 200) : null },
      comment: comment || '',
    };
  }

  /** A selection the reviewer checked (missed PII, or a verdict that looks wrong). */
  function selectionReport({ text, verdict, side, fileName, context, comment }) {
    return {
      format: 'pii-review-report', kind: 'selection', version: version(), created: new Date().toISOString(), fileName: fileName || '',
      selection: { text, side }, verdict, context: context || null, comment: comment || '',
    };
  }

  /**
   * The task as test data: the original text and the reviewer's answers.
   *   gold       PII the reviewer confirmed: labeled on the site and agreed, or answered Yes / Redact
   *   negatives  text the reviewer confirmed is not PII (Not PII / Keep)
   * Undecided findings are left out (counted), so the answers are partial: npm run score knows that.
   */
  function taskExport({ stage, fileName, leftText, findings, verdicts }) {
    const gold = [];
    const negatives = [];
    let undecided = 0;
    const span = (f) => ({ start: f.left.start, end: f.left.end, text: leftText.slice(f.left.start, f.left.end) });
    for (const f of findings || []) {
      if (!f.left || f.category === 'TASK') continue;
      const v = verdicts && verdicts.get ? verdicts.get(f.id) : verdicts && verdicts[f.id];
      const label = f.label === 'Overscrubbed' ? f.rightLabel : (f.label || f.rightLabel);
      if (v === 'yes' || v === 'redact') { if (label) gold.push({ label, ...span(f), source: 'decision' }); continue; }
      if (v === 'no' || v === 'keep') { negatives.push({ ...span(f), label: label || null, source: 'decision' }); continue; }
      // Undecided: only what the reviewer's own label and the assistant already agree on counts.
      if (f.category === 'IDENTIFIED' || f.category === 'REDACTED_OK') { if (label) gold.push({ label, ...span(f), source: 'agreed' }); continue; }
      undecided++;
    }
    return {
      format: 'pii-review-task', version: version(), exported: new Date().toISOString(), stage, fileName: fileName || '',
      partial: true, undecided, leftText, gold, negatives,
    };
  }

  /** Save `data` as a JSON file in the browser's downloads (no permission needed). */
  function download(name, data) {
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.documentElement.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
  }

  /** A short, safe file name part from the task's file name ("orders_export_1-csv"). */
  function slug(fileName) {
    const base = String(fileName || 'task').split('~~').pop().replace(/\.[a-z0-9]{1,5}$/i, '');
    return base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'task';
  }
  const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);

  P.report = { version, release, findingReport, selectionReport, taskExport, download, slug, stamp };
})(globalThis);
