(function (g) {
  'use strict';
  const P = g.PIIRA;
  if (P.started) return;
  P.started = true;

  P.policy.load().then((policy) => { if (policy.enabled) start(policy); });

  function start(policy) {
    const startedAt = Date.now();
    const GRACE_MS = 4000;
    // Replaced on the right, only not the way the guide prefers: still scrubbed, so treated as done.
    const SCRUBBED_BADLY = new Set(['INCOHERENT', 'DATATYPE', 'NOT_SENSIBLE']);

    // A date, month or year on its own: "May 2025", "15 March 2024", "March 15, 2024", "15/08/2024",
    // "2024-03-15", "Q3 2025", "2025". A lone "May" or "March" is a word, not a date.
    const MONTH_RE = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
    const ORD = '\\d{1,2}(?:st|nd|rd|th)?';
    const DATE_FORMS = [
      new RegExp(`^(?:${ORD}[ -]+(?:of[ ]+)?)?${MONTH_RE}\\.?(?:[ -]+${ORD})?,?(?:[ -]+'?\\d{2,4})?$`, 'i'),
      /^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}$/,
      /^(?:(?:Q[1-4]|H[12]|FY)[ ]?)?(?:19|20)\d{2}(?:[-–](?:19|20)?\d{2})?$/i,
    ];
    const LONE_WORD_MONTH = /^(?:may|march|mar|jan|june?|july?|aug|sept?|oct|nov|dec)\.?$/i;
    function looksLikeDate(s) {
      const v = String(s || '').trim().replace(/[.,;:)\]]+$/, '').replace(/^[(\[]+/, '');
      if (!v || v.length > 40 || LONE_WORD_MONTH.test(v)) return false;
      return DATE_FORMS.some((re) => re.test(v));
    }
    // A date of birth: detected as one, or a birth keyword right before ("DOB: …") or after ("… (DOB)").
    const DOB_WORD = /\b(?:d\.?\s?o\.?\s?b\.?|date\s+of\s+birth|birth\s*-?\s*date|birth\s*day|born(?:\s+on)?)\b/i;
    function isDobAt(text, span, detections) {
      if ((detections || []).some((d) => (d.label === 'Date of Birth' || d.type === 'Date of Birth') && d.start < span.end && d.end > span.start)) return true;
      // The keyword must belong to this date: no other number between them ("DOB: 1/2/1990, joined May 2021").
      const before = text.slice(Math.max(0, span.start - 50), span.start);
      let last = null;
      for (const m of before.matchAll(new RegExp(DOB_WORD.source, 'gi'))) last = m;
      if (last && !/\d/.test(before.slice(last.index + last[0].length))) return true;
      const after = text.slice(span.end, span.end + 15);
      const m = DOB_WORD.exec(after);
      return Boolean(m && !/\d/.test(after.slice(0, m.index)));
    }
    const DATE_CATS = new Set(['UNSURE', 'OVER_REDACTED', 'UNKNOWN_TEXT']);
    // Findings marked on the right document, by the check they came from (P.decisions.own).
    const RIGHT_MARKS = {
      L1: new Set(['NOT_PII']),
      L2: new Set(['LEAKAGE', 'OVER_REDACTED', 'UNSURE', 'INCOHERENT', 'DATATYPE', 'NOT_SENSIBLE', 'UNKNOWN_TEXT']),
    };

    const state = {
      stage: 'ALL',   // one review list: the label check and the redaction check together
      answersVer: 0,  // bumped on every answer change (keeps the Auto-Fill targets cache honest)
      result: null,
      l1: null,
      l1id: null,
      l2: null,
      taskCheck: null,
      knownNames: [],
      reviewed: new Set(),
      verdicts: new Map(),
      hidden: new Set(),
      highlightsOn: true,
      info: [],
      layout: null,
      leftModel: null,
      rightModel: null,
      rightLabels: [],
      sticky: null,
      signature: null,
      taskKey: null,
      failSince: 0,
      retryTimer: null,
      picking: null,
      gen: 0,
      detCache: null,
      alignCache: {},
      lastMs: 0,
      modelOn: false,
      lastRun: null,
      dirtyLeft: true,
      dirtyRight: true,
      autoFilling: false,
      detections: [],         // detections after the learned corrections (what compare/redaction used)
      learnStats: null,       // what the learned corrections changed in this document
      taught: new Map(),      // finding id -> remembered value key (to undo when the answer is cleared)
      relabel: new Map(),     // finding id -> label the reviewer chose instead of the detected one
      lastTaught: [],         // value keys of the last "what is it?" answer (for "Undo last answer")
      autoApplied: new Set(), // "<label>|<text>" put on the page by Auto-Fill in this task (not the reviewer's own labels)
      siteLearned: 0,         // label edits on the page learned from, in this task
      selection: null,        // last text the reviewer selected in a document: {text, side, offset}
    };

    const hashOf = (model) => model.hash || (model.hash = P.util.hash(model.text));
    const refresh = () => { renderHighlights(); renderPanel(); };
    const toggle = (set, key, on) => { if (on) set.add(key); else set.delete(key); };

    const IGNORE_TYPES = new Set(['US Employer Identification Number']);
    const ALWAYS_TICK_MATCHING = false;
    const MIN_TOKEN_LENGTH = 2;
    // Links: finding them and telling a real link from a file name (page/url-rules.js, Public Suffix List).
    const { PROTOCOL_OR_TLD_RE, URL_LIKE_PIECE_RE, OVERSCRUB_TOKEN_RE, cleanUrlStr, validUrl, findUrlSpans } = P.urlRules;
    const validateUrlsOffline = P.urlRules.validateOffline;

    const DIGITISH_RE = /^[\d\s.,:;_*|\/\\\-+()#]+$/;

    // Person fields of ticket and change-log records (assignee, reporter…): detectors/record-fields.js.
    const { looksLikeName, isNameKey } = P.recordFields;
    const looksLikeNameList = (s) => {
      const parts = String(s || '').split(/[,;&\/\[\]]+/).map((x) => x.trim()).filter(Boolean);
      return parts.length > 0 && parts.every(looksLikeName);
    };
    function inNameField(text, pos) {
      const seg = text.slice(Math.max(0, pos - 400), pos);
      const m = /\\?"([^"\n\\]{1,80})\\?"\s*:\s*\\?"([^"\n]*)$/.exec(seg);
      return Boolean(m && isNameKey(m[1]));
    }
    const isDigitSwap = (l, r) => Boolean(l && r && /\d/.test(l) && /\d/.test(r) && DIGITISH_RE.test(l) && DIGITISH_RE.test(r));
    const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();

    const { isWordBounded } = P.siteLabeler;

    // The links of the original, found once per document (not once per finding: a long task has
    // thousands of findings, and each full scan of the text froze the page).
    let leftUrlCache = { text: null, set: null };
    function leftUrlSet(leftText) {
      if (leftUrlCache.text !== leftText) leftUrlCache = { text: leftText, set: new Set(findUrlSpans(leftText).map((s) => s.clean)) };
      return leftUrlCache.set;
    }

    function classifyUrlFinding(f) {
      if (!state.leftModel || !state.rightModel) return null;
      const leftText = state.leftModel.text;
      const rightText = state.rightModel.text;
      const lt = f.left ? cleanUrlStr(squash(leftText.slice(f.left.start, f.left.end))) : '';
      const rt = f.right ? cleanUrlStr(squash(rightText.slice(f.right.start, f.right.end))) : '';

      let rToken = rt;
      if (f.right) {
        let ts = f.right.start;
        let te = f.right.end;
        while (ts > 0 && !/[\s"'<>`()]/.test(rightText[ts - 1])) ts--;
        while (te < rightText.length && !/[\s"'<>`()]/.test(rightText[te])) te++;
        rToken = cleanUrlStr(rightText.slice(ts, te));
      }

      const leftIsUrl = f.label === 'URL/Link' || (lt && (URL_LIKE_PIECE_RE.test(lt) || validUrl(lt)));
      const rightLooksUrl = Boolean((rt && URL_LIKE_PIECE_RE.test(rt)) || (rToken && URL_LIKE_PIECE_RE.test(rToken)));

      if (!leftIsUrl && !rightLooksUrl) return null;

      if (rt && PROTOCOL_OR_TLD_RE.test(rt) && (!rToken || PROTOCOL_OR_TLD_RE.test(rToken))) {
        return 'scrubbed';
      }

      const leftUrls = leftUrlSet(leftText);
      const isLeftUrl = (s) => leftUrls.has(s) || (leftIsUrl && s === lt);

      if ((rt && isLeftUrl(rt) && !OVERSCRUB_TOKEN_RE.test(rt)) ||
          (rToken && isLeftUrl(rToken) && !OVERSCRUB_TOKEN_RE.test(rToken) && rt === rToken)) {
        return 'exact';
      }

      if (rightLooksUrl) {
        return 'partial';
      }

      return 'scrubbed';
    }

    // Ticket fields (person fields, account IDs, Atlassian IDs) are found by detectors/record-fields.js;
    // here only the types this project leaves out.
    function augmentDetections(text, detections) {
      // The Golden project has a label for these types and the PII type list has them in scope.
      const out = P.labelSet() === 'golden' ? detections.slice() : detections.filter((d) => !IGNORE_TYPES.has(d.type));
      return out.sort((a, b) => a.start - b.start || b.end - a.end);
    }

    function notReallyOverscrubbed(f) {
      if (!f.right || !state.rightModel || !state.leftModel) return false;
      const lt = f.left ? squash(state.leftModel.text.slice(f.left.start, f.left.end)) : '';
      const rt = squash(state.rightModel.text.slice(f.right.start, f.right.end));
      // The reviewer said the original is not PII: changing it is over-scrubbing, whatever the field.
      if (lt && P.learning.isNotPii(lt)) return false;
      // A plain date (not a date of birth) that was changed: over-scrubbing, digits or not.
      if (f.isDate) return false;

      if (rt.replace(/[^\p{L}\p{N}]/gu, '').length < MIN_TOKEN_LENGTH) return true;
      if (lt && lt.replace(/[^\p{L}\p{N}]/gu, '').length < MIN_TOKEN_LENGTH) return true;

      if (PROTOCOL_OR_TLD_RE.test(rt) || (lt && PROTOCOL_OR_TLD_RE.test(lt))) return true;
      const urlStatus = classifyUrlFinding(f);
      if (urlStatus === 'scrubbed') return true;
      if (isDigitSwap(lt, rt)) return true;
      if (lt && looksLikeNameList(lt) && inNameField(state.leftModel.text, f.left.start)) return true;
      if (!lt && looksLikeNameList(rt) && inNameField(state.rightModel.text, f.right.start)) return true;
      return false;
    }

    function sameOnRight(f) {
      if (!f.left || !f.right) return false;
      return squash(state.leftModel.text.slice(f.left.start, f.left.end)) === squash(state.rightModel.text.slice(f.right.start, f.right.end));
    }


    function markFor(f, stage) {
      if (f.right && state.rightModel) {
        const rt = squash(state.rightModel.text.slice(f.right.start, f.right.end));
        if (rt.replace(/[^\p{L}\p{N}]/gu, '').length < MIN_TOKEN_LENGTH || PROTOCOL_OR_TLD_RE.test(rt)) return null;
      }
      if (f.left && state.leftModel) {
        const lt = squash(state.leftModel.text.slice(f.left.start, f.left.end));
        if (lt.replace(/[^\p{L}\p{N}]/gu, '').length < MIN_TOKEN_LENGTH) return null;
      }

      const urlStatus = classifyUrlFinding(f);
      // A link the right side changed, wholly or in part, is scrubbed: nothing to label.
      if (urlStatus === 'scrubbed' || urlStatus === 'partial') return null;
      if (urlStatus === 'exact') {
        return {
          label: 'URL/Link',
          note: 'Unscrubbed link/URL identical to original — label as URL/Link.',
          apply: true,
        };
      }

      if (stage === 'L1') {
        return f.category === 'NOT_PII' ? { label: 'Overscrubbed', note: f.note || 'Labeled, but no PII was found here.', apply: false } : null;
      }
      switch (f.category) {
        case 'LEAKAGE':
          return { label: f.label || 'Check', note: `Not scrubbed — label it as ${f.label || 'PII'}.`, apply: Boolean(f.label) };
        case 'OVER_REDACTED':
        case 'UNKNOWN_TEXT':
          if (notReallyOverscrubbed(f)) return null;
          return { label: 'Overscrubbed', note: 'Replaced text that is not PII — label it Overscrubbed.', apply: true };
        case 'UNSURE':
          if (notReallyOverscrubbed(f)) return null;
          return { label: f.label || 'Check', note: f.note || 'Check this replacement.', apply: false };
        case 'INCOHERENT':
        case 'DATATYPE':
        case 'NOT_SENSIBLE':
          return { label: f.label || 'Check', note: f.note || 'Check this replacement.', apply: false };
        default:
          return null;
      }
    }

    // The card shown over a marked word on the right: what to label it, the original text, why, and
    // "Auto-Apply" to label every word of that value now. It stays open while the pointer moves onto it.
    const tip = { el: null, marks: [], busy: false, mark: null, hideTimer: null };
    function ensureTip() {
      if (tip.el && tip.el.isConnected) return tip.el;
      const el = document.createElement('div');
      el.id = 'piira-tip';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', 'PII Review Automation suggestion');
      // Frosted dark glass, like the panel; solid when the browser cannot blur or the reviewer reduces transparency.
      const blur = CSS.supports('backdrop-filter', 'blur(1px)') && !matchMedia('(prefers-reduced-transparency: reduce)').matches;
      Object.assign(el.style, {
        position: 'fixed', zIndex: '2147483647', display: 'none', maxWidth: '300px', padding: '10px 12px',
        borderRadius: '12px', background: blur ? 'rgba(20, 20, 30, .8)' : '#16171f', color: '#f3f5fa',
        backdropFilter: blur ? 'blur(16px) saturate(130%)' : 'none',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08), 0 8px 32px rgba(0,0,0,.37)',
        border: '1px solid rgba(255, 255, 255, .14)', font: "500 12px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      });
      // Clicks on the card are ours: the site must not read them as a click in its document
      // (which would clear the selection or open its own label popup).
      for (const type of ['mousedown', 'mouseup', 'click', 'pointerdown', 'pointerup']) {
        el.addEventListener(type, (e) => { e.stopPropagation(); if (type === 'mousedown') e.preventDefault(); });
      }
      el.addEventListener('mouseenter', () => clearTimeout(tip.hideTimer));
      el.addEventListener('mouseleave', () => scheduleHide());
      (document.body || document.documentElement).appendChild(el);
      tip.el = el;
      return el;
    }
    function hideTip() { clearTimeout(tip.hideTimer); tip.mark = null; if (tip.el) tip.el.style.display = 'none'; }
    // A short delay, so the pointer can travel from the word to the card.
    function scheduleHide() { clearTimeout(tip.hideTimer); tip.hideTimer = setTimeout(hideTip, 280); }

    const tipLine = (label, value, color) => {
      const row = document.createElement('div');
      row.style.cssText = 'margin-top:3px';
      const k = document.createElement('b');
      k.textContent = label + ' ';
      const v = document.createElement('span');
      v.textContent = value;
      if (color) v.style.color = color;
      row.append(k, v);
      return row;
    };

    function drawTip(m, x, y) {
      const el = ensureTip();
      const color = P.labelInk(m.label) || '#d32f2f';
      el.replaceChildren();
      const head = document.createElement('div');
      head.style.cssText = 'display:flex;align-items:center;gap:7px;font-weight:700;font-size:12.5px';
      const pill = document.createElement('span');
      pill.style.cssText = `padding:1px 8px;border-radius:999px;background:${P.labelInfo(m.label).color};color:#fff;font-weight:700`;
      if (P.labelInk(m.label) !== P.labelInfo(m.label).color) pill.style.color = '#141414';
      pill.textContent = m.label;
      head.append(document.createTextNode('Mark with:'), pill);
      el.append(head);
      if (m.original && m.original !== m.text) el.append(tipLine('Original:', `“${m.original.slice(0, 120)}”`, '#ffd166'));
      if (m.note) {
        const note = document.createElement('div');
        note.style.cssText = 'margin-top:3px;color:#cfcfcf;font-weight:400';
        note.textContent = m.note;
        el.append(note);
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      const words = valueWords(m);
      btn.textContent = `Auto-Apply “${m.label}”${words.length > 1 ? ` · ${words.length} words` : ''}`;
      btn.title = `Label ${words.map((w) => `“${w.text}”`).join(', ')} as ${m.label} on the page`;
      btn.style.cssText = 'display:block;width:100%;margin-top:9px;padding:7px 10px;border:0;border-radius:8px;' +
        'background:linear-gradient(135deg,#ffc14d,#f59e0b);color:#141414;box-shadow:inset 0 1px 0 rgba(255,255,255,.4),0 4px 14px rgba(245,158,11,.35);' +
        "transition:filter .2s ease;font:700 12px/1.2 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;cursor:pointer";
      btn.addEventListener('mouseenter', () => { btn.style.filter = 'brightness(1.08)'; });
      btn.addEventListener('mouseleave', () => { btn.style.filter = ''; });
      btn.addEventListener('click', () => applyMark(m, btn));
      el.append(btn);
      el.style.display = 'block';
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      el.style.left = Math.max(8, Math.min(innerWidth - w - 8, x + 12)) + 'px';
      el.style.top = (y - h - 14 > 8 ? y - h - 14 : y + 18) + 'px';
      tip.mark = m;
    }

    // Every underlined word of the value under the pointer, in page order (one label per word).
    const valueWords = (m) => {
      const same = m.id == null ? [] : tip.marks.filter((x) => x.id === m.id && x.label === m.label);
      return (same.length ? same : [m]).slice().sort((a, b) => a.start - b.start);
    };

    // "Auto-Apply" on the card: label every word of this value through the site's own popup, the same way
    // Auto-Fill does (one label per word, never over an existing label), then look at the page again.
    async function applyMark(m, btn) {
      if (state.autoFilling) return;
      if (!state.rightModel || !state.sticky) return;
      const words = valueWords(m);
      btn.disabled = true;
      btn.textContent = 'Applying…';
      let live = liveRight();
      if (!words.some((w) => resolveTargetRange(w, live))) { btn.textContent = 'Already labeled'; setTimeout(hideTip, 1200); return; }
      hideTip();
      state.autoFilling = true;
      let applied = 0;
      let failed = 0;
      try {
        for (const w of words) {
          if (!state.autoFilling) break;
          live = liveRight();
          state.rightModel = live.model;
          state.rightLabels = live.labels;
          const range = resolveTargetRange({ start: w.start, end: w.end, text: w.text, label: w.label }, live);
          if (!range) continue;
          // The card ticks "Annotate matching entries" (the same value elsewhere gets the label too); Auto-Fill does not.
          if (await applySingleAnnotation(range, w.label, true)) { applied++; state.autoApplied.add(autoKey(w.label, w.text)); } else failed++;
          if (words.length > 1) await sleep(160);
        }
      } finally {
        state.autoFilling = false;
        setFillLabel(applied ? `✓ ${m.label}${words.length > 1 ? ` ×${applied}` : ''}${failed ? ` · ${failed} failed` : ''}` : 'Could not apply');
        setTimeout(() => setFillLabel(FILL_IDLE), 2500);
        analyze('auto-apply', true);
      }
    }

    function offsetAtPoint(x, y) {
      const model = state.rightModel;
      if (!model) return -1;
      let node = null;
      let off = 0;
      if (document.caretPositionFromPoint) {
        const c = document.caretPositionFromPoint(x, y);
        if (c) { node = c.offsetNode; off = c.offset; }
      } else if (document.caretRangeFromPoint) {
        const r = document.caretRangeFromPoint(x, y);
        if (r) { node = r.startContainer; off = r.startOffset; }
      }
      return modelOffset(model, node, off);
    }

    function onTipMove(ev) {
      tip.last = ev;
      if (tip.busy) return;
      tip.busy = true;
      requestAnimationFrame(() => {
        tip.busy = false;
        const e = tip.last;
        // On the card itself: keep it open (its button is there).
        if (tip.el && tip.el.contains(e.target)) { clearTimeout(tip.hideTimer); return; }
        const right = state.sticky && state.sticky.loc.right;
        if (!tip.marks.length || !right || !right.contains(e.target) || state.autoFilling) { if (tip.mark) scheduleHide(); return; }
        const pos = offsetAtPoint(e.clientX, e.clientY);
        const m = pos < 0 ? null : tip.marks.find((x) => pos >= x.start && pos < x.end);
        const range = m && P.textModel.toRange(state.rightModel, m.start, m.end);
        const on = range && [...range.getClientRects()].some((r) => e.clientX >= r.left - 1 && e.clientX <= r.right + 1 && e.clientY >= r.top - 1 && e.clientY <= r.bottom + 1);
        if (!on) { if (tip.mark) scheduleHide(); return; }
        clearTimeout(tip.hideTimer);
        if (tip.mark && tip.mark.start === m.start && tip.mark.end === m.end && tip.el.style.display !== 'none') return;
        drawTip(m, e.clientX, e.clientY);
      });
    }
    document.addEventListener('mousemove', onTipMove, { passive: true });
    document.addEventListener('scroll', (e) => { if (!(tip.el && tip.el.contains(e.target))) hideTip(); }, { capture: true, passive: true });
    document.addEventListener('mouseleave', () => scheduleHide(), { passive: true });

    function underlineCss() {
      const rules = [];
      for (const l of P.LABELS) {
        rules.push(`::highlight(piira-${l.slug}) { background-color: transparent !important; text-decoration-line: underline !important; text-decoration-color: ${P.labelInk(l.name)} !important; text-decoration-thickness: 2px !important; }`);
        rules.push(`::highlight(piira-rm-${l.slug}) { background-color: transparent !important; text-decoration-line: underline !important; text-decoration-style: wavy !important; text-decoration-color: ${P.labelInk(l.name)} !important; text-decoration-thickness: 2px !important; text-underline-offset: 3px; }`);
      }
      rules.push('::highlight(piira-rm-unknown) { background-color: transparent !important; text-decoration-line: underline !important; text-decoration-style: wavy !important; text-decoration-color: #d32f2f !important; text-decoration-thickness: 2px !important; text-underline-offset: 3px; }');
      rules.push('::highlight(piira-right-issue), ::highlight(piira-right-overscrub) { background-color: transparent !important; }');
      return rules.join('\n');
    }

    function injectUnderlineOnlyStyles() {
      if (!window.CSS || !CSS.highlights) return;
      let style = document.getElementById('piira-underline-only');
      if (!style) {
        style = document.createElement('style');
        style.id = 'piira-underline-only';
        (document.head || document.documentElement).appendChild(style);
      }
      const css = underlineCss();
      if (style.textContent !== css) style.textContent = css;
    }
    const syncUnderlineOnlyStyles = injectUnderlineOnlyStyles;

    const panel = P.panel.create({
      onOpenChange(open) { P.config.savePrefs({ panelOpen: open }); },
      onLauncherMove(pos) { P.config.savePrefs({ launcherPos: pos }); },
      onRefresh: () => { P.layout.redetect(); analyze('manual', true); },
      onReport(f) {
        P.report.download(`pii-report-${P.report.slug(state.fileName)}-${P.report.stamp()}.json`, P.report.findingReport({
          finding: f, stage: state.stage, fileName: state.fileName,
          leftText: state.leftModel && state.leftModel.text, rightText: state.rightModel && state.rightModel.text,
        }));
      },
      onSaveTask() {
        if (!state.result || !state.leftModel) return;
        P.report.download(`${P.report.slug(state.fileName)}-${P.report.stamp()}.pii-task.json`, P.report.taskExport({
          stage: state.stage, fileName: state.fileName, leftText: state.leftModel.text,
          findings: state.result.findings, verdicts: state.verdicts,
        }));
      },
      onSelect: select,
      onToggleReviewed(id, done) { toggle(state.reviewed, id, done); refresh(); },
      onToggleLabel(label) { toggle(state.hidden, label, !state.hidden.has(label)); refresh(); },
      onToggleHighlights() { state.highlightsOn = !state.highlightsOn; refresh(); },
      onVerdict(id, verdict) { setVerdicts([id], verdict); },
      onVerdictMany(ids, verdict) { setVerdicts(ids, verdict); },
      onTeach(ids, label) { teach(ids, label); },
      onAddAnnotation(text, label) { return addAnnotation(text, label); },
      // A value answered "Not PII" disappears from the list, so its answer cannot be cleared there.
      onLearningUndo() {
        for (const k of state.lastTaught) P.learning.forget(k);
        state.lastTaught = [];
        rerun('learning-undo');
      },
      async onCloudSync() {
        await P.cloud.flush();
        if (await P.cloud.pull(state.fileName, true)) analyze('team-list', true); else renderPanel();
      },
      onLearningExport() {
        P.report.download(`pii-learning-${P.report.stamp()}.json`, P.learning.exportData());
      },
      async onLearningReset() {
        await P.learning.reset();
        state.taught.clear();
        state.relabel.clear();
        state.lastTaught = [];
        state.answersVer++;
        rerun('learning-reset');
      },
      onSetup: startSetup,
      onAutoFill: () => runAutoFill(),
      onAutoFillGroup: (ids) => runAutoFill(groupFilter(ids)),
      /** How many labels Auto-Fill would put for this group (0: no button). */
      fillCount: (ids) => { try { return state.autoFilling ? 0 : groupFillCount(ids); } catch (e) { return 0; } },
      async onSaveDetected() {
        if (!P.config.detected) return;
        await P.config.save({ ...P.config.detected, method: 'auto' });
        analyze('saved', true);
      },
      onShowPanels() {
        if (state.sticky) P.picker.showPanels(panel, state.sticky.loc.left, state.sticky.loc.right);
      },
      onProject(choice) {
        P.SETTINGS.project = choice === 'auto' ? undefined : choice;
        P.config.savePrefs({ project: choice });
        analyze('project', true);
      },
      onLabelSet(pref) {
        state.labelSetPref = pref;
        P.config.savePrefs({ labelSet: pref });
        analyze('label-set', true);
      },
      async onResetSetup() {
        await P.config.reset();
        P.layout.redetect();
        analyze('reset', true);
      },
    });

    // ---------- learning from the reviewer's answers (core/learning.js)

    const findingById = (id) => state.result && state.result.findings.find((f) => f.id === id);

    function remember(f, label) {
      if (!f || !f.left || !state.leftModel) return '';
      const k = P.learning.record({
        text: state.leftModel.text, start: f.left.start, end: f.left.end, label,
        from: f.label || f.rightLabel || '', type: f.type, rule: f.rule, source: f.source,
      });
      if (k) state.taught.set(f.id, k);
      return k;
    }

    // An answer that agrees with the detected label is remembered quietly (it takes effect on the next
    // analysis, so the item does not jump under the reviewer). Clearing an answer forgets it again.
    function setVerdicts(ids, verdict) {
      let forgot = false;
      state.answersVer++;
      for (const id of ids) {
        if (verdict) state.verdicts.set(id, verdict); else state.verdicts.delete(id);
        toggle(state.reviewed, id, Boolean(verdict));
        state.relabel.delete(id);
        if (!verdict) {
          const k = state.taught.get(id);
          if (k) { P.learning.forget(k); state.taught.delete(id); forgot = true; }
          continue;
        }
        const f = findingById(id);
        const plan = f && P.decisions.learnPlan(f, state.stage, verdict);
        if (plan && plan.mode === 'silent') remember(f, plan.label);
        // "Keep (not PII)" / "Not PII" is remembered on the click itself: the question that follows only
        // offers another label instead, so skipping it (or moving on) still teaches "not PII".
        else if (plan && plan.mode === 'ask' && !plan.pii) remember(f, P.learning.NOT_PII);
      }
      if (forgot) rerun('forgot'); else refresh();
    }

    // The reviewer's answer to "what is it?": not PII at all, or PII with another label. It is
    // remembered and the document is checked again right away, so every other occurrence follows.
    function teach(ids, label) {
      const pii = label !== P.learning.NOT_PII;
      state.lastTaught = [];
      state.answersVer++;
      for (const id of ids) {
        const f = findingById(id);
        if (!f) continue;
        const k = remember(f, label);
        if (k) state.lastTaught.push(k);
        if (!pii) continue;
        state.verdicts.set(id, P.decisions.piiAnswer(f));
        state.reviewed.add(id);
        if (label !== f.label) state.relabel.set(id, label);
      }
      rerun('learned');
    }

    /** Analyse the current task again (after a correction). Resolves when the new result is drawn. */
    function rerun(reason) {
      const run = state.lastRun;
      if (!run || state.autoFilling) { refresh(); return Promise.resolve(false); }
      const gen = ++state.gen;
      return finishAnalysis({ gen, reason, ...run }).then(() => gen === state.gen)
        .catch((err) => { console.warn('[PII Review Automation] analysis failed', err); return false; });
    }

    // After "＋ Add": label that value on the page right away (only it, word by word, never over a label).
    function labelAddedValue(value, label) {
      const want = String(value).toLowerCase();
      const words = new Set(want.split(/\s+/));
      return (ok) => {
        if (!ok) return;
        runAutoFill((t) => {
          if (t.label !== label) return false;
          const w = t.text.toLowerCase();
          return words.has(w) || want.includes(w) || w.includes(want);
        });
      };
    }

    // Auto-Fill for one group of the list (e.g. the 10 Overscrubbed ones): only the targets on those
    // findings — on their place on the right, or on their value — with the label each would get.
    function groupFilter(ids) {
      const fs = ids.map(findingById).filter(Boolean);
      const spans = fs.filter((f) => f.right).map((f) => f.right);
      const values = new Set();
      const labels = new Set();
      for (const f of fs) {
        if (f.left && state.leftModel) values.add(squash(state.leftModel.text.slice(f.left.start, f.left.end)).toLowerCase());
        if (f.text) values.add(squash(f.text).toLowerCase());
        const m = P.decisions.own(f) === 'L2' && f.right ? markFor(f, 'L2') : null;
        const label = state.relabel.get(f.id) || (m ? m.label : f.label);
        if (label) labels.add(label);
      }
      return (t) => labels.has(t.label) && (spans.some((s) => s.start < t.end && s.end > t.start) ||
        [...values].some((v) => v === t.text.toLowerCase() || v.split(/\s+/).includes(t.text.toLowerCase())));
    }

    // Targets of the whole document, shared by every group's count. Worked out again only when the
    // analysis or the reviewer's answers change, not on every redraw.
    function fillTargets() {
      const c = state.fillCache;
      if (!c || c.result !== state.result || c.answers !== state.answersVer) {
        state.fillCache = { result: state.result, answers: state.answersVer, targets: collectAutoFillTargets() };
      }
      return state.fillCache.targets;
    }
    // The counts on the group buttons. A stale list is shown as it was and worked out again just
    // after the click has been drawn, so an answer never waits for it.
    let fillTimer = null;
    function groupFillCount(ids) {
      const c = state.fillCache;
      const fresh = c && c.result === state.result && c.answers === state.answersVer;
      if (!fresh && !fillTimer) {
        fillTimer = setTimeout(() => {
          fillTimer = null;
          if (state.autoFilling || !state.result) return;
          fillTargets();
          renderPanel();
        }, 60);
      }
      return c && c.result === state.result ? c.targets.filter(groupFilter(ids)).length : 0;
    }

    // Finding ids include the category and label, so a finding that changed after a correction gets a
    // new id. Carry the answer over to the finding on the same original text.
    function carryAnswers(prev, next) {
      if (!prev || !next) return;
      const spanOf = (f) => (f.left ? `${f.left.start}-${f.left.end}` : '');
      const ids = new Set(next.findings.map((f) => f.id));
      const bySpan = new Map();
      for (const f of prev.findings) if (!ids.has(f.id) && state.verdicts.has(f.id) && spanOf(f)) bySpan.set(spanOf(f), f.id);
      if (!bySpan.size) return;
      for (const f of next.findings) {
        const old = bySpan.get(spanOf(f));
        if (!old || state.verdicts.has(f.id)) continue;
        for (const m of [state.verdicts, state.relabel, state.taught]) if (m.has(old)) m.set(f.id, m.get(old));
        state.reviewed.add(f.id);
      }
    }

    // ---------- learning from the labels the reviewer edits on the site itself

    const { autoKey } = P.siteObserver;   // the comparison itself: page/site-observer.js

    // The original value behind a span of the right document: the finding there (its text in the
    // original), so the answer applies to what the detectors read. Without one, the right text itself.
    function valueAt(rightText, start, end, needFinding) {
      const fs = ((state.l2 && state.l2.findings) || []).concat((state.l1id && state.l1id.findings) || []);
      // A finding about this value, not a long stretch of text that happens to include it.
      const f = fs.find((x) => x.left && x.right && x.left.end > x.left.start && x.right.start < end && x.right.end > start &&
        x.category !== 'UNKNOWN_TEXT' && x.category !== 'TASK' && x.right.end - x.right.start <= (end - start) * 4 + 40);
      if (f && state.leftModel) return { text: state.leftModel.text, start: f.left.start, end: f.left.end, from: f.label || '', type: f.type, rule: f.rule, source: f.source };
      return needFinding ? null : { text: rightText, start, end, from: '' };
    }

    /**
     * Compare the page's labels with the last look and learn from what the reviewer changed:
     *   label added (not by Auto-Fill) or changed to X  -> the value is X
     *   Overscrubbed added, or a label changed to it     -> the original value is not PII
     *   label removed (Overscrubbed excepted)            -> the value is not PII
     * Labels are matched by their text, not their position, so a page that shifts offsets is fine.
     * A sudden mass disappearance is the page redrawing, not the reviewer: nothing is learned then.
     */
    function learnFromSiteLabels(before, after, rightText) {
      let learned = 0;
      for (const { span, answer } of P.siteObserver.diff(before, after, state.autoApplied)) {
        // Overscrubbed is about the right side's replacement: it says the original behind it is not PII,
        // so it needs the finding that links the two.
        const over = answer === 'Overscrubbed';
        const src = valueAt(rightText, span.start, span.end, over);
        if (!src) continue;
        const k = P.learning.record({ ...src, label: over ? P.learning.NOT_PII : answer, source: 'site' });
        if (k) { learned++; state.lastTaught = [k]; }
      }
      state.siteLearned += learned;
    }

    // ---------- which label set the site uses (core/labels.js)

    // The Golden project's page shows its labels (the "Labels" legend, the label picker). Five or more
    // labels that exist only there, outside the two documents, mean the Golden set. Once seen on a page,
    // it stays until the page changes, so a legend that scrolls away does not switch it back.
    const LABEL_TEXT_SEL = 'span.ant-typography, .ant-select-item-option-content, .ant-tag, [role="option"]';
    function pageIsGolden(loc) {
      const seen = new Set();
      for (const el of document.querySelectorAll(LABEL_TEXT_SEL)) {
        if (panel.contains(el) || (loc && (loc.left.contains(el) || loc.right.contains(el)))) continue;
        const t = (el.textContent || '').trim();
        if (t.length > 60 || !P.GOLDEN_ONLY.has(t)) continue;
        seen.add(t);
        if (seen.size >= 5) return true;
      }
      return false;
    }

    /**
     * The task's project (core/projects.js: Apps, Code Base, Meta, Golden, General) and the label set that
     * follows from it. The reviewer's choice wins; a Golden project, or a page listing the Golden labels,
     * means the Golden set. Returns true when the label set changed.
     */
    function syncLabelSet(loc) {
      const page = location.pathname;
      const taskName = P.fileHint.findOnPage(document, loc ? [loc.left, loc.right] : []) || document.title || '';
      if (state.projectPage !== page + '|' + taskName) {
        state.projectPage = page + '|' + taskName;
        state.pageProject = P.projects.fromPage(document, loc ? [loc.left, loc.right] : []);
      }
      state.project = P.projects.current(taskName, state.pageProject);
      // The client a Code Base task belongs to, from its title ("DK1__TeamKiraana__website" -> Kiraana).
      P.TASK_CLIENT_NAMES = P.projects.clientsFromTask(taskName);
      if (state.goldenPage !== page) state.goldenPage = pageIsGolden(loc) ? page : null;
      // A label set fixed for the project on the team server (core/cloud-client.js) also counts.
      const golden = state.project === 'golden' || Boolean(state.goldenPage) || P.TEAM_LABEL_SET === 'golden';
      const pref = state.labelSetPref || 'auto';
      return P.setLabelSet(pref === 'auto' ? (golden ? 'golden' : 'standard') : pref);
    }

    // ---------- "Add annotation": a value the assistant missed, taught by the reviewer

    // Offset in a text model of a DOM position (text node + offset), or -1.
    function modelOffset(model, node, off) {
      if (!model || !node || node.nodeType !== 3) return -1;
      const i = model.nodeIndex.get(node);
      if (i === undefined) return -1;
      const seg = model.segments[i];
      if (!seg.map) return seg.start + off;
      let j = 0;
      while (j < seg.map.length - 1 && seg.map[j + 1] <= off) j++;
      return seg.start + j;
    }

    // The last text the reviewer selected in either document, offered in the "Add annotation" box.
    document.addEventListener('selectionchange', () => {
      if (state.autoFilling || !state.sticky) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const text = sel.toString().replace(/\s+/g, ' ').trim();
      if (!text || text.length > 120) return;
      const r = sel.getRangeAt(0);
      const { left, right } = state.sticky.loc;
      const side = left.contains(r.startContainer) ? 'left' : right.contains(r.startContainer) ? 'right' : null;
      if (!side) return;
      const model = side === 'left' ? state.leftModel : state.rightModel;
      state.selection = { text, side, offset: modelOffset(model, r.startContainer, r.startOffset) };
      panel.setSelection(text);
    });

    /** Teach a value (and its label, or 'NOT_PII'); every occurrence follows from now on. */
    function addAnnotation(text, label) {
      const value = String(text || '').replace(/\s+/g, ' ').trim();
      if (!value || !state.leftModel) return false;
      const lt = state.leftModel.text;
      const sel = state.selection;
      // Overscrubbed: the replacement on the right hides an original that is not PII. Learn that about
      // the original (found through the finding at the selected spot), so the change is flagged as an
      // over-scrub and Auto-Fill labels it Overscrubbed from now on.
      if (label === 'Overscrubbed') {
        label = P.learning.NOT_PII;
        if (sel && sel.side === 'right' && sel.offset >= 0 && state.rightModel) {
          const src = valueAt(state.rightModel.text, sel.offset, sel.offset + value.length, true);
          if (src) {
            const k = P.learning.record({ ...src, label, source: 'reviewer' });
            if (!k) return false;
            state.lastTaught = [k];
            rerun('annotation-added').then(labelAddedValue(value, 'Overscrubbed'));
            return true;
          }
        }
      }
      // The occurrence that was selected in the original, else the first one, else the value on its own.
      let start = -1;
      if (sel && sel.side === 'left' && sel.offset >= 0 && squash(lt.slice(sel.offset, sel.offset + value.length + 8)).startsWith(value)) start = sel.offset;
      if (start < 0) {
        const at = allWordBoundedIndexes(lt, value);
        start = at.length ? at[0] : lt.toLowerCase().indexOf(value.toLowerCase());
      }
      const src = start >= 0 && lt.slice(start, start + value.length).toLowerCase() === value.toLowerCase()
        ? { text: lt, start, end: start + value.length } : { text: value, start: 0, end: value.length };
      const k = P.learning.record({ ...src, label, from: '', source: 'reviewer' });
      if (!k) return false;
      state.lastTaught = [k];
      const after = rerun('annotation-added');
      if (label !== P.learning.NOT_PII) after.then(labelAddedValue(value, P.labelOfType(label)));
      return true;
    }

    function learningNotices() {
      const s = state.learnStats;
      if (!s) return [];
      const parts = [];
      if (state.siteLearned) parts.push(`learned from ${state.siteLearned} label edit${state.siteLearned > 1 ? 's' : ''} on the page`);
      if (s.dropped) parts.push(`${s.dropped} hidden as not PII`);
      if (s.softened) parts.push(`${s.softened} marked possible`);
      if (s.relabeled) parts.push(`${s.relabeled} relabeled`);
      if (s.added) parts.push(`${s.added} added`);
      if (!parts.length) return [];
      return [{ key: 'learning', title: `Learning: ${parts.join(', ')}.`,
        details: ['Exact values you answered before get the same answer; similar values the assistant is sure about are marked "possible" or relabeled. "Undo last answer" and "Forget everything learned" are under "Learning, colours & setup".'] }];
    }

    // Labeling on the site (its own dialog) and the word rules Auto-Fill follows: page/site-labeler.js.
    const { sleep, applySingleAnnotation, allWordBoundedIndexes, wordSpans } = P.siteLabeler;
    const rangeHasLabel = (range) => P.siteLabeler.rangeHasLabel(range, state.sticky && state.sticky.S.rightLabelSpan, state.sticky && state.sticky.loc.right);

    function liveRight() {
      const ignore = (state.sticky.S.ignoreInText || []).join(',');
      const model = P.textModel.build(state.sticky.loc.right, ignore);
      let labels = [];
      try { labels = P.compare.readLabels(state.sticky.loc.right, model, state.sticky.S); } catch (err) { labels = []; }
      return { model, labels };
    }

    function collectAutoFillTargets() {
      if (!state.rightModel || !state.leftModel || !state.sticky) return [];
      const rightText = state.rightModel.text;
      const leftText = state.leftModel.text;
      const existing = P.compare.readLabels(state.sticky.loc.right, state.rightModel, state.sticky.S);
      // Which characters of the right text are taken: 1 by a label on the page, 2 by a queued target,
      // 4 by a partly scrubbed link. Overlap checks read the span itself instead of every other span.
      const taken = new Uint8Array(rightText.length + 1);
      const mark = (s, e, bit) => { for (let i = Math.max(0, s); i < e && i < taken.length; i++) taken[i] |= bit; };
      const hits = (s, e, bits) => { for (let i = Math.max(0, s); i < e && i < taken.length; i++) if (taken[i] & bits) return true; return false; };
      for (const r of existing) mark(r.start, r.end, 1);
      const isOverlappingExisting = (s, e) => hits(s, e, 1);
      const siteLabels = new Set(P.LABELS.map((l) => l.name));

      const leftUrls = new Set(leftUrlSet(leftText));
      const detections = state.detections || [];
      for (const d of detections) {
        if (d.label === 'URL/Link') {
          const clean = cleanUrlStr(leftText.slice(d.start, d.end));
          if (clean && !PROTOCOL_OR_TLD_RE.test(clean)) leftUrls.add(clean);
        }
      }

      const rightUrlTokens = [];
      for (let i = 0; i < rightText.length;) {
        if (/[\s"'<>`()]/.test(rightText[i])) { i++; continue; }
        let j = i;
        while (j < rightText.length && !/[\s"'<>`()]/.test(rightText[j])) j++;
        const tok = cleanUrlStr(rightText.slice(i, j));
        if (tok && URL_LIKE_PIECE_RE.test(tok)) {
          // Placeholder, whitelisted and registry links are not PII even when unchanged (detectors/url.js).
          rightUrlTokens.push({ start: i, end: i + tok.length, clean: tok, exactLeak: leftUrls.has(tok) && !OVERSCRUB_TOKEN_RE.test(tok) && !P.isPublicUrl(tok) });
        }
        i = j;
      }
      for (const u of rightUrlTokens) if (!u.exactLeak) mark(u.start, u.end, 4);
      const touchesPartiallyScrubbedUrl = (s, e) => hits(s, e, 4);

      const raw = [];
      const overlapsQueued = (s, e) => hits(s, e, 2);

      const pushSingleSpan = (start, end, label) => {
        if (typeof start !== 'number' || typeof end !== 'number' || end <= start || !siteLabels.has(label)) return;
        while (start < end && /\s/.test(rightText[start])) start++;
        while (end > start && /\s/.test(rightText[end - 1])) end--;
        if (label !== 'URL/Link') {
          while (start < end && /^[,.;:!?()"'[\]{}<>]/.test(rightText[start])) start++;
          while (end > start && /[,.;:!?()"'[\]{}<>]$/.test(rightText[end - 1])) end--;
        }
        if (end <= start) return;

        const slice = rightText.slice(start, end);
        if (slice.replace(/[^\p{L}\p{N}]/gu, '').length < MIN_TOKEN_LENGTH) return;
        if (PROTOCOL_OR_TLD_RE.test(slice)) return;

        if (touchesPartiallyScrubbedUrl(start, end)) return;

        if (label === 'URL/Link' && !leftUrls.has(cleanUrlStr(slice))) return;

        if (!isWordBounded(rightText, start, end)) return;
        if (isOverlappingExisting(start, end) || overlapsQueued(start, end)) return;

        raw.push({ start, end, text: slice, label });
        mark(start, end, 2);
      };

      const push = (start, end, label) => {
        if (typeof start !== 'number' || typeof end !== 'number' || end <= start || !siteLabels.has(label)) return;
        const fullSlice = cleanUrlStr(rightText.slice(start, end));
        if (!fullSlice || PROTOCOL_OR_TLD_RE.test(fullSlice)) return;

        if (label === 'URL/Link' || URL_LIKE_PIECE_RE.test(fullSlice)) {
          if (leftUrls.has(fullSlice) && !OVERSCRUB_TOKEN_RE.test(fullSlice)) {
            const idx = rightText.indexOf(fullSlice, start);
            if (idx !== -1) pushSingleSpan(idx, idx + fullSlice.length, 'URL/Link');
          }
          return;
        }

        // A value the reviewer said is not PII is never labeled (Overscrubbed marks are about the right side's text).
        if (label !== 'Overscrubbed' && P.learning.isNotPii(rightText.slice(start, end))) return;

        // One word per label ("dfghj poijkjm" -> two labels), so labels never overlap or nest.
        for (const w of wordSpans(rightText, start, end, label)) pushSingleSpan(w.start, w.end, label);
      };

      // The reviewer's answers win: "Keep (not PII)" stops a PII label, "Redact (PII)" an Overscrubbed
      // one, and a label they picked replaces the detected one.
      const answered = (f, label) => {
        const verdict = state.verdicts.get(f.id);
        if (!P.decisions.allowsLabel(state.stage, verdict, label)) return null;
        return state.relabel.get(f.id) || label;
      };
      const blockedLeft = [];
      for (const f of (state.result && state.result.findings) || []) {
        const v = state.verdicts.get(f.id);
        if (f.left && v && !P.decisions.allowsLabel(state.stage, v, f.label || 'PII')) blockedLeft.push(f.left);
      }
      const leftBlocked = (s, e) => blockedLeft.some((b) => b.start < e && b.end > s);
      // A value found many times is searched for on the right once per label (the same places come back).
      const looked = new Set();
      const firstLook = (label, snippet) => {
        const k = label + '\u0000' + snippet;
        if (looked.has(k)) return false;
        looked.add(k);
        return true;
      };

      for (const u of rightUrlTokens) {
        if (u.exactLeak) pushSingleSpan(u.start, u.end, 'URL/Link');
      }

      // Redaction-check findings first (their label and place on the right are exact), then the label
      // check's, then any detected value still visible on the right that neither one covered.
      const all = (state.result && state.result.findings) || [];
      for (const f of all) {
        if (P.decisions.own(f) !== 'L2' || !f.right) continue;
        const m = markFor(f, 'L2');
        const label = m && m.apply && answered(f, m.label);
        if (label) push(f.right.start, f.right.end, label);
      }
      for (const f of all) {
        if (P.decisions.own(f) !== 'L1' || f.settled) continue;
        const label = f.label && answered(f, f.label);
        if (!label || label === 'Overscrubbed') continue;
        if (f.right && typeof f.right.start === 'number') {
          if (sameOnRight(f)) push(f.right.start, f.right.end, label);
        } else if (f.left) {
          const snippet = squash(leftText.slice(f.left.start, f.left.end));
          if (!firstLook(label, snippet)) continue;
          for (const idx of allWordBoundedIndexes(rightText, snippet)) {
            push(idx, idx + snippet.length, label);
          }
        }
      }
      for (const d of detections) {
        if (!d.label || d.label === 'Overscrubbed' || (P.typeReported && !P.typeReported(d.type || d.label))) continue;
        // Softened by your earlier answers ("possible"): shown for review, never labeled automatically.
        if ((d.learned && d.confidence < P.REVIEW_THRESHOLD) || leftBlocked(d.start, d.end)) continue;
        const snippet = squash(leftText.slice(d.start, d.end));
        if (!firstLook(d.label, snippet)) continue;
        for (const idx of allWordBoundedIndexes(rightText, snippet)) {
          push(idx, idx + snippet.length, d.label);
        }
      }

      return raw
        .map((r) => ({ ...r, matching: ALWAYS_TICK_MATCHING }))
        .sort((a, b) => a.start - b.start || b.end - a.end);
    }

    function resolveTargetRange(t, live) {
      const txt = live.model.text;
      const free = (s, e) => !live.labels.some((l) => l.start < e && l.end > s);

      const unlabeled = (r) => (r && !rangeHasLabel(r) ? r : null);

      if (txt.slice(t.start, t.end) === t.text && isWordBounded(txt, t.start, t.end)) {
        if (!free(t.start, t.end)) return null;
        return unlabeled(P.textModel.toRange(live.model, t.start, t.end));
      }

      const candidates = allWordBoundedIndexes(txt, t.text).filter((s) => free(s, s + t.text.length));
      if (!candidates.length) return null;
      candidates.sort((a, b) => Math.abs(a - t.start) - Math.abs(b - t.start));
      const best = candidates[0];
      if (Math.abs(best - t.start) > 200) return null;
      return unlabeled(P.textModel.toRange(live.model, best, best + t.text.length));
    }

    function setFillLabel(text) { panel.setAutoFillLabel(text); }
    const FILL_IDLE = 'Auto-Fill PII';

    /** Label the issues on the page. `only` (optional) keeps some targets, e.g. the value just added. */
    async function runAutoFill(only) {
      if (state.autoFilling) {
        state.autoFilling = false;
        return;
      }
      if (!state.rightModel || !state.sticky) {
        panel.showStatus('Wait for document analysis to finish before running Auto-Fill.');
        return;
      }

      const targets = collectAutoFillTargets().filter(typeof only === 'function' ? only : () => true);
      if (!targets.length) {
        setFillLabel('Nothing to fill');
        setTimeout(() => setFillLabel(FILL_IDLE), 2000);
        return;
      }

      state.autoFilling = true;
      hideTip();
      let applied = 0;
      let failed = 0;
      try {
        for (let i = 0; i < targets.length; i++) {
          if (!state.autoFilling) break;
          const t = targets[i];
          setFillLabel(`Filling ${i + 1}/${targets.length} · click to stop`);
          const live = liveRight();
          state.rightModel = live.model;
          state.rightLabels = live.labels;
          const range = resolveTargetRange(t, live);
          if (!range) continue;
          const ok = await applySingleAnnotation(range, t.label, t.matching);
          if (ok) { applied++; state.autoApplied.add(autoKey(t.label, t.text)); } else failed++;
          await sleep(160);
        }
      } finally {
        state.autoFilling = false;
        setFillLabel(`✓ Filled ${applied}${failed ? ` · ${failed} failed` : ''}`);
        setTimeout(() => setFillLabel(FILL_IDLE), 3500);
        analyze('auto-fill-complete', true);
      }
    }

    window.addEventListener('keydown', (e) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === 'KeyA' || e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        runAutoFill();
      }
    });

    // One review list from both checks (panel/decisions.js merge).
    function applyStage() {
      if (!state.l1id || !state.l2) return;
      state.result = P.decisions.merge(state.l1id, state.l2);
    }

    function renderPanel() {
      if (!state.result || state.picking) return;
      panel.render({
        stage: state.stage,
        result: state.result,
        legendStats: state.l1.stats,
        verdicts: state.verdicts,
        reviewed: state.reviewed,
        hidden: state.hidden,
        highlightsOn: state.highlightsOn,
        taskCheck: state.taskCheck,
        brief: state.brief,
        knownCount: state.knownNames.length,
        leftText: state.leftModel.text,
        info: state.info.filter((i) => i.key !== 'no-labels'),
        layout: state.layout,
        relabel: state.relabel,
        learning: { ...P.learning.summary(), canUndo: state.lastTaught.length > 0 },
        cloud: P.cloud.state,
        labelSet: { pref: state.labelSetPref || 'auto', active: P.labelSet(), detected: Boolean(state.goldenPage) },
        project: { current: state.project || 'general', choice: P.SETTINGS.project || 'auto' },
      });
    }

    function renderHighlights() {
      if (!state.result || !state.highlightsOn) { P.highlight.clear(); tip.marks = []; hideTip(); return; }

      const liveRightLabels = (state.sticky && state.rightModel)
        ? P.compare.readLabels(state.sticky.loc.right, state.rightModel, state.sticky.S)
        : (state.rightLabels || []);

      const isAnnotatedOnRight = (start, end) =>
        liveRightLabels.some((rl) => rl.start < end && rl.end > start);

      let detected = state.l1.findings.filter((f) => f.left && f.label && f.source !== 'right');
      const done = state.result.findings.filter((f) => f.category === 'REDACTED_OK' && f.left);
      if (done.length) detected = detected.filter((d) => !done.some((f) => f.left.start < d.left.end && f.left.end > d.left.start));

      let rawMarks = [];
      if (!state.hidden.has(P.RIGHT_OVERSCRUB_KEY)) {
        for (const f of state.result.findings) {
          const check = P.decisions.own(f);
          if (!RIGHT_MARKS[check].has(f.category) || !f.right || state.reviewed.has(f.id)) continue;
          if (isAnnotatedOnRight(f.right.start, f.right.end)) continue;
          const m = markFor(f, check);
          if (!m) continue;
          const label = state.relabel.get(f.id) || m.label;
          const note = label !== m.label ? `You chose ${label}.` : m.note;
          // One mark per word, exactly where Auto-Fill would put each label.
          for (const w of wordSpans(state.rightModel.text, f.right.start, f.right.end, label)) {
            rawMarks.push({ ...f, right: w, markLabel: label, markNote: note, markKind: check === 'L2' ? 'issue' : 'overscrub' });
          }
        }
      }
      
      // DEDUPLICATE: Completely prevents wavy lines from stacking on top of each other.
      const uniqueMarks = [];
      for (const m of rawMarks) {
        const overlaps = uniqueMarks.some(u => Math.max(m.right.start, u.right.start) < Math.min(m.right.end, u.right.end));
        if (!overlaps) uniqueMarks.push(m);
      }
      
      tip.marks = uniqueMarks.map((f) => ({
        // `id` ties the words of one value together ("Pbs" + "Uymm" for "New York"): Auto-Apply labels them all.
        id: f.id, start: f.right.start, end: f.right.end, label: f.markLabel, note: f.markNote,
        text: state.rightModel.text.slice(f.right.start, f.right.end),
        // What the original said here (shown on the card: "Original: U.S. National Science Foundation").
        original: f.left && state.leftModel ? squash(state.leftModel.text.slice(f.left.start, f.left.end)) : '',
      }));
      hideTip();

      const known = state.hidden.has(P.KNOWN_NAMES_KEY) ? [] : state.knownNames;
      P.highlight.render(state.leftModel, detected, state.hidden,
        { model: state.rightModel, findings: uniqueMarks, kind: 'issue' }, known);
      P.labelTags.render(state.leftModel, detected, state.hidden);

      syncUnderlineOnlyStyles();
    }

    function select(f) {
      const ranges = [];
      if (f.left && state.leftModel) ranges.push(P.textModel.toRange(state.leftModel, f.left.start, f.left.end));
      if (f.right && state.rightModel) ranges.push(P.textModel.toRange(state.rightModel, f.right.start, f.right.end));
      if (!P.highlight.flash(ranges)) analyze('stale', true);
    }

    function startSetup() {
      if (state.picking) return;
      P.highlight.clear();
      const finish = (reason) => { state.picking = null; panel.endSetup(); analyze(reason, true); };
      state.picking = P.picker.start(panel, {
        async onDone(setup) { await P.config.save(setup); finish('setup'); },
        onCancel() { finish('setup-cancel'); },
      });
    }

    function notices(source, labelCount) {
      const out = [];
      if (source === 'auto') {
        out.push({ key: 'auto', title: 'Document panels were found automatically.',
          details: ['Check them with “Show panels” under Page setup, then press “Looks right — save”. If they are wrong, use “Set up manually”.'] });
      }
      if (!labelCount) {
        out.push({ key: 'no-labels', title: 'No labels found on the right document yet.',
          details: ['This is normal for a task with no labels. If the right panel does show labels, use “Set up manually” and click one of them.'] });
      }
      if (!P.highlight.supported) out.push({ key: 'no-highlight', title: 'Colour highlights need Chrome 105 or newer.', details: [] });
      return out;
    }

    function stickyConnected() {
      const st = state.sticky;
      return Boolean(st && st.loc.left.isConnected && st.loc.right.isConnected);
    }

    const hasText = (el) => {
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) if (n.data.trim()) return true;
      return false;
    };

    const stickyStillValid = () => stickyConnected() && hasText(state.sticky.loc.left) && hasText(state.sticky.loc.right);

    function withinGrace(force) {
      if (!state.result || force) return false;
      if (!state.failSince) state.failSince = Date.now();
      if (Date.now() - state.failSince < GRACE_MS) {
        state.retryTimer = setTimeout(() => analyze('retry'), 700);
        return true;
      }
      state.failSince = 0;
      return false;
    }

    function notFound(loc) {
      Object.assign(state, { sticky: null, result: null, signature: null });
      P.highlight.clear();
      if (Date.now() - startedAt < (P.SELECTORS.waitForTaskMs || 8000)) {
        panel.showStatus('Looking for the task documents…');
        state.retryTimer = setTimeout(() => analyze('retry'), 1000);
      } else {
        panel.showError(loc.message, [...loc.details, 'Auto-detect could not find two side-by-side documents either.']);
      }
    }

    function analyze(reason, force) {
      if (state.picking || state.autoFilling) return;
      clearTimeout(state.retryTimer);
      if (!panel.host.isConnected && document.body) document.body.append(panel.host);
      injectUnderlineOnlyStyles();

      const layout = !force && stickyStillValid() ? state.sticky : P.layout.resolve();
      if (!layout.loc.ok) {
        if (!withinGrace(force)) notFound(layout.loc);
        return;
      }
      P.layout.findLabels(layout);
      const { loc, S, source, layer } = layout;

      const ignore = (S.ignoreInText || []).join(',');
      const reuse = (model, el, dirty) => !force && !dirty && layout === state.sticky && model && model.root === el;
      const leftModel = reuse(state.leftModel, loc.left, state.dirtyLeft) ? state.leftModel : P.textModel.build(loc.left, ignore);
      const rightModel = reuse(state.rightModel, loc.right, state.dirtyRight) ? state.rightModel : P.textModel.build(loc.right, ignore);
      state.dirtyLeft = state.dirtyRight = false;
      if ((!leftModel.text.trim() || !rightModel.text.trim()) && withinGrace(force)) return;
      state.sticky = layout;
      state.failSince = 0;

      // The label set decides how the page's labels are read, so it comes first. A switch re-reads every
      // label under new names: that is not the reviewer editing labels, and everything is analysed again.
      const setChanged = syncLabelSet(loc);
      if (setChanged) state.signature = null;
      const rightLabels = P.compare.readLabels(loc.right, rightModel, S);
      // Labels the reviewer added, changed or removed on the page since the last look are answers too.
      if (state.result && !setChanged && state.taskKey === hashOf(leftModel)) learnFromSiteLabels(state.rightLabels, rightLabels, rightModel.text);
      state.rightLabels = rightLabels;

      const signature = [source, hashOf(leftModel), hashOf(rightModel),
        P.util.hash(rightLabels.map((l) => `${l.label}@${l.start}-${l.end}`).join('|'))].join(':');
      if (!force && signature === state.signature && state.result) {
        // Nothing changed. Highlights are drawn again only when the page rebuilt the documents' nodes.
        const rebuilt = leftModel !== state.leftModel || rightModel !== state.rightModel;
        Object.assign(state, { leftModel, rightModel, rightLabels });
        if (rebuilt) renderHighlights();
        return;
      }
      state.signature = signature;
      state.layout = {
        source,
        savedAt: source === 'saved' ? layer.savedAt : null,
        similarity: layer ? layer.similarity : null,
        labelVia: layer ? layer.labelVia : 'selectors.js',
        labelCount: rightLabels.length,
      };

      if (!leftModel.text.trim()) {
        state.result = null;
        P.highlight.clear();
        panel.showStatus('Waiting for document text…');
        return;
      }

      if (hashOf(leftModel) !== state.taskKey) {
        state.taskKey = hashOf(leftModel);
        state.reviewed.clear();
        state.verdicts.clear();
        state.answersVer++;
        state.autoApplied.clear();
        state.siteLearned = 0;
      }

      const gen = ++state.gen;
      const busyTimer = setTimeout(() => panel.setBusy(' · Updating…'), 300);
      finishAnalysis({ gen, reason, source, leftModel, rightModel, rightLabels })
        .catch((err) => console.warn('[PII Review Automation] analysis failed', err))
        .finally(() => { clearTimeout(busyTimer); if (gen === state.gen) panel.setBusy(''); });
    }

    async function finishAnalysis({ gen, reason, source, leftModel, rightModel, rightLabels }) {
      const t0 = performance.now();
      const current = () => gen === state.gen;
      const pause = async () => { await P.engine.yieldNow(); return current(); };
      if (!(await pause())) return;

      const loc = state.sticky && state.sticky.loc;
      state.fileName = P.fileHint.findOnPage(document, loc ? [loc.left, loc.right] : []) || document.title || '';
      // A new task: get its project's team list (when team sync is on); a changed list re-checks the task.
      if (state.fileName !== state.teamTask) {
        state.teamTask = state.fileName;
        // analyze (not rerun): the team list may also set the project's label set.
        P.cloud.pull(state.fileName).then((changed) => { if (changed) analyze('team-list', true); });
      }
      const hint = P.fileHint.parse(state.fileName);
      // Company names the reviewer or the team taught: found in every spelling, also in links and code names.
      P.LEARNED_BUSINESS_NAMES = P.learning.businessNames();
      const leftKey = [hashOf(leftModel), leftModel.text.length, JSON.stringify(P.SETTINGS), P.knownNames.version,
        hint ? hint.type : '', state.project, (P.TASK_CLIENT_NAMES || []).join(','), P.LEARNED_BUSINESS_NAMES.join(',')].join(':');
      const cached = Boolean(state.detCache && state.detCache.key === leftKey);
      if (!cached) {
        // Off the page when the extension can (offscreen engine), in the page otherwise.
        const found = await P.engineClient.run(leftModel.text, current, { hint, project: state.project });
        if (!found) return;
        const detections = augmentDetections(leftModel.text, found);
        const structure = P.redactionRules.structure(leftModel.text);
        const language = P.redactionRules.languageReport(leftModel.text, { scriptOnly: Boolean(structure) });
        const people = detections.filter((d) => d.label === 'Person Name');
        const knownNames = P.knownNames.findIn(leftModel.text).filter((k) => !people.some((d) => k.start < d.end && k.end > d.start));
        state.detCache = { key: leftKey, detections, knownNames, taskCheck: { language, structure } };
      }
      const { knownNames, taskCheck } = state.detCache;
      // The reviewer's earlier answers come last: they override the rules and the model.
      const learned = P.learning.apply(leftModel.text, state.detCache.merged || state.detCache.detections);
      const detections = learned.detections;
      const tDetect = performance.now();
      if (!(await pause())) return;

      const l1 = await P.compare.compareDocumentsAsync({
        leftText: leftModel.text, rightText: rightModel.text, detections, rightLabels, cache: state.alignCache,
      }, current);
      if (!l1 || !(await pause())) return;
      const l2 = P.redaction.validate({ leftText: leftModel.text, rightText: rightModel.text, detections, alignment: l1.alignment, hint });
      if (!(await pause())) return;

      state.leftModel = leftModel; state.rightModel = rightModel;
      // Dates: a plain date, month or year that was changed on the right is over-scrubbing (not PII);
      // a date of birth that was changed is a correct redaction.
      for (const f of l2.findings) {
        if (!f.left || !f.right || !(DATE_CATS.has(f.category) || f.label === 'Date' || f.type === 'Date')) continue;
        const lt = squash(leftModel.text.slice(f.left.start, f.left.end));
        if (!looksLikeDate(lt) || squash(rightModel.text.slice(f.right.start, f.right.end)) === lt) continue;
        l2.stats.byCategory[f.category] = (l2.stats.byCategory[f.category] || 1) - 1;
        if (isDobAt(leftModel.text, f.left, detections)) {
          Object.assign(f, { category: 'REDACTED_OK', label: P.labelOfType('Date of Birth'), type: 'Date of Birth', note: 'A date of birth, replaced on the right: correct.' });
        } else {
          Object.assign(f, { category: 'OVER_REDACTED', label: null, type: undefined, isDate: true,
            note: `“${lt}” is a date, not PII: replacing it is over-scrubbing. Label it Overscrubbed.` });
        }
        l2.stats.byCategory[f.category] = (l2.stats.byCategory[f.category] || 0) + 1;
      }
      // A name swapped for another name ("Rahul and Uday" → "Pavan and Amit"): the scrubber replaced a person,
      // even where a lone first name was too weak to detect. Correct, not over-scrubbing.
      const nameWords = (s) => {
        const w = s.split(/\s+/).filter(Boolean);
        return w.length > 0 && w.length <= 4 && w.every((x) => /^\p{Lu}[\p{L}'.-]+$/u.test(x) && P.names.kind(x));
      };
      for (const f of l2.findings) {
        if (!f.left || !f.right || !DATE_CATS.has(f.category) || f.isDate) continue;
        const lt = squash(leftModel.text.slice(f.left.start, f.left.end));
        const rt = squash(rightModel.text.slice(f.right.start, f.right.end));
        if (lt === rt || !nameWords(lt) || !nameWords(rt)) continue;
        l2.stats.byCategory[f.category]--;
        Object.assign(f, { category: 'REDACTED_OK', label: 'Person Name', note: 'A name, replaced by another name on the right: correct.' });
        l2.stats.byCategory.REDACTED_OK = (l2.stats.byCategory.REDACTED_OK || 0) + 1;
      }
      // Links: one the right side changed anywhere ("app.read.ai/…/01M0…" → "app.galeorysum.ai/…/24D2…") is
      // scrubbed, even when the comparison matched only the shared pieces. Only the very same link is a leak.
      for (const f of l2.findings) {
        if (f.category !== 'LEAKAGE' || f.label !== 'URL/Link' || !f.left || !f.right) continue;
        const lt = cleanUrlStr(squash(leftModel.text.slice(f.left.start, f.left.end)));
        const rt = rightModel.text;
        let ts = f.right.start;
        let te = f.right.end;
        while (ts > 0 && !/[\s"'<>`()]/.test(rt[ts - 1])) ts--;
        while (te < rt.length && !/[\s"'<>`()]/.test(rt[te])) te++;
        const token = cleanUrlStr(rt.slice(ts, te));
        if (!token || token === lt || token.includes(lt) || leftUrlSet(leftModel.text).has(token)) continue;
        l2.stats.byCategory.LEAKAGE--;
        Object.assign(f, { category: 'REDACTED_OK', note: 'The link was replaced on the right: correct.' });
        l2.stats.byCategory.REDACTED_OK = (l2.stats.byCategory.REDACTED_OK || 0) + 1;
      }
      // The same for prefixed IDs: "card_1NqX…" → "card_7PbR…" matched only on "card" is a replaced Card ID, when the
      // whole value on the right is another value of the same type.
      for (const f of l2.findings) {
        if (f.category !== 'LEAKAGE' || f.label === 'URL/Link' || !f.type || !f.left || !f.right) continue;
        const lt = leftModel.text.slice(f.left.start, f.left.end).trim();
        const rt = rightModel.text;
        if (rt.slice(f.right.start, f.right.end).trim() === lt) continue;
        let ts = f.right.start;
        let te = f.right.end;
        while (ts > 0 && /[\w-]/.test(rt[ts - 1])) ts--;
        while (te < rt.length && /[\w-]/.test(rt[te])) te++;
        const token = rt.slice(ts, te);
        if (!token || token === lt || token.includes(lt) || !P.piiKeys.fitsType(f.type, token)) continue;
        l2.stats.byCategory.LEAKAGE--;
        Object.assign(f, { category: 'REDACTED_OK', note: `The ${f.type} was replaced on the right: correct.` });
        l2.stats.byCategory.REDACTED_OK = (l2.stats.byCategory.REDACTED_OK || 0) + 1;
      }
      l2.findings = l2.findings.filter((f) => {
        if ((f.category === 'OVER_REDACTED' || f.category === 'UNKNOWN_TEXT' || f.category === 'UNSURE') && notReallyOverscrubbed(f)) {
          l2.stats.byCategory[f.category]--;
          return false;
        }
        return true;
      });
      // A value the right side already replaced is done, whatever its label and however it was replaced
      // (shared, another kind, masked), company names included: no mark, no label suggestion on either
      // side, and it counts as redacted.
      const okAt = new Set(l2.findings.filter((f) => f.category === 'REDACTED_OK' && f.left).map((f) => `${f.left.start}-${f.left.end}`));
      const scrubbedPii = (f) => SCRUBBED_BADLY.has(f.category) ||
        (f.category === 'OVER_REDACTED' && (Boolean(f.knownName) || (f.label && f.label !== 'Overscrubbed')));
      l2.findings = l2.findings.filter((f) => {
        if (!scrubbedPii(f)) return true;
        l2.stats.byCategory[f.category]--;
        const at = f.left ? `${f.left.start}-${f.left.end}` : '';
        if (at && okAt.has(at)) return false;
        if (at) okAt.add(at);
        f.category = 'REDACTED_OK';
        l2.stats.byCategory.REDACTED_OK = (l2.stats.byCategory.REDACTED_OK || 0) + 1;
        return true;
      });

      const urlNotices = validateUrlsOffline(leftModel.text, rightModel.text, detections);
      const l1id = P.identify.fromCompare(l1);
      carryAnswers(state.l1id, l1id);
      carryAnswers(state.l2, l2);
      state.learnStats = learned.stats;

      Object.assign(state, {
        l1, l1id, l2, taskCheck, knownNames,
        leftModel, rightModel, rightLabels, detections,
        info: notices(source, rightLabels.length).concat(modelNotices(), learningNotices(), urlNotices),
        brief: P.decisions.documentBrief({
          leftText: leftModel.text, rightText: rightModel.text, rightLabelCount: rightLabels.length, detections, l2, taskCheck,
        }),
      });
      applyStage();
      // Highlights, then the panel in a task of its own, so the page can answer input in between.
      renderHighlights();
      if (!(await pause())) return;
      renderPanel();
      state.lastRun = { source, leftModel, rightModel, rightLabels };
      if (!state.detCache.model) modelPass(state.detCache, leftModel.text);
      state.lastMs = performance.now() - t0;
      console.debug(`[PII Review Automation] ${reason} (${source}): ${detections.length} detections${cached ? ' (cached)' : ''}, ` +
        `${rightLabels.length} right labels, ${Math.round(state.lastMs)} ms (detect ${Math.round(tDetect - t0)})` +
        (hint ? `, file type: ${hint.type}` : ''));
    }

    async function modelPass(cache, text) {
      cache.model = { status: 'off' };
      if (!state.modelOn) return;
      cache.model = { status: 'loading' };
      const showStatus = (status) => {
        if (state.detCache !== cache) return;
        cache.model.status = status;
        state.info = state.info.filter((i) => !i.key.startsWith('model')).concat(modelNotices());
        renderPanel();
      };
      showStatus('loading');
      let r;
      try {
        r = await P.modelClient.detect(text, cache.key, showStatus);
      } catch (err) {
        r = { status: 'failed', entities: [], error: String(err && err.message || err) };
      }
      if (state.detCache !== cache) return;
      cache.model = { status: r.status, error: r.error || '', ms: r.ms || 0 };
      if (r.entities && r.entities.length) {
        try {
          // In code (a Code Base task, or a code file anywhere) the model's own guesses are not shown.
          const merged = augmentDetections(text, P.hybrid.merge(cache.detections, r.entities, text,
            { codeFile: P.projects.isCode(state.fileName, state.project) }));
          const fromModel = merged.filter((d) => d.source === 'model');
          cache.model.added = fromModel.filter((d) => d.confidence >= P.REVIEW_THRESHOLD).length;
          cache.model.possible = fromModel.length - cache.model.added;
          cache.model.confirmed = merged.filter((d) => d.model && d.model.agrees && d.source !== 'model').length;
          cache.merged = merged;
        } catch (err) {
          cache.model = { status: 'failed', error: `merge: ${err.message || err}` };
          console.warn('[PII Review Automation] model merge failed', err);
        }
      }
      const run = state.lastRun;
      if (!run || run.leftModel.text !== text) { showStatus(cache.model.status); return; }
      const gen = ++state.gen;
      finishAnalysis({ gen, reason: 'model', ...run }).catch((err) => console.warn('[PII Review Automation] analysis failed', err));
    }

    function modelNotices() {
      const m = state.detCache && state.detCache.model;
      if (!m || m.status === 'off' || m.status === 'cancelled') return [];
      const M = P.modelClient.MESSAGES;
      if (m.status === 'ready' || m.status === 'partial') {
        const parts = [];
        if (m.added) parts.push(`${m.added} new finding${m.added > 1 ? 's' : ''}`);
        if (m.possible) parts.push(`${m.possible} possible`);
        if (m.confirmed) parts.push(`${m.confirmed} confirmed`);
        return [{ key: 'model', title: `${m.status === 'partial' ? M.partial : 'Model: done'} — ${parts.join(', ') || 'nothing new'}.`,
          details: [`Model suggestions are marked "model" in each finding. Took ${Math.round((m.ms || 0) / 100) / 10} s.`] }];
      }
      const details = m.error ? [m.error] : [];
      if (m.status === 'not-installed') details.push('An administrator can add the model with "npm run setup-model" and reload the extension.');
      return [{ key: `model-${m.status}`, title: M[m.status] || `Model: ${m.status}`, details }];
    }

    const refreshModelSwitch = async () => {
      const on = await P.modelClient.enabled(policy);
      if (on === state.modelOn) return;
      state.modelOn = on;
      if (state.detCache) { state.detCache.model = null; state.detCache.merged = null; }
      analyze('model-switch', true);
    };
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[P.modelClient.PREF_KEY]) refreshModelSwitch();
      });
    }

    P.watcher.start({
      onChange: (reason) => analyze(reason),
      delay: () => Math.min(1500, Math.max(P.SELECTORS.debounceMs || 600, state.lastMs)),
      isRelevant(node, type) {
        if (panel.contains(node)) return false;
        if (node && (node.id === 'piira-autofill-trigger' || node.id === 'piira-underline-only' || node.id === 'piira-tip')) return false;
        // An attribute change can change a label but never the words: the text is not read again for it.
        const text = type !== 'attributes';
        if (!stickyConnected()) { state.dirtyLeft = state.dirtyRight = true; return true; }
        const { left, right } = state.sticky.loc;
        if (left.contains(node)) { if (text) state.dirtyLeft = true; return true; }
        if (right.contains(node)) { if (text) state.dirtyRight = true; return true; }
        return false;
      },
    });

    // Test pages only (test.html sets testMode): timings of the private steps.
    if (P.testMode) P._debug = { collectAutoFillTargets, renderHighlights, renderPanel, state };

    // Answers given in another tab: apply them here too.
    P.learning.onChange(() => rerun('learning-sync'));
    // Team sync (off until configured): every remembered answer is offered, and core/cloud-share.js
    // keeps only company names and plain "not PII" words. Submit sends the queue; the tool never presses it.
    P.learning.onRecord((answer) => P.cloud.queue(state.fileName, answer));
    P.cloud.watchSubmit();
    P.cloud.onChange(() => renderPanel());

    Promise.all([P.config.load(), P.config.loadPrefs(), P.knownNames.load(policy.extraKnownNames), P.kb.load(), P.learning.load(),
      P.modelClient.enabled(policy).then((on) => { state.modelOn = on; })]).then(([, prefs]) => {
      state.labelSetPref = prefs && ['standard', 'golden'].includes(prefs.labelSet) ? prefs.labelSet : 'auto';
      if (prefs && prefs.project && prefs.project !== 'auto' && P.projects.PROFILES[prefs.project]) P.SETTINGS.project = prefs.project;
      panel.preferOpen(prefs && prefs.panelOpen === true);
      panel.setLauncherPos(prefs && prefs.launcherPos);
      analyze('initial');
    });
  }
})(globalThis);
