// What the panel asks the reviewer, and what each answer means. Pure, unit-tested in Node.
//
// One review list ('ALL') holds both checks; each finding keeps the question of the check it came from:
//   label check     "Is it PII?"             Yes, <entity> / Not PII  -> a label change to make on the site
//   redaction check "Should it be redacted?" Redact / Keep            -> a fix to make in the redacted work
// 'L1' / 'L2' still name one check alone (tests, older saved reports).
(function (g) {
  'use strict';
  const P = g.PIIRA;

  // Panel sections, in the order shown. `ok` sections are the done ones, closed by default.
  const SECTIONS = {
    L1: [
      { key: 'PI_TODO', title: 'PII – Personal to identify', hint: 'Details that identify a person (name, username, email, contact number, address, URL, vehicle plate) not labeled yet, labeled differently, or to check.' },
      { key: 'BI_TODO', title: 'PII – Business to identify', hint: 'Company names not labeled yet, labeled differently, or to check.' },
      { key: 'CRED_TODO', title: 'PII – Credentials to identify', hint: 'Account numbers, government and tax IDs, keys, passwords and IP addresses (highest risk) not labeled yet, labeled differently, or to check.' },
      { key: 'NOT_PII', title: 'Labeled, but not PII?', hint: 'A label is on the page, but the assistant found no PII there. Marked with a purple wavy underline.' },
      { key: 'CHECK', title: 'Check these labels', hint: 'Labels the assistant could not read or line up with the original.' },
      { key: 'IDENTIFIED', title: 'Identified ✓', hint: 'Already labeled with the right entity.', ok: true },
    ],
    L2: [
      { key: 'TASK', title: 'Task issues', hint: 'Whole-task problems: other language (sampling imperfection) or unstructured text.' },
      { key: 'LEAKAGE', title: 'PI leakage', hint: 'PII from the original still visible on the right (not redacted, partly redacted, or leaked elsewhere). Should be redacted.' },
      { key: 'OVER_REDACTED', title: 'Redacted, but is it PII?', hint: 'The right side redacted this, but the assistant found no PII. Decide: redact, or keep the original words.' },
      { key: 'UNSURE', title: 'Possible PII, not redacted', hint: 'The assistant is not sure this is PII and the right side left it as is. Decide whether it should be redacted.' },
      { key: 'INCOHERENT', title: 'Incoherent', hint: 'The same value replaced in different ways (Ram → Raj here, Sam there), or different values given the same replacement.' },
      { key: 'DATATYPE', title: 'Wrong data type', hint: 'A value replaced by a different kind of data (e.g. a phone number replaced by a name).' },
      { key: 'NOT_SENSIBLE', title: 'Not sensible', hint: 'The replacement is not realistic text: masked (XXXX), a placeholder ([NAME]) or deleted.' },
      { key: 'UNKNOWN_TEXT', title: 'Unknown text', hint: 'Text added on the right, or original words missing. Exact words of the original must be kept.' },
      { key: 'REDACTED_OK', title: 'Redacted correctly', hint: 'PII replaced with a realistic value of the same kind, consistently.', ok: true },
    ],
  };
  // The one list: whole-task notes, what is visible but should not be, label problems, replacement
  // problems, then the done buckets.
  SECTIONS.ALL = [
    SECTIONS.L2[0],
    { key: 'LEAKAGE', title: 'PII still visible', hint: 'PII from the original still visible on the right (not redacted, partly redacted, or leaked elsewhere). Label it.' },
    ...SECTIONS.L1.slice(0, 3).map((c) => ({ ...c, title: c.title.replace(' to identify', ' – to label') })),
    SECTIONS.L1[3],
    ...SECTIONS.L2.slice(2, 8),
    SECTIONS.L1[4],
    { ...SECTIONS.L1[5], title: 'Labeled ✓' },
    SECTIONS.L2[8],
  ];
  const OK = new Set(['IDENTIFIED', 'REDACTED_OK']);

  const DECIDE = {
    L1: new Set(['PI_TODO', 'BI_TODO', 'CRED_TODO', 'NOT_PII', 'IDENTIFIED']),
    L2: new Set(['LEAKAGE', 'OVER_REDACTED', 'UNSURE', 'REDACTED_OK', 'INCOHERENT', 'DATATYPE', 'NOT_SENSIBLE']),
  };
  const REDACTED_ON_RIGHT = new Set(['OVER_REDACTED', 'REDACTED_OK', 'INCOHERENT', 'DATATYPE', 'NOT_SENSIBLE']);
  const BAD_REPLACEMENT = new Set(['INCOHERENT', 'DATATYPE', 'NOT_SENSIBLE']);

  const sections = (stage) => SECTIONS[stage] || SECTIONS.ALL;
  // The check a finding belongs to: the stage asked for, or (in the one list) the check it came from.
  const own = (f, stage) => (stage === 'L1' || stage === 'L2' ? stage : String(f.id || '').startsWith('L1|') ? 'L1' : 'L2');
  const isIssue = (f) => !OK.has(f.category);

  /** The question for an item, or null when the item is not something to decide. */
  function question(f, stage) {
    stage = own(f, stage);
    if (f.settled || !DECIDE[stage].has(f.category)) return null;
    if (stage === 'L1') {
      const group = (f.group && P.GROUP_SHORT[f.group]) || 'PII';
      return {
        ask: 'Is it PII?',
        suggestion: f.suggest === 'yes' ? `Assistant: ${group} — label it as ${f.label}${f.type && f.type !== f.label ? ` (${f.type})` : ''}`
          : f.suggest === 'not' ? 'Assistant: no PII found here' : 'Assistant: not sure — your call',
        tone: f.suggest === 'yes' ? 'redact' : f.suggest === 'not' ? 'keep' : 'unsure',
        yes: { key: 'yes', label: f.label && f.group ? `Yes, ${f.label}` : 'Yes, it is PII', title: 'It is PII of this type' },
        no: { key: 'no', label: 'Not PII', title: 'Not PII' },
      };
    }
    return {
      ask: 'Should it be redacted?',
      suggestion: { redact: 'Assistant: PII — should be redacted', keep: 'Assistant: not PII — keep the original' }[f.suggest]
        || 'Assistant: not sure — your call',
      tone: f.suggest || 'unsure',
      yes: { key: 'redact', label: 'Redact (PII)', title: 'It is PII: it should be redacted' },
      no: { key: 'keep', label: 'Keep (not PII)', title: 'Not PII: keep the original words' },
    };
  }

  /** What a decision means: {fix, kind, text}, or null when undecided. */
  function outcome(f, stage, verdict) {
    if (!verdict) return null;
    stage = own(f, stage);
    if (stage === 'L1') {
      const labeled = ['labeled', 'wrong', 'extra'].includes(f.status) || (f.status === 'check' && Boolean(f.rightLabel));
      if (verdict === 'yes') {
        if (f.status === 'unlabeled') return { fix: true, kind: 'label', text: `To do: label it as ${f.label} on the site.` };
        if (f.status === 'wrong') return { fix: true, kind: 'relabel', text: `To do: change the label from ${f.rightLabel} to ${f.label}.` };
        return { fix: false, text: f.status === 'extra' ? 'Keep the label.' : 'Identified.' };
      }
      return labeled ? { fix: true, kind: 'remove', text: 'To do: remove this label (or mark it Overscrubbed).' }
        : { fix: false, text: 'Correctly left unlabeled.' };
    }
    const redacted = REDACTED_ON_RIGHT.has(f.category);
    if (verdict === 'redact' && !redacted) return { fix: true, kind: 'missed', text: 'Missed redaction — the right side must redact this.' };
    if (verdict === 'keep' && redacted) return { fix: true, kind: 'over', text: 'Over-redaction — the right side must keep the original words.' };
    if (verdict === 'redact' && BAD_REPLACEMENT.has(f.category)) {
      return { fix: true, kind: 'quality', text: 'Correct to redact, but the replacement must be fixed.' };
    }
    return { fix: false, text: verdict === 'redact' ? 'Correctly redacted.' : 'Correctly kept as is.' };
  }

  // L2 categories where the left value was detected as PII (a "keep" answer contradicts the detector).
  const DETECTED_L2 = new Set(['LEAKAGE', 'UNSURE', 'REDACTED_OK', 'INCOHERENT', 'DATATYPE', 'NOT_SENSIBLE']);

  /**
   * What the assistant learns from an answer:
   *   {mode: 'ask'}                 remembered as not PII right away; then ask whether it is another label
   *   {mode: 'ask', pii: true}      it is PII, but no label is known: ask which one
   *   {mode: 'silent', label}       the answer agrees with a known label: remember it quietly
   *   null                          nothing to learn (no original text, or the answer was cleared)
   */
  function learnPlan(f, stage, verdict) {
    if (!verdict || !f.left || !(f.left.end > f.left.start)) return null;
    if (own(f, stage) === 'L1') {
      if (verdict === 'no') return { mode: 'ask' };
      const label = f.label || f.rightLabel;
      return label && label !== 'Overscrubbed' ? { mode: 'silent', label } : { mode: 'ask', pii: true };
    }
    if (verdict === 'keep') {
      if (DETECTED_L2.has(f.category)) return { mode: 'ask' };
      return f.category === 'OVER_REDACTED' ? { mode: 'silent', label: 'NOT_PII' } : null;
    }
    if (f.label && f.label !== 'Overscrubbed') return { mode: 'silent', label: f.label };
    return { mode: 'ask', pii: true };
  }

  /**
   * Should Auto-Fill put `label` on this finding, given the reviewer's answer? A "not PII" answer
   * stops a PII label; a "PII" answer stops an Overscrubbed label.
   */
  function allowsLabel(stage, verdict, label) {
    if (!verdict) return true;
    const saysPii = verdict === 'yes' || verdict === 'redact';
    return label === 'Overscrubbed' ? !saysPii : saysPii;
  }

  /** A two- or three-word status shown on the item's first line; the full note is under Details. */
  function short(f, stage) {
    if (f.settled) return f.label === 'Overscrubbed' ? 'Overscrubbed ✓' : 'Labeled ✓';
    if (own(f, stage) === 'L1') {
      if (f.knownName) return 'Over-scrubbing';
      return { unlabeled: 'Not labeled', wrong: `Labeled ${f.rightLabel || 'differently'}`, extra: 'Extra label',
        check: 'Check it', labeled: 'Labeled ✓' }[f.status] || 'Check it';
    }
    switch (f.category) {
      case 'LEAKAGE': return /partly/.test(f.note || '') ? 'Partly redacted' : /another/.test(f.note || '') ? 'Leaked elsewhere' : 'Not redacted';
      case 'OVER_REDACTED': return f.knownName ? 'Over-scrubbing' : 'Changed — PII?';
      case 'UNSURE': return 'Possible PII';
      case 'INCOHERENT': return 'Inconsistent';
      case 'DATATYPE': return 'Wrong data type';
      case 'NOT_SENSIBLE': return 'Not realistic';
      case 'UNKNOWN_TEXT': return /not in the original/.test(f.note || '') ? 'Text added' : 'Words missing';
      case 'REDACTED_OK': return 'Redacted ✓';
      case 'TASK': return 'Whole task';
      default: return '';
    }
  }

  /** Which answer the assistant suggests ('yes' | 'no' | 'redact' | 'keep'), or null. */
  function suggested(f, stage) {
    if (own(f, stage) === 'L1') return f.suggest === 'yes' ? 'yes' : f.suggest === 'not' ? 'no' : null;
    return f.suggest === 'redact' || f.suggest === 'keep' ? f.suggest : null;
  }

  /** Totals for the "Your identification" / "Your decisions" box. */
  function summary(findings, stage, verdicts) {
    const t = { open: 0, ok: 0, fix: 0, kinds: {}, groups: { PI: 0, BI: 0, CRED: 0 } };
    for (const f of findings) {
      if (!question(f, stage)) continue;
      const v = verdicts.get(f.id);
      const o = outcome(f, stage, v);
      if (!o) { t.open++; continue; }
      if (own(f, stage) === 'L1' && v === 'yes' && f.group) t.groups[f.group]++;
      if (o.fix) { t.fix++; t.kinds[o.kind] = (t.kinds[o.kind] || 0) + 1; } else t.ok++;
    }
    return t;
  }

  const countWords = (t) => (String(t || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’._@-]*/gu) || []).length;
  const countLines = (t) => String(t || '').split('\n').filter((l) => l.trim()).length;

  /**
   * A short brief about the two documents for the Overview card: their size, labels or
   * replacements on the right, the PII found in the original (by group and by kind), and
   * the task check. Counts only; no document text is kept.
   */
  function documentBrief({ leftText, rightText, rightLabelCount, detections, l2, taskCheck }) {
    const confident = (detections || []).filter((d) => d.confidence >= P.REVIEW_THRESHOLD);
    const groups = { PI: 0, BI: 0, CRED: 0 };
    const kinds = new Map();
    for (const d of confident) {
      const grp = P.labelGroup(d.label);
      if (grp) groups[grp]++;
      const k = d.type || d.label;
      kinds.set(k, (kinds.get(k) || 0) + 1);
    }
    const lang = taskCheck && taskCheck.language;
    return {
      left: { words: countWords(leftText), lines: countLines(leftText) },
      right: { words: countWords(rightText), lines: countLines(rightText) },
      rightLabels: rightLabelCount || 0,
      pii: confident.length,
      groups,
      topKinds: [...kinds].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([name, count]) => ({ name, count })),
      replaced: l2 ? l2.replacedCount : 0,
      leaked: l2 ? l2.leakedCount : 0,
      language: !lang ? 'English' : lang.verdict === 'english' ? 'English'
        : lang.verdict === 'other' ? 'Not English' : 'English + other language',
      structured: !(taskCheck && taskCheck.structure),
    };
  }

  /** Per-bucket counts for the Overview card: open issues (not ticked as reviewed) and the OK bucket. */
  function buckets(findings, stage, reviewed) {
    return sections(stage).map((c) => {
      const all = findings.filter((f) => f.category === c.key);
      const open = c.ok ? all.length : all.filter((f) => !reviewed.has(f.id)).length;
      return { key: c.key, title: c.title, hint: c.hint, ok: Boolean(c.ok), total: all.length, open };
    });
  }

  /** The answer that means "it is PII" for this finding: 'yes' in the label check, 'redact' in the redaction check. */
  const piiAnswer = (f, stage) => (own(f, stage) === 'L1' ? 'yes' : 'redact');

  const onSite = (f) => Boolean(f.rightLabel) || f.category === 'IDENTIFIED' || (f.category === 'NOT_PII' && f.status === 'extra');

  /**
   * One list from both checks, one finding per value:
   *   - a label already on the site (right, different, or where no PII is) is the label check's
   *     finding, and the redaction check's finding on that value is dropped;
   *   - otherwise the redaction check's finding wins; the label check's is kept only where the
   *     redaction check found nothing.
   * An Overscrubbed label where no PII was found is done ("Overscrubbed ✓"), not a question.
   */
  function merge(l1id, l2) {
    const a = (l1id && l1id.findings) || [];
    const b = (l2 && l2.findings) || [];
    const labeled = a.filter(onSite).map((f) => (f.category === 'NOT_PII' && f.label === 'Overscrubbed'
      ? { ...f, category: 'IDENTIFIED', settled: true, note: 'Marked Overscrubbed — no PII here.' } : f));
    // Which characters of the original are covered (1: a label on the site, 2: a redaction-check
    // finding): each overlap check reads its own span instead of comparing every pair of findings.
    let size = 0;
    for (const f of a.concat(b)) if (f.left && f.left.end > size) size = f.left.end;
    const taken = new Uint8Array(size + 1);
    const mark = (f, bit) => { for (let i = Math.max(0, f.left.start); i < f.left.end; i++) taken[i] |= bit; };
    const hits = (f, bit) => { for (let i = Math.max(0, f.left.start); i < f.left.end; i++) if (taken[i] & bit) return true; return false; };
    for (const f of labeled) if (f.left) mark(f, 1);
    const red = b.filter((f) => !(f.left && hits(f, 1)));
    for (const f of red) if (f.left) mark(f, 2);
    const rest = a.filter((f) => !onSite(f) && !(f.left && hits(f, 2)));
    const at = (f) => (f.left ? f.left.start : f.right ? f.right.start : -1);
    const findings = [...red, ...labeled, ...rest].sort((x, y) => at(x) - at(y));
    const byCategory = {};
    for (const f of findings) byCategory[f.category] = (byCategory[f.category] || 0) + 1;
    return { findings, stats: { byCategory }, alignment: (l2 && l2.alignment) || (l1id && l1id.alignment) };
  }

  P.decisions = { sections, isIssue, question, outcome, summary, short, suggested, documentBrief, buckets, learnPlan, allowsLabel,
    merge, piiAnswer, own };
})(globalThis);
