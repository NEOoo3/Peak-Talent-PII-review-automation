
//
// Uses the word alignment computed by compare.js. Pure, unit-tested in Node.
(function (g) {
  'use strict';
  const P = g.PIIRA;

  const CATEGORY = {
    LEAKAGE: 'LEAKAGE',
    INCOHERENT: 'INCOHERENT',
    DATATYPE: 'DATATYPE',
    NOT_SENSIBLE: 'NOT_SENSIBLE',
    OVER_REDACTED: 'OVER_REDACTED',
    UNSURE: 'UNSURE',
    UNKNOWN_TEXT: 'UNKNOWN_TEXT',
    TASK: 'TASK',
    REDACTED_OK: 'REDACTED_OK',
  };
  const MIN_CONFIDENCE = 0.7;

  // What the assistant suggests for each kind of finding: should the text be redacted?
  //   'redact' = it is PII, 'keep' = not PII (keep the original words), 'unsure' = employee decides
  const SUGGEST = {
    LEAKAGE: 'redact', REDACTED_OK: 'redact', INCOHERENT: 'redact', DATATYPE: 'redact', NOT_SENSIBLE: 'redact',
    OVER_REDACTED: 'keep', UNSURE: 'unsure',
  };
  const isWordy = (tok) => /[\p{L}\p{N}]/u.test(tok.t);
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

  /** Contiguous runs of unmatched tokens between matched anchors. */
  function hunks(leftTokens, rightTokens, l2r, r2l) {
    const out = [];
    let i = 0;
    let j = 0;
    const L = leftTokens.length;
    const R = rightTokens.length;
    let guard = 0;
    while ((i < L || j < R) && guard++ < L + R + 10) {
      if (i < L && j < R && l2r[i] === j) { i++; j++; continue; }
      const i0 = i;
      const j0 = j;
      while (i < L && l2r[i] === -1) i++;
      while (j < R && r2l[j] === -1) j++;
      if (i === i0 && j === j0) { // crossing matches (should not happen): step past them
        if (i < L) i++;
        if (j < R) j++;
      }
      out.push({ i0, i1: i, j0, j1: j });
    }
    return mergeAcrossPunct(out, leftTokens, rightTokens);
  }

  // "900-85-6789" -> "955-77-2468": the dashes match, which would split one changed value into
  // three. Join changes separated only by joining punctuation (- . / _) that touches them on both
  // sides; a comma or tab between cells keeps them apart.
  function mergeAcrossPunct(list, leftTokens, rightTokens) {
    const glued = (tokens, a, b) => {
      for (let k = a; k < b; k++) {
        if (!/^[-.\/_]$/.test(tokens[k].t)) return false;
        if (k > 0 && tokens[k].start !== tokens[k - 1].end) return false;
        if (k + 1 < tokens.length && tokens[k + 1].start !== tokens[k].end) return false;
      }
      return true;
    };
    const out = [];
    for (const h of list) {
      const prev = out[out.length - 1];
      if (prev && prev.i1 < h.i0 && prev.j1 < h.j0 && h.i0 - prev.i1 === h.j0 - prev.j1 && h.i0 - prev.i1 <= 3 &&
        prev.i1 > prev.i0 && h.i1 > h.i0 && glued(leftTokens, prev.i1, h.i0) && glued(rightTokens, prev.j1, h.j0)) {
        prev.i1 = h.i1;
        prev.j1 = h.j1;
      } else {
        out.push({ ...h });
      }
    }
    return out;
  }

  const ADDRESS_COMMON = new Set(('flat no house plot door road rd street st main cross nagar layout sector block lane colony ' +
    'apartment apartments apts apt floor tower society marg avenue ave phase stage near opp behind city district state ' +
    'pin pincode india bengaluru bangalore mumbai delhi chennai hyderabad pune kolkata noida gurugram karnataka maharashtra ' +
    'tamil nadu kerala telangana st nd rd th').split(' '));
  // Cities and states are not part of the PII in an address (docs/GUIDE.md): keeping them is fine.
  const isPlaceWord = (w) => ADDRESS_COMMON.has(w) || Boolean(P.addressGeo && P.addressGeo.has(w));
  // Vendor prefixes and fixed parts of keys and tokens: "SG.", "sk-ant-api03-", "ghp_", a JWT's
  // header. A fake key keeps them; only the secret part must change.
  const KEY_PREFIX = new Set(('sg sk pk rk live test proj svcacct admin ant api03 ghp gho ghu ghs ghr github pat glpat glrt glptt ' +
    'gldt glcbt glsoat xoxa xoxb xoxp xoxe xoxr xoxs npm pypi sntrys sntryu rzp gocspx shpat shpss shpca shppa xkeysib hf dckr bearer').split(' '));
  const URL_COMMON = new Set(('http https www com org net edu gov dev app io ai co in uk us html htm php asp aspx jsp ' +
    'about index home profile profiles user users page pages api docs blog post posts view watch status share link en').split(' '));
  // Platforms whose links carry a person in the path, not in the site name.
  const PLATFORMS = ['linkedin.com', 'github.com', 'gitlab.com', 'bitbucket.org', 'twitter.com', 'x.com', 'facebook.com',
    'instagram.com', 'medium.com', 'youtube.com', 'tiktok.com', 'reddit.com', 't.me', 'wa.me', 'behance.net', 'dribbble.com',
    'stackoverflow.com', 'kaggle.com', 'leetcode.com', 'hackerrank.com', 'codepen.io', 'linktr.ee', 'calendly.com',
    'google.com', 'notion.so', 'substack.com', 'about.me', 'angel.co', 'wellfound.com', 'naukri.com', 'researchgate.net'];
  const BUSINESS_COMMON = new Set(('pvt private ltd limited inc llc llp corp corporation co company group technologies technology tech ' +
    'solutions services systems industries enterprises the and of bank').split(' '));

  /**
   * Some words of a value stayed the same on the right. Is that a leak? Shared
   * structure is fine ("Flat … Apartments, 5th Cross" in a realistic fake address,
   * "+91" in a fake phone number, "@example.com"); identifying parts are not.
   * Returns a description of the leaked part, or null.
   */
  function partialLeak(d, unchanged, allWords) {
    const w = unchanged.map((t) => t.t);
    const nums = (min) => w.filter((x) => /^\d+$/.test(x) && x.length >= min);
    switch (P.baseLabel(d.label)) {   // per family: "Indian Mobile Number" follows the Contact Number rule
      case 'Contact Number': case 'Account Number':
        return nums(4).length ? nums(4).join(' ') : null;
      case 'Date': return w.filter((x) => /^\d+$/.test(x)).length >= 2 ? w.join(' ') : null;
      case 'IP Address': return w.filter((x) => /^[0-9a-f]+$/i.test(x)).length >= 3 ? w.join('.') : null;
      case 'Email Address': {
        const at = d.text.indexOf('@');
        const local = unchanged.filter((t) => t.start < d.start + at && /[\p{L}\p{N}]/u.test(t.t));
        return local.length && local.length === allWords.filter((t) => t.start < d.start + at).length ? local.map((t) => t.t).join('.') : null;
      }
      case 'Address': {
        const ident = w.filter((x) => !isPlaceWord(x) && !/^\d{1,2}$/.test(x));
        return nums(3).length || ident.length >= 2 ? ident.concat(nums(3)).join(' ') : null;
      }
      case 'Business Name': {
        const ident = w.filter((x) => !BUSINESS_COMMON.has(x));
        return ident.length ? ident.join(' ') : null;
      }
      case 'Credentials': {
        // A JWT's first part is its header ({"alg":…}), the same for every token. A run of zeros is a
        // fixed branch part ("/0001" in a CNPJ, ".000" in an NPWP), not the identifying number.
        const dot = d.type === 'JWT Token' ? d.start + d.text.indexOf('.') : -1;
        const ident = unchanged.filter((t) => t.t.length >= 2 && !KEY_PREFIX.has(t.t) && !/^0{2,}\d?$/.test(t.t) &&
          !(dot > d.start && t.end <= dot)).map((t) => t.t);
        return ident.length ? ident.join(' ') : null;
      }
      case 'URL/Link': {
        // The site of a profile link is structure ("linkedin.com/in/…"): only the path and query are personal.
        // A personal domain ("ravikumar.dev") kept unchanged is still a leak.
        const m = /^(?:[a-z][a-z0-9+.-]*:\/\/)?([^\/?#\s]+)/i.exec(d.text);
        const hostEnd = d.start + (m ? m.index + m[0].length : 0);
        const host = m ? m[1].toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '') : '';
        const platform = PLATFORMS.some((p) => host === p || host.endsWith('.' + p)) || Boolean(P.kb && P.kb.popularSite(host));
        const ident = unchanged.filter((t) => t.t.length >= 3 && !URL_COMMON.has(t.t) && !(platform && t.end <= hostEnd)).map((t) => t.t);
        return ident.length ? ident.join(' ') : null;
      }
      default: { // names, usernames, plates: any kept word is identifying
        const ident = w.filter((x) => x.length >= 2);
        return ident.length ? ident.join(' ') : null;
      }
    }
  }

  // Number values where a replacement that keeps a long run of the original digits
  // ("+91 9876012345" -> "+91 9876010000") still leaks the number.
  // Credentials count too when they are numbers (Aadhaar, SSN, CPF…).
  const DIGIT_LABELS = new Set(['Contact Number', 'Account Number']);
  function digitsKept(label, original, replacement) {
    const base = P.baseLabel(label);
    if (!DIGIT_LABELS.has(base) && !(base === 'Credentials' && /^[\d\s.\/-]+$/.test(original))) return null;
    const tail = (v) => v.replace(/\D/g, '').slice(-10); // ignore a country code
    const o = tail(original);
    const r = tail(replacement);
    if (o.length < 8 || r.length !== o.length || o === r) return null;
    let p = 0;
    while (p < o.length && o[p] === r[p]) p++;
    let q = 0;
    while (q < o.length - p && o[o.length - 1 - q] === r[r.length - 1 - q]) q++;
    if (p >= 5) return o.slice(0, p);
    if (q >= 4) return o.slice(o.length - q);
    return null;
  }

  // Values derived from content, not PII: commit hashes, UUIDs, and a git timestamp ("1772449980 +0530").
  const HASH = /^[0-9a-f]{7,64}$/i;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function derived(value, text, end) {
    const parts = String(value).trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return false;
    return parts.every((p) => (HASH.test(p) && /[a-f]/i.test(p) && /\d/.test(p)) || UUID.test(p) ||
      (/^1\d{9}$/.test(p) && /^\s+[+-]\d{4}\b/.test(text.slice(end, end + 8))));
  }

  // Same format: both ID-like values with the same kind of characters and about the same length
  // ("724878356" / "9475937994", "QC3660189" / "TX5518203"). Words are never "the same format".
  function sameShape(a, b) {
    const x = a.trim();
    const y = b.trim();
    if (!x || !y || x === y || /\s/.test(x) !== /\s/.test(y) || x.split(/\s+/).length > 3) return false;
    const digits = (s) => (s.match(/\d/g) || []).length;
    const letters = (s) => (s.match(/\p{L}/gu) || []).length;
    if (digits(x) < 4 || digits(y) < 4) return false;
    if (Math.abs(x.length - y.length) > Math.max(3, Math.round(x.length * 0.25))) return false;
    const onlyDigits = (s) => /^[\d\s.\/-]+$/.test(s);
    if (onlyDigits(x) || onlyDigits(y)) return onlyDigits(x) && onlyDigits(y);
    return letters(x) > 0 && letters(y) > 0;
  }

  const span = (tokens, a, b, fallbackPos) => (b > a
    ? { start: tokens[a].start, end: tokens[b - 1].end }
    : { start: fallbackPos, end: fallbackPos });

  /**
   * @param input {leftText, rightText, detections, alignment:{leftTokens, rightTokens, l2r, r2l}}
   * @returns {findings, stats, replacedCount, task}
   */
  function validate({ leftText, rightText, detections, alignment, hint }) {
    const { leftTokens, rightTokens, l2r, r2l } = alignment;
    const fields = P.structured.parse(leftText);
    const findings = [];
    const push = (f) => {
      if (!f.suggest && SUGGEST[f.category]) f.suggest = SUGGEST[f.category];
      f.id = `L2|${f.category}|${f.label || ''}|${f.left ? f.left.start + '-' + f.left.end : ''}|${f.right ? f.right.start + '-' + f.right.end : ''}`;
      findings.push(f);
    };
    const R = P.redactionRules;
    const confident = detections.filter((d) => d.confidence >= MIN_CONFIDENCE);
    // Names from the business names list in the original (not a detected person's surname).
    const people = detections.filter((d) => d.label === 'Person Name');
    const knownSpans = P.knownNames.findIn(leftText).filter((k) => !people.some((d) => k.start < d.end && k.end > d.start));
    const knownAt = (range) => knownSpans.find((k) => k.start < range.end && k.end > range.start) || null;

    // ---- 0. values only partly replaced ("Ravi Kumar" -> "Ravi Shah") are leaks
    const partial = new Set();
    const partialOk = [];
    const leaked = new Set();
    // Right-side text for left tokens [a..b]: between the matched neighbours on each side.
    const rightRangeFor = (d, a, b) => {
      let before = -1;
      for (let k = a - 1; k >= 0; k--) if (l2r[k] !== -1) { before = l2r[k]; break; }
      let after = rightTokens.length;
      for (let k = b + 1; k < leftTokens.length; k++) if (l2r[k] !== -1) { after = l2r[k]; break; }
      // Rewritten history changes the commit hashes around a name too: they are not its replacement.
      let j0 = before + 1;
      let j1 = after - 1;
      const skip = (j) => isWordy(rightTokens[j]) && derived(rightTokens[j].t, rightText, rightTokens[j].end);
      while (j0 < j1 && skip(j0)) j0++;
      while (j1 > j0 && skip(j1)) j1--;
      if (j1 < j0) return null;
      return { start: rightTokens[j0].start, end: rightTokens[j1].end };
    };
    for (const d of confident) {
      const a = P.util.lowerBound(leftTokens, d.start + 1, (t) => t.end);
      const idx = [];
      for (let k = a; k < leftTokens.length && leftTokens[k].start < d.end; k++) if (isWordy(leftTokens[k])) idx.push(k);
      const keptIdx = idx.filter((k) => l2r[k] !== -1);
      if (!keptIdx.length || keptIdx.length === idx.length) continue; // fully replaced, or fully kept (handled below)
      partial.add(d);
      const part = partialLeak(d, keptIdx.map((k) => leftTokens[k]), idx.map((k) => leftTokens[k]));
      if (!part) {
        // Kept only shared structure (e.g. "@example.com"): a normal replacement.
        const right = rightRangeFor(d, a, idx[idx.length - 1]);
        if (right) partialOk.push({ d, original: d.text, replacement: rightText.slice(right.start, right.end).trim(), left: { start: d.start, end: d.end }, right });
        continue;
      }
      leaked.add(d);
      const j0 = l2r[keptIdx[0]];
      const j1 = l2r[keptIdx[keptIdx.length - 1]];
      push({
        category: CATEGORY.LEAKAGE, label: d.label, type: d.type, left: { start: d.start, end: d.end },
        right: { start: rightTokens[j0].start, end: rightTokens[j1].end },
        text: d.text, confidence: d.confidence, source: d.source,
        note: `${P.describe(d)} only partly redacted: “${part}” from “${d.text}” is still visible on the right.`,
      });
    }

    // ---- 1. walk the differences between left and right
    const replacements = []; // {d, original, replacement, left, right}
    const replacedDet = new Set();
    const touched = new Set();
    for (const h of hunks(leftTokens, rightTokens, l2r, r2l)) {
      const leftPos = h.i0 < leftTokens.length ? leftTokens[h.i0].start : leftText.length;
      const rightPos = h.j0 < rightTokens.length ? rightTokens[h.j0].start : rightText.length;
      const left = span(leftTokens, h.i0, h.i1, leftPos);
      const right = span(rightTokens, h.j0, h.j1, rightPos);
      const lText = leftText.slice(left.start, left.end);
      const rText = rightText.slice(right.start, right.end);
      const dets = [];
      for (let k = P.util.lowerBound(detections, left.start + 1, (d) => d.end);
        k < detections.length && detections[k].start < left.end; k++) dets.push(detections[k]);

      if (!dets.length) {
        const lw = leftTokens.slice(h.i0, h.i1).some(isWordy);
        const rw = rightTokens.slice(h.j0, h.j1).some(isWordy);
        if (!lw && !rw) continue; // only punctuation/spacing differs
        const kind = lw && rw ? 'changed' : rw ? 'added' : 'removed';
        // Commit hashes, UUIDs and git timestamps change when history is rewritten: not PII, not over-scrubbing.
        if (kind === 'changed' && derived(lText, leftText, left.end) && derived(rText, rightText, right.end)) continue;
        // A well-known name (business names list) that was replaced or removed is over-scrubbing.
        const known = lw ? knownAt(left) : null;
        const cell = P.structured.cellAt(fields, left.start, left.end);
        if (kind === 'changed' && !known && !(cell && cell.nonPii) && sameShape(lText, rText)) {
          // A value replaced by another value of the same format ("724878356" -> "9475937994") is a
          // redaction, not over-scrubbing. The file name or the field says which type, when it can.
          const type = [hint && hint.type, cell && cell.type].find((t) => t && P.piiKeys.fitsType(t, lText.trim()));
          if (type) {
            const d = { label: P.labelOfType(type), type, start: left.start, end: left.end, text: lText.trim(), confidence: 0.8,
              source: 'context', rule: hint && type === hint.type ? 'file-name' : 'field' };
            replacedDet.add(d);
            replacements.push({ d, original: d.text, replacement: rText.trim(), left, right });
          } else {
            push({
              category: CATEGORY.UNSURE, label: null, left, right, text: lText, source: 'L2',
              note: `“${trim(lText)}” was replaced with a value of the same format (“${trim(rText)}”), but no PII type was recognised here. ` +
                'If it is PII, this is a correct redaction; if not, the original must be kept.',
            });
          }
          continue;
        }
        const knownNote = known ? ` “${known.text}” is on the business names list (${known.category}): a well-known name that must stay as it is.` : '';
        if (kind === 'changed') {
          // The right side redacted (replaced) this, but the assistant found no PII here.
          push({
            category: CATEGORY.OVER_REDACTED, label: null, left: known || left, right, text: known ? known.text : lText, source: 'L2', knownName: known,
            note: known ? `Over-scrubbing: “${trim(lText)}” was replaced with “${trim(rText)}”.${knownNote}`
              : cell && cell.nonPii ? `Over-scrubbing: “${trim(lText)}” is a ${cell.key} value, which is never PII, but it was changed to “${trim(rText)}”.`
              : `Redacted on the right (“${trim(lText)}” → “${trim(rText)}”), but no PII was found here. ` +
                'If it is not PII, the original words must be kept.',
          });
        } else {
          push({
            category: known ? CATEGORY.OVER_REDACTED : CATEGORY.UNKNOWN_TEXT, label: null,
            left: lw ? (known || left) : null, right: rw ? right : null,
            text: kind === 'added' ? rText : known ? known.text : lText, source: 'L2', knownName: known,
            note: kind === 'added' ? `Text on the right that is not in the original: “${trim(rText)}”.`
              : known ? `Over-scrubbing: “${trim(lText)}” was removed on the right.${knownNote}`
                : `Original words are missing on the right: “${trim(lText)}”.`,
          });
        }
        continue;
      }

      // Words changed around the PII (not part of any detection)?
      const outside = leftTokens.slice(h.i0, h.i1).filter((t) => isWordy(t) && !dets.some((d) => t.start < d.end && t.end > d.start) &&
        !derived(t.t, leftText, t.end));
      if (outside.length) {
        push({
          category: CATEGORY.OVER_REDACTED, label: null, left, right, text: lText, source: 'L2',
          note: `More than the PII was redacted: “${trim(lText)}” became “${trim(rText)}”. ` +
            `Words that are not PII (${trim(outside.map((t) => t.t).join(' '))}) should be kept.`,
        });
      }
      if (dets.length > 1) {
        // Several values replaced in one stretch; only check that it isn't a placeholder/mask.
        const why = R.sensible(rText);
        dets.forEach((d) => replacedDet.add(d));
        if (why) push({ category: CATEGORY.NOT_SENSIBLE, label: dets[0].label, left, right, text: lText, source: 'L2', note: `Replacement is not sensible: ${why}.` });
        continue;
      }
      const d = dets[0];
      replacedDet.add(d);
      if (!partial.has(d)) touched.add(d); // replacement text is worked out per detection below
    }
    // A value can change in several pieces ("ravi_s0" -> "user_0"); take its whole replacement at once.
    for (const d of touched) {
      const a = P.util.lowerBound(leftTokens, d.start + 1, (t) => t.end);
      let b = a;
      while (b + 1 < leftTokens.length && leftTokens[b + 1].start < d.end) b++;
      const right = rightRangeFor(d, a, b);
      replacements.push({ d, original: d.text, replacement: right ? rightText.slice(right.start, right.end).trim() : '',
        left: { start: d.start, end: d.end }, right: right || { start: 0, end: 0 } });
    }

    // ---- 2. leakage: left PII values that still appear on the right
    const byFirst = new Map();
    const seenValue = new Set();
    for (const d of confident) {
      const toks = P.compare.tokenize(d.text).map((t) => t.t);
      const key = toks.join('\u0001');
      if (!toks.length || seenValue.has(key) || d.text.replace(/\W/g, '').length < 3) continue;
      seenValue.add(key);
      if (!byFirst.has(toks[0])) byFirst.set(toks[0], []);
      byFirst.get(toks[0]).push({ toks, d });
    }
    for (let j = 0; j < rightTokens.length; j++) {
      const cands = byFirst.get(rightTokens[j].t);
      if (!cands) continue;
      for (const { toks, d } of cands) {
        let k = 0;
        while (k < toks.length && j + k < rightTokens.length && rightTokens[j + k].t === toks[k]) k++;
        if (k !== toks.length) continue;
        // whole-word match only
        const before = rightText[rightTokens[j].start - 1];
        const after = rightText[rightTokens[j + k - 1].end];
        if ((before && /[\p{L}\p{N}]/u.test(before)) || (after && /[\p{L}\p{N}]/u.test(after))) continue;
        const right = { start: rightTokens[j].start, end: rightTokens[j + k - 1].end };
        // Which left occurrence is this? The one aligned to this spot, if it has the same value.
        const li = r2l[j];
        let own = null;
        if (li !== -1) {
          const di = P.util.lowerBound(detections, leftTokens[li].start + 1, (x) => x.end);
          const cand = detections[di];
          if (cand && cand.start <= leftTokens[li].start && norm(cand.text) === norm(d.text)) own = cand;
        }
        const src = own || d;
        if (own) leaked.add(own);
        push({
          category: CATEGORY.LEAKAGE, label: src.label, type: src.type, left: { start: src.start, end: src.end }, right, text: src.text,
          confidence: src.confidence, source: src.source,
          note: own ? `${P.describe(src)} was not redacted: “${src.text}” appears unchanged on the right.`
            : `${P.describe(src)} “${src.text}” from the original appears on the right (redacted in one place, leaked in another).`,
        });
        j += k - 1;
        break;
      }
    }

    // ---- 2b. possible PII (low confidence) left exactly as it was: the employee decides
    for (const d of detections) {
      if (d.confidence >= MIN_CONFIDENCE || leaked.has(d)) continue;
      const a = P.util.lowerBound(leftTokens, d.start + 1, (t) => t.end);
      let unchanged = a < leftTokens.length;
      for (let k = a; k < leftTokens.length && leftTokens[k].start < d.end; k++) if (l2r[k] === -1) { unchanged = false; break; }
      if (!unchanged) continue;
      const j = l2r[a];
      let jb = j;
      for (let k = a; k < leftTokens.length && leftTokens[k].start < d.end; k++) jb = l2r[k];
      push({
        category: CATEGORY.UNSURE, label: d.label, type: d.type, left: { start: d.start, end: d.end },
        right: { start: rightTokens[j].start, end: rightTokens[jb].end }, text: d.text, confidence: d.confidence, source: d.source,
        note: `Not redacted on the right. Possibly ${P.describe(d)} (${Math.round(d.confidence * 100)}% sure) — decide whether it should be redacted.`,
      });
    }

    // A sentence added right after a value can end up glued to its replacement
    // ("080-4987-6543. Please also bring …"). Split it off as added text.
    for (const r of replacements.concat(partialOk)) {
      if (/[.!?]\s/.test(r.original)) continue;
      const m = /[.!?]\s+(?=\S)/.exec(r.replacement);
      if (!m) continue;
      const cut = m.index;
      const added = r.replacement.slice(cut).replace(/^[.!?]\s+/, '');
      const offset = rightText.indexOf(r.replacement, r.right.start);
      if (offset < 0) continue;
      const addStart = offset + r.replacement.indexOf(added, cut);
      r.replacement = r.replacement.slice(0, cut).trim();
      r.right = { start: offset, end: offset + cut };
      push({ category: CATEGORY.UNKNOWN_TEXT, label: null, left: null, right: { start: addStart, end: addStart + added.length },
        text: added, source: 'L2', note: `Text on the right that is not in the original: “${trim(added)}”.` });
    }

    // ---- 3. each replacement: same data type? sensible?
    const okReplacements = [];
    for (const r of replacements.concat(partialOk)) {
      if (leaked.has(r.d) && !r.replacement) continue;
      const kept = digitsKept(r.d.label, r.original, r.replacement);
      if (kept) {
        push({ category: CATEGORY.LEAKAGE, label: r.d.label, type: r.d.type, left: r.left, right: r.right, text: r.original,
          confidence: r.d.confidence, source: r.d.source, digitsKept: kept,
          note: `${P.describe(r.d)} only partly redacted: the digits “${kept}” from “${r.original}” are still visible on the right.` });
        continue;
      }
      const why = R.sensible(r.replacement);
      if (why) {
        push({ category: CATEGORY.NOT_SENSIBLE, label: r.d.label, type: r.d.type, left: r.left, right: r.right, text: r.original,
          confidence: r.d.confidence, source: r.d.source, note: `Replacement is not sensible: ${why}.` });
        continue;
      }
      if (!R.sameType(r.d.label, r.replacement, r.d.type)) {
        push({ category: CATEGORY.DATATYPE, label: r.d.label, type: r.d.type, left: r.left, right: r.right, text: r.original,
          confidence: r.d.confidence, source: r.d.source,
          note: `“${r.original}” was replaced with “${trim(r.replacement)}”, which is not a ${r.d.type || r.d.label}. The replacement should be the same kind of data.` });
        continue;
      }
      okReplacements.push(r);
    }

    // ---- 4. coherence: one original -> one replacement, and no two originals -> the same replacement
    const incoherent = new Set();
    const groupBy = (list, keyFn) => {
      const m = new Map();
      for (const x of list) { const k = keyFn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
      return m;
    };
    for (const list of groupBy(okReplacements, (r) => r.d.label + '|' + norm(r.original)).values()) {
      const variants = groupBy(list, (r) => norm(r.replacement));
      if (variants.size < 2) continue;
      const ranked = [...variants.values()].sort((a, b) => b.length - a.length);
      const main = ranked[0][0].replacement;
      const summary = ranked.map((v) => `“${trim(v[0].replacement)}” (${v.length}×)`).join(', ');
      for (const v of ranked.slice(1)) {
        for (const r of v) {
          incoherent.add(r);
          push({ category: CATEGORY.INCOHERENT, label: r.d.label, type: r.d.type, left: r.left, right: r.right, text: r.original,
            confidence: r.d.confidence, source: r.d.source,
            note: `“${r.original}” is replaced with “${trim(r.replacement)}” here, but with “${trim(main)}” elsewhere. ` +
              `The same value must get the same replacement everywhere. Seen: ${summary}.` });
        }
      }
    }
    for (const list of groupBy(okReplacements, (r) => r.d.label + '|' + norm(r.replacement)).values()) {
      const originals = groupBy(list, (r) => norm(r.original));
      if (originals.size < 2) continue;
      const ranked = [...originals.values()].sort((a, b) => b.length - a.length);
      const names = ranked.map((v) => `“${v[0].original}”`).join(' and ');
      // The value seen most often "owns" the replacement; the others are the problem.
      for (const r of ranked.slice(1).flat().filter((x) => !incoherent.has(x))) {
        incoherent.add(r);
        push({ category: CATEGORY.INCOHERENT, label: r.d.label, type: r.d.type, left: r.left, right: r.right, text: r.original,
          confidence: r.d.confidence, source: r.d.source,
          note: `Different values ${names} were all replaced with “${trim(r.replacement)}”. Different values need different replacements.` });
      }
    }
    // Person names: a part of a name must be replaced like the full name ("Ravi" -> "Arun" if "Ravi Kumar" -> "Arun Shah").
    const nameParts = new Map(); // original word -> Map(replacement word -> [r])
    for (const r of okReplacements) {
      if (r.d.label !== 'Person Name') continue;
      const ow = r.original.split(/\s+/);
      const rw = r.replacement.split(/\s+/);
      if (ow.length !== rw.length) continue;
      ow.forEach((w, i) => {
        const k = norm(w);
        if (k.length < 3) return;
        if (!nameParts.has(k)) nameParts.set(k, new Map());
        const m = nameParts.get(k);
        const rk = norm(rw[i]);
        if (!m.has(rk)) m.set(rk, []);
        m.get(rk).push(r);
      });
    }
    for (const [word, m] of nameParts) {
      if (m.size < 2) continue;
      const ranked = [...m.entries()].sort((a, b) => b[1].length - a[1].length);
      for (const [rep, list] of ranked.slice(1)) {
        for (const r of list) {
          if (incoherent.has(r)) continue;
          incoherent.add(r);
          push({ category: CATEGORY.INCOHERENT, label: r.d.label, type: r.d.type, left: r.left, right: r.right, text: r.original,
            confidence: r.d.confidence, source: r.d.source,
            note: `The name part “${word}” is replaced with “${rep}” here but “${ranked[0][0]}” elsewhere. Use the same replacement for every mention of the person.` });
        }
      }
    }

    // Changed text that reuses another value's replacement ("Shyam Verma" -> "Raj Mehta",
    // while "Ram Prasad" -> "Raj Mehta"): two different things now look the same.
    const usedFor = new Map(okReplacements.map((r) => [norm(r.replacement), r]));
    for (const f of findings) {
      if (f.category !== CATEGORY.OVER_REDACTED || !f.left || !f.right) continue;
      const other = usedFor.get(norm(rightText.slice(f.right.start, f.right.end)));
      if (!other || norm(other.original) === norm(f.text)) continue;
      f.category = CATEGORY.INCOHERENT;
      f.suggest = 'redact';
      f.label = other.d.label;
      f.note = `“${trim(f.text)}” was changed to “${trim(other.replacement)}”, which is already the replacement for “${other.original}”. ` +
        'Two different values must not get the same replacement.';
    }

    // ---- 5. correct replacements
    for (const r of okReplacements) {
      if (incoherent.has(r) || leaked.has(r.d)) continue;
      push({ category: CATEGORY.REDACTED_OK, label: r.d.label, type: r.d.type, left: r.left, right: r.right, text: r.original,
        confidence: r.d.confidence, source: r.d.source, note: `Replaced with “${trim(r.replacement)}”.` });
    }

    // ---- 6. whole-task checks
    const structure = R.structure(leftText);
    const lang = R.languageReport(leftText, { scriptOnly: Boolean(structure) });
    const task = { language: lang.verdict === 'english' ? null : lang, structure, languageReport: lang };
    if (task.language) {
      const main = lang.languages.find((l) => l.language !== 'English');
      push({ category: CATEGORY.TASK, label: null, left: null, right: null, text: `Language: ${main.language}`, source: 'L2',
        note: `Other language — sampling imperfection. ${lang.summary} Lines ${lang.where}. Flag this task.` });
    }
    if (task.structure) {
      push({ category: CATEGORY.TASK, label: null, left: null, right: null, text: 'Unstructured text', source: 'L2',
        note: `The document looks unstructured (${task.structure.reasons.join('; ')}). Flag this task.` });
    }

    // A private network address is an IP Address (PII/BII Annotation Guide). A finding on a piece of one that reads as
    // something else ("24.8.17" of 10.24.8.17 -> 10.0.0.11, a date) is neither a leak nor an over-redaction.
    const privates = P.engine && P.engine.privateIps ? P.engine.privateIps(leftText) : [];
    if (privates.length) {
      for (let i = findings.length - 1; i >= 0; i--) {
        const f = findings[i];
        if (f.left && f.category !== CATEGORY.TASK && !(f.label && P.baseLabel(f.label) === 'IP Address') &&
          privates.some(([a, b]) => f.left.start >= a && f.left.end <= b)) findings.splice(i, 1);
      }
    }
    findings.sort((a, b) => (a.left ? a.left.start : a.right ? a.right.start : -1) - (b.left ? b.left.start : b.right ? b.right.start : -1));
    const seen = new Map();
    for (const f of findings) { const n = seen.get(f.id) || 0; seen.set(f.id, n + 1); if (n) f.id += '#' + n; }

    const stats = { byCategory: {}, byLabel: {} };
    for (const c of Object.keys(CATEGORY)) stats.byCategory[c] = 0;
    for (const l of P.LABELS) stats.byLabel[l.name] = { detected: 0, labeled: 0 };
    for (const f of findings) stats.byCategory[f.category]++;
    for (const d of detections) if (stats.byLabel[d.label]) stats.byLabel[d.label].detected++;

    return { findings, stats, task, replacedCount: replacedDet.size, leakedCount: leaked.size, detectionCount: confident.length };
  }

  function trim(s) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > 80 ? s.slice(0, 79) + '…' : s;
  }

  P.redaction = { CATEGORY, validate };
})(globalThis);
