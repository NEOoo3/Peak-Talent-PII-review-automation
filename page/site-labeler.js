// Labels text on the review site the way a person does it, through the site's own popup:
// select the text -> "Choose a label" dialog -> pick the exact label -> leave "Annotate matching entries" as asked ->
// Apply -> wait for the dialog to close. One label at a time; Submit is never touched.
// Also the word rules Auto-Fill follows: one label per value, never over an existing label.
(function (g) {
  'use strict';
  const P = g.PIIRA;

  const MIN_TOKEN_LENGTH = 2;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(fn, timeoutMs, everyMs) {
    const end = performance.now() + timeoutMs;
    for (;;) {
      let v = null;
      try { v = fn(); } catch (err) { v = null; }
      if (v) return v;
      if (performance.now() >= end) return null;
      await sleep(everyMs || 40);
    }
  }

  function simulateClick(el, portal) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const opts = {
      bubbles: true, cancelable: true, view: window,
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
    };
    const pointer = typeof PointerEvent === 'function';
    if (pointer) el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    if (!portal) {
      if (pointer) el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
    }
    el.click();
  }

  const normLabel = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const findDialog = () => document.querySelector('div[role="dialog"][aria-label="Choose a label"]');
  const dialogButtons = (dialog) => Array.from(dialog.querySelectorAll('button'));
  const findApply = (dialog) => dialogButtons(dialog).find((b) => /apply/i.test(b.textContent || '')) ||
    dialog.querySelector('button.ant-btn-primary');
  const findCancel = (dialog) => dialogButtons(dialog).find((b) => /cancel/i.test(b.textContent || ''));

  async function closeStrayDialog() {
    const old = findDialog();
    if (!old) return;
    const cancel = findCancel(old);
    if (cancel) simulateClick(cancel);
    await waitFor(() => !findDialog(), 1500);
  }

  async function openLabelDialog(range) {
    const sel = window.getSelection();
    for (let attempt = 0; attempt < 2; attempt++) {
      sel.removeAllRanges();
      sel.addRange(range.cloneRange());
      const targetEl = range.endContainer.nodeType === Node.TEXT_NODE ? range.endContainer.parentElement : range.endContainer;
      if (targetEl && targetEl.scrollIntoView) targetEl.scrollIntoView({ block: 'center', behavior: 'auto' });
      await sleep(60);
      const rect = range.getBoundingClientRect();
      const evOpts = {
        bubbles: true, cancelable: true, view: window,
        clientX: rect.left + Math.min(20, rect.width / 2), clientY: rect.top + rect.height / 2,
      };
      if (targetEl) {
        if (attempt === 1 && typeof PointerEvent === 'function') targetEl.dispatchEvent(new PointerEvent('pointerdown', evOpts));
        targetEl.dispatchEvent(new MouseEvent('mousedown', evOpts));
        if (attempt === 1 && typeof PointerEvent === 'function') targetEl.dispatchEvent(new PointerEvent('pointerup', evOpts));
        targetEl.dispatchEvent(new MouseEvent('mouseup', evOpts));
        if (attempt === 1) targetEl.dispatchEvent(new MouseEvent('click', evOpts));
      }
      document.dispatchEvent(new Event('selectionchange', { bubbles: true }));
      const dialog = await waitFor(findDialog, attempt === 0 ? 2500 : 3500);
      if (dialog) return dialog;
    }
    return null;
  }

  function optionsOf(selectInput) {
    const list = [];
    const listId = selectInput && selectInput.getAttribute('aria-controls');
    const listEl = listId ? document.getElementById(listId) : null;
    if (listEl) list.push(...listEl.querySelectorAll('[role="option"], .ant-select-item-option'));
    list.push(...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option'));
    return list;
  }

  // The option whose text is exactly the label ("Address" never picks "Email Address").
  const exactOption = (selectInput, label) => {
    const want = normLabel(label);
    return optionsOf(selectInput).find((o) => normLabel(o.getAttribute('title') || o.getAttribute('aria-label') || o.textContent) === want);
  };

  async function chooseLabel(dialog, targetLabel) {
    const selectBox = dialog.querySelector('.ant-select');
    const selectInput = dialog.querySelector('input.ant-select-input[role="combobox"]');
    if (!(selectInput && selectInput.getAttribute('aria-expanded') === 'true')) {
      if (selectBox) simulateClick(selectBox);
      if (selectInput) {
        selectInput.focus();
        selectInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
      }
    }
    let opt = await waitFor(() => exactOption(selectInput, targetLabel), 700);
    if (!opt && selectInput) {
      // A long list (the Golden project's 80 labels) is virtual: type the name so the option is drawn.
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      if (nativeSetter && nativeSetter.set) nativeSetter.set.call(selectInput, targetLabel); else selectInput.value = targetLabel;
      selectInput.dispatchEvent(new Event('input', { bubbles: true }));
      opt = await waitFor(() => exactOption(selectInput, targetLabel), 2500);
    }
    if (!opt) return false;
    simulateClick(opt, true);
    return true;
  }

  /** Label one range on the site. Resolves true when the dialog applied and closed. */
  async function applySingleAnnotation(range, targetLabel, tickMatching) {
    if (!range || !targetLabel) return false;
    await closeStrayDialog();

    const dialog = await openLabelDialog(range);
    if (!dialog) { window.getSelection().removeAllRanges(); return false; }

    const cancelAndFail = async () => {
      const cancel = findCancel(dialog);
      if (cancel) simulateClick(cancel);
      await waitFor(() => !findDialog(), 1500);
      window.getSelection().removeAllRanges();
      return false;
    };

    if (!(await chooseLabel(dialog, targetLabel))) return cancelAndFail();

    const checkbox = dialog.querySelector('input.ant-checkbox-input[type="checkbox"]');
    if (checkbox) {
      await sleep(80);
      if (checkbox.checked !== Boolean(tickMatching)) simulateClick(dialog.querySelector('label.ant-checkbox-wrapper') || checkbox);
      await waitFor(() => checkbox.checked === Boolean(tickMatching), 800);
    }

    const applyBtn = await waitFor(() => {
      const b = findApply(dialog);
      return b && !b.disabled ? b : null;
    }, 2500);
    if (!applyBtn) return cancelAndFail();

    simulateClick(applyBtn);
    if (!(await waitFor(() => !findDialog(), 3000))) return cancelAndFail();
    window.getSelection().removeAllRanges();
    await sleep(120);
    return true;
  }

  // ---------- word rules

  const isWordChar = (ch) => Boolean(ch && /[\p{L}\p{N}_]/u.test(ch));
  function isWordBounded(text, start, end) {
    const prev = start > 0 ? text[start - 1] : '';
    const next = end < text.length ? text[end] : '';
    if (isWordChar(text[start]) && isWordChar(prev)) return false;
    if (isWordChar(text[end - 1]) && isWordChar(next)) return false;
    return true;
  }

  const allWordBoundedIndexes = (text, needle) => {
    const out = [];
    if (!needle) return out;
    for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
      if (isWordBounded(text, i, i + needle.length)) {
        out.push(i);
        i += needle.length - 1;
      }
    }
    return out;
  };

  // Trim edge punctuation; null when what is left is too short to be a value ("a", "-").
  function trimSpan(text, s, e) {
    while (s < e && /[\s,.;:!?()"'[\]{}<>]/.test(text[s])) s++;
    while (e > s && /[\s,.;:!?()"'[\]{}<>]/.test(text[e - 1])) e--;
    return text.slice(s, e).replace(/[^\p{L}\p{N}]/gu, '').length >= MIN_TOKEN_LENGTH ? { start: s, end: e } : null;
  }

  // One label per value: "the information" (a business name) or "Pbs Uymm" (New York) is a single label
  // across both words. A value is only split where it breaks onto a new line. Links stay whole.
  const WHOLE_LABELS = new Set(['URL/Link']);
  function valueSpans(text, start, end, label) {
    if (WHOLE_LABELS.has(label)) return [{ start, end }];
    const out = [];
    for (const m of text.slice(start, end).matchAll(/[^\n\r]+/g)) {
      const sp = trimSpan(text, start + m.index, start + m.index + m[0].length);
      if (sp) out.push(sp);
    }
    return out;
  }

  // Word by word: the fallback when part of a value is already labeled on the page, so a new label never
  // nests in or overlaps an existing one.
  function wordSpans(text, start, end, label) {
    if (WHOLE_LABELS.has(label)) return [{ start, end }];
    const out = [];
    for (const m of text.slice(start, end).matchAll(/\S+/g)) {
      const sp = trimSpan(text, start + m.index, start + m.index + m[0].length);
      if (sp) out.push(sp);
    }
    return out;
  }

  // The words of a value that are still free (isFree(start, end)), joined back into runs: with "Tata"
  // labeled, "Tata Consultancy Services Limited" leaves one run, "Consultancy Services Limited".
  function freeRuns(text, start, end, label, isFree) {
    const out = [];
    for (const w of wordSpans(text, start, end, label)) {
      const last = out[out.length - 1];
      if (!isFree(w.start, w.end)) { if (last) last.closed = true; continue; }
      if (last && !last.closed && /^\s+$/.test(text.slice(last.end, w.start))) last.end = w.end;
      else out.push({ start: w.start, end: w.end });
    }
    return out.map(({ start: s, end: e }) => ({ start: s, end: e }));
  }

  /**
   * Is any part of the range already inside a label on the page? Read from the DOM right before labeling,
   * so a label added a moment ago (by the reviewer or by Auto-Fill) is never labeled twice.
   * @param selectors the page setup's label selectors (S.rightLabelSpan); root: the right document
   */
  function rangeHasLabel(range, selectors, root) {
    const sel = (selectors || []).join(',');
    if (!sel || !range || !root) return false;
    const elOf = (n) => (n && n.nodeType === 3 ? n.parentElement : n);
    // A label is a small element inside the document. A saved page setup can use a broad selector that
    // also matches a wrapper (or the document itself); counting that would block every target.
    const isLabel = (el) => Boolean(el && el !== root && root.contains(el) && !el.contains(root) &&
      (el.textContent || '').trim().length <= 300);
    try {
      if ([range.startContainer, range.endContainer].some((n) => { const e = elOf(n); return e && isLabel(e.closest(sel)); })) return true;
      const box = elOf(range.commonAncestorContainer);
      return Boolean(box && [...box.querySelectorAll(sel)].some((el) => isLabel(el) && range.intersectsNode(el)));
    } catch (e) {
      return false;
    }
  }

  P.siteLabeler = {
    MIN_TOKEN_LENGTH, sleep, waitFor, simulateClick, applySingleAnnotation, closeStrayDialog,
    isWordBounded, allWordBoundedIndexes, valueSpans, wordSpans, freeRuns, rangeHasLabel,
  };
})(globalThis);
