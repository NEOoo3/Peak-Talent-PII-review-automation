// "Click setup": the reviewer points at the LEFT document, the RIGHT document
// and one labeled PII span. While picking, the reviewer's clicks are caught by
// the extension and NOT passed to the site, so nothing on the page is
// triggered. The extension itself never clicks anything.
(function (g) {
  'use strict';
  const P = g.PIIRA;

  const BLOCKED = ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'auxclick', 'contextmenu'];

  function start(panel, { onDone, onCancel }) {
    const resolve = P.compare.labelResolver(P.SELECTORS);
    const layer = panel.layer;
    const STEPS = ['left', 'right', 'label'];
    let step = 0;
    let hovered = null;
    let chosen = null;
    let narrower = [];
    const picked = {};
    let raf = 0;

    const box = (cls, text) => {
      const b = document.createElement('div');
      b.className = 'pick-box ' + cls;
      const t = document.createElement('span');
      t.className = 'pick-tag';
      t.textContent = text;
      b.append(t);
      layer.append(b);
      return b;
    };
    const hoverBox = box('hover', '');
    const fixedBoxes = [];

    const ownEvent = (e) => e.composedPath().includes(panel.host);
    const inside = (el, root) => root && (el === root || root.contains(el));

    function candidate(target) {
      if (!target || target.nodeType !== 1) return null;
      let el = target;
      const kind = STEPS[step];
      if (kind === 'label') {
        if (!inside(el, picked.right)) return null;
        for (let k = 0, cur = el; k < 5 && cur && cur !== picked.right; k++, cur = cur.parentElement) {
          if (P.autodetect.labelSpecFor(cur, resolve)) return cur;
        }
        return el;
      }
      while (el && el !== document.body && (el.textContent.trim().length < 80 || el.getBoundingClientRect().width < 150)) {
        el = el.parentElement;
      }
      if (!el || el === document.body || el === document.documentElement) return null;
      // Clicking a paragraph should select the whole document: climb through wrappers of
      // about the same width, stopping before the container that holds both panels.
      for (let k = 0; k < 10; k++) {
        const parent = el.parentElement;
        if (!parent || parent === document.body || parent === document.documentElement) break;
        if (kind === 'right' && inside(picked.left, parent)) break;
        if (parent.getBoundingClientRect().width > el.getBoundingClientRect().width * 1.2) break;
        el = parent;
      }
      if (kind === 'right' && (inside(el, picked.left) || inside(picked.left, el))) return null;
      return el;
    }

    function place(b, el, label) {
      if (!el || !el.isConnected) { b.style.display = 'none'; return; }
      const r = el.getBoundingClientRect();
      b.style.display = 'block';
      b.style.left = r.left + 'px';
      b.style.top = r.top + 'px';
      b.style.width = r.width + 'px';
      b.style.height = r.height + 'px';
      if (label != null) b.firstChild.textContent = label;
    }

    function loop() {
      place(hoverBox, chosen || hovered, null);
      for (const f of fixedBoxes) place(f.box, f.el, null);
      raf = requestAnimationFrame(loop);
    }

    function describe(el) {
      const kind = STEPS[step];
      if (kind === 'label') {
        const spec = P.autodetect.labelSpecFor(el, resolve);
        return spec
          ? { text: `Label "${spec.name}" found (${spec.via}).`, ok: true }
          : { text: "This element doesn't say which label it is. Try 'Wider', or pick a different label.", ok: false };
      }
      const n = el.textContent.trim().length;
      return { text: `${n.toLocaleString()} characters of text selected.`, ok: n >= 80 };
    }

    function render() {
      const kind = STEPS[step];
      const titles = {
        left: 'Click the ORIGINAL document (left panel)',
        right: 'Click the REVIEWED document (right panel)',
        label: 'Click one PII label on the right document',
      };
      const help = {
        left: 'Move the mouse over the page. The blue box shows what will be used. Click to choose it.',
        right: 'Choose the whole reviewed document, not just one paragraph.',
        label: 'Click any text that already has a PII label. If this task has no labels yet, press Skip.',
      };
      const buttons = [];
      let detail = null;
      if (chosen) {
        const d = describe(chosen);
        detail = { text: d.text, warn: !d.ok };
        const parent = chosen.parentElement;
        const canWiden = parent && parent !== document.body && (kind !== 'label' || inside(parent, picked.right) && parent !== picked.right);
        buttons.push({ label: 'Use this', primary: true, onClick: accept });
        if (canWiden) buttons.push({ label: 'Wider ↑', onClick: () => { narrower.push(chosen); chosen = parent; render(); } });
        if (narrower.length) buttons.push({ label: 'Narrower ↓', onClick: () => { chosen = narrower.pop(); render(); } });
        buttons.push({ label: 'Pick again', onClick: () => { chosen = null; narrower = []; render(); } });
      }
      if (kind === 'label') buttons.push({ label: 'Skip', onClick: () => finish(null) });
      buttons.push({ label: 'Cancel', onClick: cancel });
      hoverBox.firstChild.textContent = kind === 'label' ? 'LABEL' : kind.toUpperCase();
      panel.showSetup({ step: step + 1, total: STEPS.length, title: titles[kind], help: help[kind], detail, buttons });
    }

    function accept() {
      const kind = STEPS[step];
      if (kind === 'label') { finish(chosen); return; }
      picked[kind] = chosen;
      fixedBoxes.push({ el: chosen, box: box('fixed', kind === 'left' ? 'LEFT ✓' : 'RIGHT ✓') });
      chosen = null;
      narrower = [];
      step++;
      render();
    }

    function finish(labelEl) {
      let label = null;
      let via = '';
      if (labelEl) {
        const spec = P.autodetect.labelSpecFor(labelEl, resolve);
        if (spec) { label = spec.spec; via = spec.via; }
      }
      if (!label) {
        const pattern = P.autodetect.detectLabelPattern(picked.right, resolve);
        if (pattern) { label = pattern.spec; via = pattern.via; }
      }
      const setup = {
        leftDocument: P.autodetect.cssFor(picked.left),
        rightDocument: P.autodetect.cssFor(picked.right),
        label,
        labelVia: via,
        method: 'manual',
      };
      stop();
      onDone(setup);
    }

    function cancel() { stop(); onCancel(); }

    const onMove = (e) => {
      if (ownEvent(e) || chosen) return;
      hovered = candidate(e.composedPath()[0]);
    };
    const onBlock = (e) => {
      if (ownEvent(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type === 'click') {
        const c = candidate(e.composedPath()[0]);
        if (c) { chosen = c; narrower = []; render(); }
      }
    };

    function stop() {
      cancelAnimationFrame(raf);
      removeEventListener('mousemove', onMove, true);
      for (const t of BLOCKED) removeEventListener(t, onBlock, true);
      hoverBox.remove();
      fixedBoxes.forEach((f) => f.box.remove());
    }

    addEventListener('mousemove', onMove, true);
    for (const t of BLOCKED) addEventListener(t, onBlock, true);
    loop();
    render();
    return { cancel };
  }

  /** Briefly outline the detected LEFT/RIGHT panels. */
  function showPanels(panel, left, right) {
    const items = [[left, 'LEFT (original)'], [right, 'RIGHT (reviewed)']].filter((x) => x[0]);
    const boxes = items.map(([el, text]) => {
      const b = document.createElement('div');
      b.className = 'pick-box fixed';
      const t = document.createElement('span');
      t.className = 'pick-tag';
      t.textContent = text;
      b.append(t);
      panel.layer.append(b);
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return [b, el];
    });
    const t0 = performance.now();
    const tick = () => {
      for (const [b, el] of boxes) {
        const r = el.getBoundingClientRect();
        Object.assign(b.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
      }
      if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
      else boxes.forEach(([b]) => b.remove());
    };
    tick();
  }

  P.picker = { start, showPanels };
})(globalThis);
