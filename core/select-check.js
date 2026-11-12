// Select-to-check: select text in either document and a small card under it says whether it is PII,
// with the reasons from the rules, the model and the offline knowledge base. A suggestion only — it never
// changes a label. Closes on click elsewhere, Escape or scroll. Option: "Check selected text" (on).
//
//   verdict(input) -> {kind, title, reasons}   pure, unit-tested
//     kind: 'pii' | 'possible' | 'not' | 'none'
(function (g) {
  'use strict';
  const P = g.PIIRA;

  const PREF_KEY = 'selectCheck';
  const MIN = 2;
  const MAX = 300;
  const overlap = (a, s, e) => Math.min(a.end, e) - Math.max(a.start, s);

  /**
   * @param input {text, context, selStart, selEnd, detections}
   *   text        the selected text
   *   context     the text the detections were run on (the selection's line, or the document)
   *   selStart/End the selection inside `context`
   *   detections  detections over `context` (rules, and the model's when merged)
   */
  function verdict({ text, context, selStart, selEnd, detections }) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    const reasons = [];
    if (!t) return { kind: 'none', title: 'Nothing selected', reasons };

    // Never PII by the project's rules.
    if (/^(?:https?:\/\/|www\.)\S+$/i.test(t) && P.isPublicUrl && P.isPublicUrl(t)) {
      const host = t.replace(/^[a-z]+:\/\//i, '').replace(/[\/?#:].*$/, '').toLowerCase();
      const rank = P.kb && P.kb.siteRank(host);
      return { kind: 'not', title: 'Not PII — public website', reasons: [rank ? `Popular site (rank ${rank.toLocaleString()} of the most visited), homepage only` : 'Package registry, funding page, localhost or whitelisted site'] };
    }
    // A public name, selected whole or in part ("Consultancy" in "Tata Consultancy Services").
    let known = P.knownNames.lookup(t);
    if (!known && context) {
      const ls = context.lastIndexOf('\n', selStart - 1) + 1;
      let le = context.indexOf('\n', selEnd);
      if (le === -1) le = context.length;
      const k = P.knownNames.findIn(context.slice(ls, le)).find((x) => x.start + ls < selEnd && x.end + ls > selStart);
      if (k) known = k;
    }
    if (known) return { kind: 'not', title: 'Not PII — public name', reasons: [`${known.name}: ${known.category}`, 'Keep it as it is; labeling it is over-scrubbing'] };
    if (P.isDepartment(t)) return { kind: 'not', title: 'Not PII — department name', reasons: ['Departments and teams are never PII'] };
    if (P.isDocPhrase(t)) return { kind: 'not', title: 'Not PII — a heading', reasons: ['Words of a form, invoice or table heading'] };
    if (P.textModel && P.textModel.isPanelChrome(t)) return { kind: 'not', title: 'Not PII — part of the review site', reasons: ['The panel heading, not the document'] };

    // What the rules (and the model, when merged) found on the selection.
    const hits = (detections || []).filter((d) => overlap(d, selStart, selEnd) > 0)
      .sort((a, b) => overlap(b, selStart, selEnd) - overlap(a, selStart, selEnd) || b.confidence - a.confidence);
    const best = hits[0];
    const kbNotes = [];
    const company = P.kb && P.kb.company(t);
    if (company) kbNotes.push(`Known company (Wikipedia in ${company.links} languages)`);
    const figure = P.kb && P.kb.publicFigure(t);
    if (figure) kbNotes.push(`Also the name of a public figure (Wikipedia in ${figure.links} languages) — still PII unless it clearly refers to them`);

    if (best) {
      const from = best.source === 'model' ? `Model: ${Math.round(((best.model && best.model.score) || 0) * 100)}% sure`
        : best.source === 'context' ? `Its column or field says so · ${Math.round(best.confidence * 100)}% sure`
          : `Found by the rules · ${Math.round(best.confidence * 100)}% sure`;
      reasons.push(best.type && best.type !== best.label ? `${best.type}` : best.label, from);
      if (best.model && best.source !== 'model') reasons.push(best.model.agrees ? `Model agrees (${Math.round(best.model.score * 100)}%)` : `Model suggests ${best.model.label} (${Math.round(best.model.score * 100)}%)`);
      if (context && (best.start < selStart || best.end > selEnd) && overlap(best, selStart, selEnd) < best.end - best.start) {
        reasons.push(`The full value is “${context.slice(best.start, best.end).replace(/\s+/g, ' ').slice(0, 80)}”`);
      }
      const sure = best.confidence >= P.REVIEW_THRESHOLD;
      return { kind: sure ? 'pii' : 'possible', title: `${sure ? 'PII' : 'Possibly PII'} — ${best.label}`, reasons: reasons.concat(kbNotes).slice(0, 4) };
    }
    if (company) return { kind: 'possible', title: 'Possibly PII — Business Name', reasons: kbNotes.concat(['The rules found no company here; check the context']) };
    if (figure) return { kind: 'possible', title: 'Possibly PII — Person Name', reasons: kbNotes };
    return { kind: 'none', title: 'No PII found', reasons: ['Rules, model and knowledge base found nothing here'] };
  }

  // ------------------------------------------------------------------ the card

  const COLORS = { pii: '#d93025', possible: '#e37400', not: '#188038', none: '#80868b' };
  const CSS_TEXT = `
    :host { all: initial; }
    .card { position: fixed; max-width: 320px; min-width: 200px; box-sizing: border-box; padding: 10px 12px 10px;
      background: #fff; color: #111; border: 1px solid #e3e3e3; border-radius: 10px; box-shadow: 0 6px 24px #0000002e;
      font: 12px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; z-index: 2147483646; }
    .sel { color: #5f6368; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 18px; }
    .title { display: flex; align-items: center; gap: 6px; font-weight: 650; font-size: 13px; margin: 4px 0 2px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
    ul { margin: 2px 0 0; padding-left: 14px; color: #3c4043; }
    li { margin: 1px 0; }
    .x { position: absolute; top: 4px; right: 6px; border: 0; background: none; font-size: 15px; line-height: 1; color: #80868b; cursor: pointer; padding: 2px 4px; }
    .foot { margin-top: 6px; color: #80868b; font-size: 10.5px; }
    .rep { background: none; border: 0; padding: 0; font: inherit; color: inherit; text-decoration: underline; cursor: pointer; }
    .rep:disabled { text-decoration: none; cursor: default; }
    .chip { position: fixed; display: flex; align-items: center; gap: 6px; max-width: 360px; padding: 3px 9px;
      background: #fff; color: #111; border: 1px solid #e3e3e3; border-radius: 12px; box-shadow: 0 2px 10px #00000026;
      font: 600 11.5px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; white-space: nowrap; overflow: hidden;
      text-overflow: ellipsis; z-index: 2147483646; pointer-events: none; transition: opacity .3s; }
    .chip.fade { opacity: 0; }
    @media (prefers-color-scheme: dark) {
      .chip { background: #1f1f1f; color: #eee; border-color: #3a3a3a; }
      .card { background: #1f1f1f; color: #eee; border-color: #3a3a3a; }
      .sel, .foot { color: #a8a8a8; } ul { color: #d0d0d0; }
    }`;

  let host = null;
  let root = null;
  let timer = null;
  let enabled = true;
  let getState = null;
  let lastSide = null;     // 'left' | 'right': where the last checked selection was
  let lastContext = null;  // a few lines around it, for a report

  function hide() {
    clearTimeout(timer);
    if (root) root.replaceChildren(styleEl());
  }

  function styleEl() {
    const s = document.createElement('style');
    s.textContent = CSS_TEXT;
    return s;
  }

  function ensureHost() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.setAttribute('data-piira-select-check', '');
    root = host.attachShadow({ mode: 'closed' });
    root.append(styleEl());
    document.documentElement.append(host);
  }

  function show(rect, selected, v) {
    ensureHost();
    hide();
    const card = document.createElement('div');
    card.className = 'card';
    const sel = document.createElement('div');
    sel.className = 'sel';
    sel.textContent = `“${selected.replace(/\s+/g, ' ').trim()}”`;
    const title = document.createElement('div');
    title.className = 'title';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = COLORS[v.kind];
    title.append(dot, document.createTextNode(v.title));
    const ul = document.createElement('ul');
    for (const r of v.reasons) { const li = document.createElement('li'); li.textContent = r; ul.append(li); }
    const foot = document.createElement('div');
    foot.className = 'foot';
    foot.textContent = 'Suggestion only · runs in your browser · ';
    // Missed PII, or a verdict that looks wrong: save a small report for the maintainer.
    const rep = document.createElement('button');
    rep.className = 'rep';
    rep.textContent = 'Report';
    rep.title = 'Save a small report about this selection (it contains a few lines of the document)';
    rep.addEventListener('click', () => {
      const st = getState && getState();
      P.report.download(`pii-report-${P.report.slug(st && st.fileName)}-${P.report.stamp()}.json`, P.report.selectionReport({
        text: selected.replace(/\s+/g, ' ').trim(), verdict: v, side: lastSide, fileName: st && st.fileName, context: lastContext,
      }));
      rep.textContent = 'Saved ✓';
      rep.disabled = true;
    });
    foot.append(rep);
    const x = document.createElement('button');
    x.className = 'x';
    x.textContent = '×';
    x.title = 'Close (Esc)';
    x.addEventListener('click', hide);
    card.append(x, sel, title);
    if (v.reasons.length) card.append(ul);
    card.append(foot);
    card.addEventListener('mousedown', (e) => e.stopPropagation());
    root.append(card);
    // Below the selection (the site's own label tools sit above or on it); above when there is no room.
    const w = Math.min(320, card.offsetWidth || 320);
    const h = card.offsetHeight || 120;
    let x0 = Math.min(Math.max(8, rect.left), innerWidth - w - 8);
    let y0 = rect.bottom + 8;
    if (y0 + h > innerHeight - 8) y0 = Math.max(8, rect.top - h - 8);
    card.style.left = `${Math.round(x0)}px`;
    card.style.top = `${Math.round(y0)}px`;
  }

  // On the right document a selection is usually the reviewer labeling it: the site opens its own label
  // popup under the selection, so only a one-line chip above it, which fades by itself.
  const CHIP_MS = 3500;
  function chip(rect, v) {
    ensureHost();
    hide();
    const el = document.createElement('div');
    el.className = 'chip';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = COLORS[v.kind];
    el.append(dot, document.createTextNode(v.reasons[0] && v.kind !== 'pii' ? `${v.title} · ${v.reasons[0]}` : v.title));
    root.append(el);
    const w = Math.min(360, el.offsetWidth || 200);
    const h = el.offsetHeight || 22;
    el.style.left = `${Math.round(Math.min(Math.max(8, rect.left), innerWidth - w - 8))}px`;
    el.style.top = `${Math.round(rect.top - h - 6 >= 8 ? rect.top - h - 6 : rect.bottom + 6)}px`;
    timer = setTimeout(() => { el.classList.add('fade'); timer = setTimeout(hide, 300); }, CHIP_MS);
  }

  // The whole document, analysed once per text with the task's file type (a column of passports in an
  // id_passport table is recognised from any part of a row).
  const fullCache = { text: null, hint: null, dets: null };
  function fullRun(text, fileName) {
    if (fullCache.text !== text || fullCache.hint !== fileName) {
      fullCache.dets = P.engine.run(text, { hint: P.fileHint.parse(fileName || '') });
      fullCache.text = text;
      fullCache.hint = fileName;
    }
    return fullCache.dets;
  }

  const offsetIn = (model, node, off) => P.textModel.offsetOf(model, node, off);

  function check() {
    const st = getState && getState();
    if (!enabled || !st || !st.loc) return;
    const s = document.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) return;
    const selected = s.toString();
    if (selected.trim().length < MIN || selected.length > MAX) return;
    const range = s.getRangeAt(0);
    const inLeft = st.loc.left.contains(range.commonAncestorContainer);
    const inRight = !inLeft && st.loc.right.contains(range.commonAncestorContainer);
    if (!inLeft && !inRight) return;
    const model = inLeft ? st.leftModel : st.rightModel;
    if (!model) return;
    let a = offsetIn(model, range.startContainer, range.startOffset);
    let b = offsetIn(model, range.endContainer, range.endOffset);
    if (a < 0 || b <= a) { // selection boundaries on elements: find the text instead
      a = model.text.indexOf(selected.trim());
      b = a >= 0 ? a + selected.trim().length : -1;
    }
    let v;
    let shown = selected;
    try {
      if (a >= 0 && b > a) {
        // Snap to whole words: a selection that starts or ends inside a word ("ta Consultancy") means the word.
        const word = /[\p{L}\p{N}_@.'’-]/u;
        while (a > 0 && word.test(model.text[a - 1]) && word.test(model.text[a])) a--;
        while (b < model.text.length && word.test(model.text[b]) && word.test(model.text[b - 1])) b++;
        shown = model.text.slice(a, b);
        lastSide = inLeft ? 'left' : 'right';
        lastContext = model.text.slice(Math.max(0, a - 200), Math.min(model.text.length, b + 200));
        // The line around the selection is the context; on the left the analysis (rules + model) is reused.
        const ls = model.text.lastIndexOf('\n', a - 1) + 1;
        let le = model.text.indexOf('\n', b);
        if (le === -1) le = model.text.length;
        const line = model.text.slice(ls, le);
        let dets = P.engine.run(line).map((d) => ({ ...d, start: d.start + ls, end: d.end + ls }));
        const whole = inLeft && st.detections ? st.detections : fullRun(model.text, st.fileName);
        dets = dets.concat(whole.filter((d) => d.start < le && d.end > ls));
        v = verdict({ text: shown, context: model.text, selStart: a, selEnd: b, detections: dets });
      } else {
        v = verdict({ text: selected, context: selected, selStart: 0, selEnd: selected.length, detections: P.engine.run(selected) });
      }
    } catch (err) {
      console.warn('[PII Review Automation] select-check failed', err);
      return;
    }
    // Nothing to say: no card at all (a "No PII found" card on every selection gets in the way).
    if (v.kind === 'none') { hide(); return; }
    if (inRight) chip(range.getBoundingClientRect(), v);
    else show(range.getBoundingClientRect(), shown, v);
  }

  function start(stateFn) {
    getState = stateFn;
    const later = () => { clearTimeout(timer); timer = setTimeout(check, 350); };
    document.addEventListener('mouseup', (e) => { if (!host || !e.composedPath().includes(host)) later(); }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); }, true);
    document.addEventListener('keyup', (e) => { if (e.shiftKey && e.key !== 'Escape') later(); }, true); // keyboard selection
    document.addEventListener('mousedown', (e) => { if (host && !e.composedPath().includes(host)) hide(); }, true);
    addEventListener('scroll', hide, { capture: true, passive: true });
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(PREF_KEY).then((v) => { enabled = v[PREF_KEY] !== false; }, () => {});
        chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c[PREF_KEY]) { enabled = c[PREF_KEY].newValue !== false; if (!enabled) hide(); } });
      }
    } catch (err) { /* keep the default */ }
  }

  P.selectCheck = { verdict, start, hide, PREF_KEY };
})(globalThis);
