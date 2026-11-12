
(function (g) {
  'use strict';
  const P = g.PIIRA;

  const CATEGORY = {
    MISSED: 'MISSED',
    WRONG_LABEL: 'WRONG_LABEL',
    OVERSCRUB: 'OVERSCRUB',
    NEEDS_REVIEW: 'NEEDS_REVIEW',
    CORRECT: 'CORRECT',
  };
  const CORRECT_IOU = 0.8;      // span agreement needed to call a label CORRECT
  const MAX_GAP_TOKENS = 60;    // a placeholder can replace at most this many words
  const MAX_D = 1500;           // Myers edit-distance budget before falling back

  // ---------------------------------------------------------------- labels

  const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  function labelResolver(selectors) {
    const map = new Map();
    // Type names and the PII type list's names ("pan_business"), as the label they get in this label set.
    for (const t of P.TYPES) map.set(normalize(t.name), P.labelOfType(t.name));
    for (const [k, t] of Object.entries(P.TYPE_KEYS || {})) map.set(normalize(k), P.labelOfType(t));
    const aliases = (selectors && selectors.labelAliases) || {};
    for (const k of Object.keys(aliases)) map.set(normalize(k), aliases[k]);
    // The labels of the current set, by their exact names, win over every alias: on the Golden site
    // "Password" and "GPS Coordinates" are labels of their own, not Credentials and Address.
    for (const l of P.activeLabels()) map.set(normalize(l.name), l.name);
    return (raw) => map.get(normalize(raw)) || null;
  }

  // 'types' mode: say how a right label differs from the detected type.
  function typeNote(label, d) {
    if (P.SETTINGS.labelMode !== 'types') return null;
    if (P.broadLabel(label) === P.broadLabel(d.label)) {
      return `Labeled ${label}, but the value looks like ${P.describe(d)} — same family, different type.`;
    }
    return null;
  }

  function placeholderRegex(selectors) {
    const src = selectors && selectors.placeholderPattern;
    if (!src) return null;
    try { return new RegExp(src, 'g'); } catch (e) { return null; }
  }

  /** Is this span's text a placeholder ("[PERSON_NAME]", "<EMAIL>", "XXXX") rather than original text? */
  function isPlaceholderText(text, resolve, phRe) {
    const t = text.trim();
    if (!t) return true;
    if (phRe) {
      phRe.lastIndex = 0;
      const m = phRe.exec(t);
      if (m && m.index === 0 && m[0].length === t.length) return true;
    }
    if (/^[\[<{(].*[\]>})]$/.test(t) && resolve(t.slice(1, -1))) return true;
    return false;
  }

  /**
   * Read the labels on the right document (the left one is the raw original and has none).
   * Returns [{label, rawLabel, start, end, text, placeholder, known}] in that document's text offsets.
   */
  function readLabels(root, model, S) {
    const resolve = labelResolver(S);
    const phRe = placeholderRegex(S);
    const out = [];
    const selector = (S.rightLabelSpan || []).join(',');
    let els = [];
    if (selector) {
      try { els = [...root.querySelectorAll(selector)]; } catch (e) { els = []; }
    }
    // Keep only the outermost labeled element when spans are nested.
    const elSet = new Set(els);
    els = els.filter((el) => {
      for (let p = el.parentElement; p && p !== root; p = p.parentElement) if (elSet.has(p)) return false;
      return true;
    });

    const covered = [];
    for (const el of els) {
      const range = P.textModel.rangeOfElement(model, el);
      if (!range) continue;
      const raw = readLabelName(el, S, resolve);
      if (!raw) continue; // matched the selector but carries no label name (e.g. an unrelated class)
      const text = model.text.slice(range.start, range.end);
      const label = resolve(raw);
      out.push({
        label: label || raw || 'Unknown',
        rawLabel: raw || '',
        known: Boolean(label),
        start: range.start,
        end: range.end,
        text,
        placeholder: isPlaceholderText(text, resolve, phRe),
      });
      covered.push([range.start, range.end]);
    }

    // Free-text placeholders such as "[PERSON_NAME]" not inside a labeled span.
    if (phRe) {
      phRe.lastIndex = 0;
      let m;
      while ((m = phRe.exec(model.text)) !== null) {
        const s = m.index;
        const e = s + m[0].length;
        if (covered.some(([a, b]) => s < b && e > a)) continue;
        const label = resolve(m[1]);
        if (!label) continue; // e.g. "[1]" footnotes
        out.push({ label, rawLabel: m[1], known: true, start: s, end: e, text: m[0], placeholder: true });
      }
    }
    return out.sort((a, b) => a.start - b.start);
  }

  function readLabelName(el, S, resolve) {
    let firstRaw = '';
    if (S.labelNameFromChild) {
      let child = null;
      try { child = el.querySelector(S.labelNameFromChild); } catch (e) { child = null; }
      const t = child && child.textContent.trim();
      if (t && resolve(t)) return t;
    }
    for (const attr of S.labelNameAttributes || []) {
      const v = el.getAttribute(attr);
      if (!v) continue;
      if (resolve(v)) return v;
      if (!firstRaw) firstRaw = v;
    }
    for (const cls of el.classList || []) {
      for (const prefix of S.labelClassPrefixes || []) {
        if (cls.startsWith(prefix) && resolve(cls.slice(prefix.length))) return cls.slice(prefix.length);
      }
    }
    return firstRaw;
  }

  // ---------------------------------------------------------------- tokens

  // Letters + combining marks (Devanagari/Tamil vowel signs…) + digits form one word.
  const TOKEN_RE = /[\p{L}\p{M}\p{N}]+|[^\s\p{L}\p{M}\p{N}]/gu;

  function tokenize(text) {
    const out = [];
    TOKEN_RE.lastIndex = 0;
    let m;
    while ((m = TOKEN_RE.exec(text)) !== null) {
      out.push({ t: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
    }
    return out;
  }

  const isPunct = (tok) => !/[\p{L}\p{N}]/u.test(tok.t);

  /** Indices of tokens overlapping [start, end). */
  function tokenSpan(tokens, start, end) {
    const first = P.util.lowerBound(tokens, start + 1, (t) => t.end);   // first token ending after start
    if (first >= tokens.length || tokens[first].start >= end) return null;
    const last = P.util.lowerBound(tokens, end, (t) => t.start) - 1;     // last token starting before end
    return last >= first ? [first, last] : null;
  }

  // ---------------------------------------------------------------- diff

  /** Myers O(ND) diff. Pushes matched [ai, bi] pairs; returns false if over budget. */
  function myers(a, b, aOff, bOff, maxD, pairs) {
    const n = a.length;
    const m = b.length;
    if (!n || !m) return true;
    const max = n + m;
    const offset = max + 1;
    const v = new Int32Array(2 * max + 3);
    const trace = [];
    const limit = Math.min(max, maxD);
    for (let d = 0; d <= limit; d++) {
      for (let k = -d; k <= d; k += 2) {
        let x;
        if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1];
        else x = v[offset + k - 1] + 1;
        let y = x - k;
        while (x < n && y < m && a[x] === b[y]) { x++; y++; }
        v[offset + k] = x;
        if (x >= n && y >= m) {
          trace.push(v.slice(offset - d, offset + d + 1));
          backtrack(trace, n, m, aOff, bOff, pairs);
          return true;
        }
      }
      trace.push(v.slice(offset - d, offset + d + 1));
    }
    return false;
  }

  function backtrack(trace, n, m, aOff, bOff, pairs) {
    let x = n;
    let y = m;
    for (let d = trace.length - 1; d > 0; d--) {
      const prev = trace[d - 1];
      const get = (kk) => prev[kk + (d - 1)];
      const k = x - y;
      const prevK = (k === -d || (k !== d && get(k - 1) < get(k + 1))) ? k + 1 : k - 1;
      const prevX = get(prevK);
      const prevY = prevX - prevK;
      while (x > prevX && y > prevY) { x--; y--; pairs.push([x + aOff, y + bOff]); }
      x = prevX;
      y = prevY;
    }
    while (x > 0 && y > 0) { x--; y--; pairs.push([x + aOff, y + bOff]); }
  }

  /** Tokens that occur exactly once on each side, kept in increasing order on both (LIS). */
  function patienceAnchors(a, b, a0, a1, b0, b1) {
    const ca = new Map();
    const cb = new Map();
    for (let i = a0; i < a1; i++) { const e = ca.get(a[i]); ca.set(a[i], e ? { n: e.n + 1, i } : { n: 1, i }); }
    for (let j = b0; j < b1; j++) { const e = cb.get(b[j]); cb.set(b[j], e ? { n: e.n + 1, i: j } : { n: 1, i: j }); }
    const cands = [];
    for (const [tok, ea] of ca) {
      const eb = cb.get(tok);
      if (ea.n === 1 && eb && eb.n === 1) cands.push([ea.i, eb.i]);
    }
    cands.sort((p, q) => p[0] - q[0]);
    // Longest increasing subsequence on b-index.
    const tails = [];
    const prev = new Array(cands.length).fill(-1);
    const tailIdx = [];
    for (let i = 0; i < cands.length; i++) {
      const bj = cands[i][1];
      let lo = 0;
      let hi = tails.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < bj) lo = mid + 1; else hi = mid; }
      tails[lo] = bj;
      tailIdx[lo] = i;
      prev[i] = lo > 0 ? tailIdx[lo - 1] : -1;
    }
    const out = [];
    for (let i = tails.length ? tailIdx[tails.length - 1] : -1; i !== -1; i = prev[i]) out.push(cands[i]);
    return out.reverse();
  }

  /** Align two token-string arrays. Returns {aToB, bToA} index maps (-1 = unmatched). */
  function alignTokens(a, b) {
    const pairs = [];
    let s = 0;
    while (s < a.length && s < b.length && a[s] === b[s]) { pairs.push([s, s]); s++; }
    let ea = a.length;
    let eb = b.length;
    while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; pairs.push([ea, eb]); }

    const solve = (a0, a1, b0, b1, depth) => {
      if (a0 >= a1 || b0 >= b1) return;
      if (myers(a.slice(a0, a1), b.slice(b0, b1), a0, b0, MAX_D, pairs)) return;
      if (depth > 4) return;
      const anchors = patienceAnchors(a, b, a0, a1, b0, b1);
      let pa = a0;
      let pb = b0;
      for (const [ai, bi] of anchors) {
        solve(pa, ai, pb, bi, depth + 1);
        pairs.push([ai, bi]);
        pa = ai + 1;
        pb = bi + 1;
      }
      if (anchors.length) solve(pa, a1, pb, b1, depth + 1);
    };
    solve(s, ea, s, eb, 0);

    const aToB = new Int32Array(a.length).fill(-1);
    const bToA = new Int32Array(b.length).fill(-1);
    for (const [i, j] of pairs) { aToB[i] = j; bToA[j] = i; }
    return { aToB, bToA };
  }

  /**
   * Map a token range [first,last] on side X to a character range on side Y.
   * Uses matched tokens inside the range; if none matched (placeholder or
   * rewritten text), uses the unmatched gap between the nearest matched
   * neighbours.
   */
  function mapTokenRange(first, last, xToY, yTokens) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = first; i <= last; i++) {
      const j = xToY[i];
      if (j >= 0) { lo = Math.min(lo, j); hi = Math.max(hi, j); }
    }
    let exact = true;
    if (lo === Infinity) {
      exact = false;
      let before = -1;
      for (let i = first - 1; i >= 0; i--) if (xToY[i] >= 0) { before = xToY[i]; break; }
      let after = yTokens.length;
      for (let i = last + 1; i < xToY.length; i++) if (xToY[i] >= 0) { after = xToY[i]; break; }
      lo = before + 1;
      hi = after - 1;
      while (lo <= hi && isPunct(yTokens[lo])) lo++;
      while (hi >= lo && isPunct(yTokens[hi])) hi--;
      if (lo > hi || hi - lo + 1 > MAX_GAP_TOKENS) return null;
    }
    return { start: yTokens[lo].start, end: yTokens[hi].end, exact };
  }

  // ---------------------------------------------------------------- compare

  const overlapLen = (a, b) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  const iou = (a, b) => {
    const o = overlapLen(a, b);
    return o / (Math.max(a.end, b.end) - Math.min(a.start, b.start));
  };

  /**
   * @param {object} input
   *   leftText, rightText: plain text of both documents
   *   detections: output of PIIRA.engine.run(leftText)
   *   rightLabels: [{label, start, end, text, placeholder, known, rawLabel}] in RIGHT offsets
   * @returns {{findings, stats, alignment}}
   */
  function hashTokens(list) {
    let h = 0x811c9dc5;
    for (const s of list) {
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
      h ^= 1; h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36) + ':' + list.length;
  }

  /**
   * @param cache optional object kept by the caller between runs. When the
   *   words on both sides are unchanged (e.g. the reviewer only added a label in
   *   span mode), the word alignment is reused instead of recomputed.
   */
  const STEP = 2000; // items processed between pauses in compareDocumentsAsync

  // Written as a generator so the same code runs in one go (compareDocuments)
  // or in small steps that let the page respond (compareDocumentsAsync).
  function* compareSteps({ leftText, rightText, detections, rightLabels, cache }) {
    // Splitting a large document into words is reused while its text is unchanged.
    const tok = (side, text) => {
      if (cache && cache[side] && cache[side].text === text) return cache[side].tokens;
      const tokens = tokenize(text);
      if (cache) cache[side] = { text, tokens };
      return tokens;
    };
    const leftTokens = tok('leftTok', leftText);
    const rightTokens = tok('rightTok', rightText);

    // Placeholder tokens must never match LEFT words.
    const rightStrings = rightTokens.map((t) => t.t);
    const labelTokenSpans = rightLabels.map((l, li) => {
      const span = tokenSpan(rightTokens, l.start, l.end);
      if (span && l.placeholder) for (let i = span[0]; i <= span[1]; i++) rightStrings[i] = `\u0000ph${li}:${i}`;
      return span;
    });

    const leftStrings = leftTokens.map((t) => t.t);
    const alignKey = hashTokens(leftStrings) + '|' + hashTokens(rightStrings);
    let l2r;
    let r2l;
    if (cache && cache.alignKey === alignKey) {
      ({ l2r, r2l } = cache);
    } else {
      yield;
      ({ aToB: l2r, bToA: r2l } = alignTokens(leftStrings, rightStrings));
      if (cache) Object.assign(cache, { alignKey, l2r, r2l });
    }
    yield;

    const findings = [];
    const threshold = P.REVIEW_THRESHOLD;
    const matchesByDet = new Map(); // detection index -> [{label, leftRange, rightLabel}]

    const mkId = (category, label, rightLabel, l, r) =>
      `${category}|${label}|${rightLabel || ''}|${l ? l.start + '-' + l.end : 'r' + (r ? r.start + '-' + r.end : '')}`;

    const push = (f) => {
      f.id = mkId(f.category, f.label, f.rightLabel, f.left, f.right);
      findings.push(f);
    };

    for (let li = 0; li < rightLabels.length; li++) {
      if (li && li % STEP === 0) yield;
      const rl = rightLabels[li];
      const span = labelTokenSpans[li];
      const rightRange = { start: rl.start, end: rl.end };
      const leftRange = span ? mapTokenRange(span[0], span[1], r2l, leftTokens) : null;

      if (!rl.known) {
        push({
          category: CATEGORY.NEEDS_REVIEW, label: rl.label, rightLabel: rl.label, left: leftRange, right: rightRange,
          text: leftRange ? leftText.slice(leftRange.start, leftRange.end) : rl.text, confidence: null, source: 'right',
          note: `Unrecognised label name "${rl.rawLabel || rl.label}" on the right. Add it to labelAliases in selectors.js.`,
        });
        continue;
      }
      if (!leftRange) {
        push({
          category: CATEGORY.NEEDS_REVIEW, label: rl.label, rightLabel: rl.label, left: null, right: rightRange,
          text: rl.text, confidence: null, source: 'right',
          note: "Couldn't line this label up with the left document. Check it by hand.",
        });
        continue;
      }

      // Detections overlapping this label's LEFT text (detections are sorted and non-overlapping).
      let best = -1;
      let bestOverlap = 0;
      for (let di = P.util.lowerBound(detections, leftRange.start + 1, (d) => d.end);
        di < detections.length && detections[di].start < leftRange.end; di++) {
        const d = detections[di];
        const o = overlapLen(d, leftRange);
        if (o > bestOverlap || (o === bestOverlap && o > 0 && d.label === rl.label)) { best = di; bestOverlap = o; }
      }

      const leftSnippet = leftText.slice(leftRange.start, leftRange.end);

      if (rl.label === 'Overscrubbed') {
        const d = best >= 0 ? detections[best] : null;
        if (d && d.confidence >= threshold) {
          matchesByDet.set(best, (matchesByDet.get(best) || []).concat({ overscrub: true }));
          push({
            category: CATEGORY.NEEDS_REVIEW, label: d.label, type: d.type, rightLabel: 'Overscrubbed', left: leftRange, right: rightRange,
            text: leftSnippet, confidence: d.confidence, source: d.source, rule: d.rule,
            note: `Marked Overscrubbed, but this looks like ${P.describe(d)}.`,
          });
        } else {
          if (best >= 0) matchesByDet.set(best, (matchesByDet.get(best) || []).concat({ overscrub: true }));
          push({
            category: CATEGORY.CORRECT, label: 'Overscrubbed', rightLabel: 'Overscrubbed', left: leftRange, right: rightRange,
            text: leftSnippet, confidence: null, source: 'right', note: 'Overscrubbed label agrees: no PII detected here.',
          });
        }
        continue;
      }

      if (best < 0) {
        const known = P.knownNames.findIn(leftSnippet)[0];
        const outOfScope = known ? null : P.engine.outOfScopeType(leftText, leftRange.start, leftRange.end);
        push({
          category: CATEGORY.OVERSCRUB, label: rl.label, rightLabel: rl.label, left: leftRange, right: rightRange,
          text: leftSnippet, confidence: null, source: 'right', knownName: known || null,
          note: known
            ? `“${known.text}” is on the business names list (${known.category}): a well-known name, not PII. ` +
              `Labeling it ${rl.label} is over-scrubbing — mark it Overscrubbed.`
            : outOfScope
            ? `Labeled ${rl.label} on the right, but “${leftSnippet}” is a ${outOfScope}, which is out of scope (not PII). Mark it Overscrubbed.`
            : `Labeled ${rl.label} on the right, but no PII was detected here. If it is not PII, mark it Overscrubbed.`,
        });
        continue;
      }
      matchesByDet.set(best, (matchesByDet.get(best) || []).concat({ label: rl.label, leftRange, rightRange }));
    }

    for (let di = 0; di < detections.length; di++) {
      if (di && di % STEP === 0) yield;
      const d = detections[di];
      const leftRange = { start: d.start, end: d.end };
      const span = tokenSpan(leftTokens, d.start, d.end);
      const mappedRight = span ? mapTokenRange(span[0], span[1], l2r, rightTokens) : null;
      const base = { left: leftRange, text: d.text, type: d.type, confidence: d.confidence, source: d.source, rule: d.rule,
        kb: d.kb, model: d.model };
      const matches = matchesByDet.get(di) || [];
      const low = d.confidence < threshold;

      if (matches.some((m) => m.overscrub)) continue; // already reported above
      if (!matches.length) {
        push({
          ...base, category: low ? CATEGORY.NEEDS_REVIEW : CATEGORY.MISSED, label: d.label, rightLabel: null,
          right: mappedRight,
          note: low
            ? `Possibly ${P.describe(d)} (low confidence, ${Math.round(d.confidence * 100)}%). Not labeled on the right.`
            : `${P.describe(d)} found on the left but not labeled on the right.`,
        });
        continue;
      }

      // 'types' mode: the broad label of the type ("Credentials" on an Aadhaar number) is accepted too.
      const agrees = (label) => label === d.label || (P.SETTINGS.labelMode === 'types' && label === P.broadLabel(d.label));
      const same = matches.filter((m) => agrees(m.label));
      const diff = matches.filter((m) => !agrees(m.label));

      if (same.length) {
        const union = {
          start: Math.min(...same.map((m) => m.leftRange.start)),
          end: Math.max(...same.map((m) => m.leftRange.end)),
        };
        const rightUnion = {
          start: Math.min(...same.map((m) => m.rightRange.start)),
          end: Math.max(...same.map((m) => m.rightRange.end)),
        };
        if (iou(union, leftRange) >= CORRECT_IOU) {
          const general = same.every((m) => m.label !== d.label);
          push({ ...base, category: CATEGORY.CORRECT, label: d.label, rightLabel: same[0].label, right: rightUnion,
            note: general ? `Label accepted: ${same[0].label} (the general label; the specific type is ${d.label}).` : 'Label matches.' });
        } else {
          push({
            ...base, category: CATEGORY.NEEDS_REVIEW, label: d.label, rightLabel: d.label, right: rightUnion,
            note: `Boundary mismatch: the right labels "${leftText.slice(union.start, union.end)}", the detector found "${d.text}".`,
          });
        }
      }
      // Group differing labels so a split label is reported once.
      const byLabel = new Map();
      for (const m of diff) byLabel.set(m.label, (byLabel.get(m.label) || []).concat(m));
      for (const [label, ms] of byLabel) {
        const right = {
          start: Math.min(...ms.map((m) => m.rightRange.start)),
          end: Math.max(...ms.map((m) => m.rightRange.end)),
        };
        push({
          ...base, category: low ? CATEGORY.NEEDS_REVIEW : CATEGORY.WRONG_LABEL, label: d.label, rightLabel: label, right,
          note: low
            ? `Labeled ${label} on the right; the detector suggests ${P.describe(d)} with low confidence (${Math.round(d.confidence * 100)}%).`
            : typeNote(label, d) || `Labeled ${label} on the right, but this looks like ${P.describe(d)}.`,
        });
      }
    }

    yield;
    findings.sort((a, b) => (a.left ? a.left.start : Infinity) - (b.left ? b.left.start : Infinity) ||
      (a.right ? a.right.start : 0) - (b.right ? b.right.start : 0));

    // De-duplicate ids (identical spans in different findings are rare but possible).
    const seen = new Map();
    for (const f of findings) {
      const n = seen.get(f.id) || 0;
      seen.set(f.id, n + 1);
      if (n) f.id += `#${n}`;
    }

    const stats = { byCategory: {}, byLabel: {} };
    for (const c of Object.keys(CATEGORY)) stats.byCategory[c] = 0;
    for (const l of P.LABELS) stats.byLabel[l.name] = { detected: 0, labeled: 0 };
    for (const f of findings) stats.byCategory[f.category]++;
    for (const d of detections) if (stats.byLabel[d.label]) stats.byLabel[d.label].detected++;
    for (const r of rightLabels) if (stats.byLabel[r.label]) stats.byLabel[r.label].labeled++;

    return { findings, stats, alignment: { leftTokens, rightTokens, l2r, r2l } };
  }

  /** Compare in one go. See compareSteps for the input. */
  function compareDocuments(input) {
    const it = compareSteps(input);
    let r = it.next();
    while (!r.done) r = it.next();
    return r.value;
  }

  /**
   * Same result as compareDocuments, but pauses every ~25 ms so very large
   * documents never freeze the page. Returns null if isCurrent() turns false.
   */
  async function compareDocumentsAsync(input, isCurrent) {
    const it = compareSteps(input);
    let t0 = Date.now();
    let r = it.next();
    while (!r.done) {
      if (Date.now() - t0 > 25) {
        await P.engine.yieldNow();
        if (isCurrent && !isCurrent()) return null;
        t0 = Date.now();
      }
      r = it.next();
    }
    return r.value;
  }

  P.compare = {
    CATEGORY,
    labelResolver,
    compareDocuments,
    compareDocumentsAsync,
    readLabels,
    alignTokens,
    tokenize,
    labelResolver,
    placeholderRegex,
    isPlaceholderText,
  };
})(globalThis);
