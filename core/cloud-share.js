// What may leave the device for team sync, and which project a task belongs to. Loaded in the page
// (content script) and in the service worker (importScripts), so both sides apply the same rule.
//
//   Business Name         the value itself: client company and product names repeat across a project
//   "not PII" verdicts    the value, only when it reads like a plain word ("Dev", "Field Ops"): no digits,
//                         no e-mail, no link, at most 4 words
//   everything else       never (names, phones, IDs, keys, addresses stay in this browser)
//
// Document text never leaves the device; only these single values, their label and the field name.
(function (g) {
  'use strict';
  const P = g.PIIRA || (g.PIIRA = {});

  const NOT_PII = 'NOT_PII';
  const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const words = (s) => (s ? s.split(' ').length : 0);

  /** The value to share, or null when this answer must stay on the device. */
  function shareValue(label, value) {
    const v = squash(value);
    if (!v || v.length > 80 || /@|:\/\/|[<>{}]/.test(v)) return null;
    if (label === 'Business Name') return /\p{L}/u.test(v) && words(v) <= 6 ? v : null;
    if (label === NOT_PII) return /^[\p{L}][\p{L}\p{M} .&'’-]*$/u.test(v) && !/\d/.test(v) && words(v) <= 4 && v.length <= 40 ? v : null;
    return null;
  }

  /** A correction as it is sent: value, label, the label it was detected as, and the field name around it. */
  function shareItem(c) {
    if (!c) return null;
    const value = shareValue(c.label, c.value);
    if (!value) return null;
    const short = (s, n) => squash(s).slice(0, n);
    return { value, label: c.label, detectedAs: short(c.from, 60), fieldKey: short(c.fieldKey, 60), at: c.at || Date.now() };
  }

  /**
   * The project of a task: the task name's first part ("rai_codebase~~DK9__Zorvak~~app.tsx" -> "rai_codebase"),
   * or `fallback`. Lower-case, letters, digits, "_", "-" and "." only.
   */
  function projectOf(taskName, fallback) {
    const name = String(taskName || '');
    const id = name.includes('~~') ? name.split('~~')[0].toLowerCase().replace(/[^a-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64) : '';
    return id || fallback || 'default';
  }

  P.cloudShare = { NOT_PII, shareValue, shareItem, projectOf };
})(globalThis);
