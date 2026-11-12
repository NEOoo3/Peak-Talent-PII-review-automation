// Date of Birth and Date. A date of birth is PII (PII/BII Annotation Guide, "Person DOB"); any other date is
// OUT OF SCOPE, reported only when PIIRA.SETTINGS.reportOutOfScope is on.
//   - Date of Birth: a date with a date-of-birth keyword (DOB, Date of Birth, born on,
//     Birthday…) right before it (same line, or the line just above) or right after it,
//     as in "14/08/1989 (DOB)".
//   - Date: any other date (joining, meeting, login, invoice…).
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const U = P.util;
  const LABEL = 'Date of Birth';

  const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?![a-z])';
  const DOB_KW = /\b(?:d\.?\s?o\.?\s?b\.?|date\s+of\s+birth|birth\s*-?\s*date|birth\s*day|b['’]?\s?day|born(?:\s+on)?)(?![a-z])/gi;
  const KW_BEFORE = 45;  // max characters between the keyword and the date
  const KW_AFTER = 15;   // "14/08/1989 (DOB)"

  // 14/08/1989 · 14-08-89 · 14.08.1989 (same separator twice)
  const DMY = /(?<![\w\/.:-])(\d{1,2})([\/.-])(\d{1,2})\2(\d{4}|\d{2})(?![\w\/:-]|\.\d)/gd;
  // 2024-03-15 · 2024/3/5
  const YMD = /(?<![\w\/.:-])(\d{4})([\/.-])(\d{1,2})\2(\d{1,2})(?![\w\/:-]|\.\d)/gd;
  // 15th March 2024 · 15 Mar, 2024 · 15-Mar-2024 · 1st of May 2024
  const D_MON_Y = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?:[ \\t]+of)?[ \\t-]+${MONTH}\\.?,?[ \\t-]+(?:\\d{4}|'\\d{2})\\b`, 'gid');
  // March 15, 2024 · Mar 15th 2024
  const MON_D_Y = new RegExp(`\\b${MONTH}\\.?[ \\t]+(\\d{1,2})(?:st|nd|rd|th)?,?[ \\t]+\\d{4}\\b`, 'gid');
  // March 2024 (capitalised month only, so "may 2024" in prose is ignored)
  const MON_Y = new RegExp(`\\b${MONTH}\\.?,?[ \\t]+(?:19|20)\\d{2}\\b`, 'gd');
  // 22nd March (no year)
  const D_MON = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[ \\t]+${MONTH}\\b`, 'gd');

  const validDay = (d) => d >= 1 && d <= 31;
  const validMonth = (m) => m >= 1 && m <= 12;
  const validYear = (y) => y.length === 2 || (+y >= 1900 && +y <= 2100);

  function candidates(text) {
    return [
      ...U.collect(text, DMY, LABEL, (v, m) => {
        const a = +m[1], b = +m[3], y = m[4];
        const ok = (validDay(a) && validMonth(b)) || (validMonth(a) && validDay(b));
        if (!ok || !validYear(y)) return null;
        let c = m[2] === '.' ? 0.85 : 0.94;
        if (y.length === 2) c -= 0.08;
        return c;
      }, 'regex', { rule: 'dob-dmy' }),
      ...U.collect(text, YMD, LABEL, (v, m) => (validYear(m[1]) && validMonth(+m[3]) && validDay(+m[4]) ? 0.95 : null),
        'regex', { rule: 'dob-ymd' }),
      ...U.collect(text, D_MON_Y, LABEL, (v, m) => (validDay(+m[1]) ? 0.95 : null), 'regex', { rule: 'dob-d-month-y' }),
      ...U.collect(text, MON_D_Y, LABEL, (v, m) => (validDay(+m[1]) ? 0.95 : null), 'regex', { rule: 'dob-month-d-y' }),
      ...U.collect(text, MON_Y, LABEL, 0.75, 'regex', { rule: 'dob-month-y' }),
      ...U.collect(text, D_MON, LABEL, (v, m) => (validDay(+m[1]) ? 0.72 : null), 'regex', { rule: 'dob-d-month' }),
    ];
  }

  /** Keep the longest date where candidates overlap ("15 March" inside "15 March 2024"). */
  function longest(list) {
    const sorted = list.slice().sort((a, b) => (b.end - b.start) - (a.end - a.start) || b.confidence - a.confidence);
    const kept = [];
    for (const d of sorted) if (!kept.some((k) => d.start < k.end && d.end > k.start)) kept.push(d);
    return kept.sort((a, b) => a.start - b.start);
  }

  // Between "DOB" and the date only punctuation, a format hint like "(dd/mm/yyyy)"
  // or a few filler words may appear — not another field ("N/A, review date …").
  const FORMAT_HINT = /\(?\s*[dmy]{1,4}(?:\s*[\/.-]\s*[dmy]{1,4}){2}\s*\)?/gi;
  const GAP_BEFORE_OK = /^[\s:=|(\[\]–-]*(?:(?:is|was|on|as|per|records?|:)[\s:=|(\[\]–-]*){0,3}$/i;
  const GAP_AFTER_OK = /^[ \t]*[(\[–-]?[ \t]*$/;   // "14/08/1989 (DOB)" or "14/08/1989 - DOB"

  function isDob(text, d, all, keywords) {
    // `all` and `keywords` are sorted by start: only look at the few nearby ones.
    const otherDateBetween = (from, to) => {
      let i = U.lowerBound(all, from, (o) => o.start);
      if (all[i] === d) i++;
      return i < all.length && all[i].start < to;
    };
    const from = U.lowerBound(keywords, d.start - KW_BEFORE - 40, (k) => k.start);
    const to = U.lowerBound(keywords, d.end + KW_AFTER + 1, (k) => k.start);
    for (let ki = from; ki < to; ki++) {
      const k = keywords[ki];
      // Keyword before the date: "DOB: 14/08/1989", "Date of Birth\n14/08/1989"
      if (k.end <= d.start && d.start - k.end <= KW_BEFORE) {
        const gap = text.slice(k.end, d.start);
        if ((gap.match(/\n/g) || []).length <= 1 && GAP_BEFORE_OK.test(gap.replace(FORMAT_HINT, ' ')) &&
          !otherDateBetween(k.end, d.start)) return true;
      }
      // Keyword right after the date: "14/08/1989 (DOB)" — unless that keyword
      // introduces its own date ("…12/05/2015, DOB 03/07/1988").
      if (k.start >= d.end && k.start - d.end <= KW_AFTER && GAP_AFTER_OK.test(text.slice(d.end, k.start))) {
        const j = U.lowerBound(all, k.end, (o) => o.start);
        const o = all[j];
        const ownsNext = Boolean(o && o.start - k.end <= KW_BEFORE &&
          GAP_BEFORE_OK.test(text.slice(k.end, o.start).replace(FORMAT_HINT, ' ')));
        if (!ownsNext) return true;
      }
    }
    return false;
  }

  /**
   * Dates can only be a DOB near a birth-date keyword, so on large documents
   * only the text around each keyword is searched (not the whole document).
   */
  function windowsAround(text, keywords) {
    const PAD = 40;
    const out = [];
    for (const k of keywords) {
      let a = Math.max(0, k.start - KW_AFTER - PAD);
      let b = Math.min(text.length, k.end + KW_BEFORE + PAD);
      while (a > 0 && !/\s/.test(text[a - 1])) a--;            // start and end on word boundaries
      while (b < text.length && !/\s/.test(text[b])) b++;
      const last = out[out.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b); else out.push([a, b]);
    }
    return out;
  }

  // Scanning a whole document for every date is only worth it when dates are reported;
  // short snippets (an overscrub check) are always scanned.
  const wantAllDates = (text) => text.length <= 200 || P.typeReported('Date');

  function detect(text) {
    const keywords = [];
    DOB_KW.lastIndex = 0;
    let m;
    while ((m = DOB_KW.exec(text)) !== null) keywords.push({ start: m.index, end: m.index + m[0].length });
    const others = () => (wantAllDates(text) ? longest(candidates(text)).map((d) => ({ ...d, label: 'Date', rule: d.rule.replace(/^dob-/, 'date-') })) : []);
    if (!keywords.length) return others();
    let found = [];
    for (const [a, b] of windowsAround(text, keywords)) {
      for (const d of candidates(text.slice(a, b))) {
        found.push({ ...d, start: d.start + a, end: d.end + a });
      }
    }
    found = longest(found);
    const dobs = found.filter((d) => isDob(text, d, found, keywords));
    return dobs.concat(others().filter((d) => !dobs.some((b) => b.start < d.end && b.end > d.start)));
  }

  U.register(LABEL, detect);
})(globalThis);
