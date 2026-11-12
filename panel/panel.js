
(function (g) {
  'use strict';
  const P = g.PIIRA;

  const D = P.decisions;

  /** Tiny element builder. Strings become text nodes (never HTML). */
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'bg') el.style.backgroundColor = v;
      else if (k === 'checked' || k === 'open' || k === 'value') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const PAGE = 100;          // findings rendered per section before "Show more"
  const SEARCH_DELAY = 250;  // ms to wait after typing before filtering

  function create(cb) {
    const host = document.createElement('div');
    host.id = 'piira-host';
    // Inline CSSOM styles are not blocked by page CSP (unlike style attributes in HTML).
    host.style.position = 'fixed';
    host.style.zIndex = '2147483646';
    host.style.top = '0';
    host.style.left = '0';
    host.style.width = '0';
    host.style.height = '0';
    // Closed on real pages. test.html sets PIIRA.testMode so automated checks can reach inside;
    // the site itself can never set this, because content scripts run in an isolated world.
    const shadow = host.attachShadow({ mode: P.testMode ? 'open' : 'closed' });
    // Clicks and typing inside the panel must not reach the site's own listeners
    // (e.g. a site shortcut firing while the reviewer types in the search box).
    for (const type of ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'keydown', 'keyup', 'keypress', 'input', 'paste', 'copy', 'cut']) {
      host.addEventListener(type, (e) => e.stopPropagation());
    }

    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(P.PANEL_CSS);
      shadow.adoptedStyleSheets = [sheet];
    } catch (e) {
      shadow.append(h('style', {}, P.PANEL_CSS));
    }

    const ui = {
      category: null,       // chip filter
      search: '',
      hideReviewed: false,
      collapsed: true,        // the panel starts closed: only the small launcher shows
      wantOpen: false,        // the reviewer left it open last time (opened on a task page only)
      shownOnce: false,
      dockLeft: false,
      open: new Set(['PI_TODO', 'BI_TODO', 'CRED_TODO', 'NOT_PII', 'CHECK', 'MISSED', 'WRONG_LABEL', 'OVERSCRUB', 'NEEDS_REVIEW', 'TASK', 'LEAKAGE', 'INCOHERENT', 'DATATYPE',
        'NOT_SENSIBLE', 'UNKNOWN_TEXT', 'OVER_REDACTED', 'UNSURE']),
      expanded: new Set(),    // findings / cards whose details are shown
      dismissed: new Set(),   // notices the reviewer closed (this tab only)
      label: '',              // label filter ('' = all labels)
      limit: {},              // per-section number of findings rendered
      cursor: null,           // id of the finding shown by Next/Previous issue
      groupState: new Map(),  // "<section>|<label>" -> open (true) / closed (false), when the reviewer toggled it
      teach: null,            // {key, ids, pii, from}: the "what is it?" question shown under a value or group
      confirmReset: false,
      adding: false,          // the "Add annotation" box is open
      addText: '',            // its text: the last selection on the page, unless the reviewer typed one
      addEdited: false,
    };
    let last = null;   // last render() args
    let mode = 'status';
    let message = { text: 'Starting…', details: [] };
    let setupInfo = null;    // current click-setup step
    let searchTimer = null;
    let busyEl = null;       // "Updating…" indicator, updated without a full redraw
    let busyText = '';
    // Pages where a review task can be open. Elsewhere (dashboard, lists) nothing is shown
    // at all until documents are found. Checked on every draw: the site changes pages without reloading.
    const isReviewPage = () => /review|annotat|task|label/i.test(location.pathname + location.hash);
    const setOpen = (open) => {
      ui.collapsed = !open;
      if (cb.onOpenChange) cb.onOpenChange(open);
      redraw();
    };

    // The launcher can be dragged anywhere on the screen, so it never covers the site's own
    // buttons. Its spot (distance from the right and bottom edges) is remembered. A press that
    // moves less than a few pixels is a click and opens the panel.
    const DRAG_PX = 4;
    const EDGE = 6;
    let launcherPos = null;     // { right, bottom } in px; null = the default bottom corner
    let dragged = false;        // the last press was a drag: do not treat it as a click
    const validPos = (p) => p && Number.isFinite(p.right) && Number.isFinite(p.bottom) ? { right: p.right, bottom: p.bottom } : null;
    function clampPos(p, el) {
      const r = el.getBoundingClientRect();
      const w = Math.max(r.width, 70);
      const hgt = Math.max(r.height, 34);
      return {
        right: Math.round(Math.min(Math.max(p.right, EDGE), Math.max(EDGE, innerWidth - w - EDGE))),
        bottom: Math.round(Math.min(Math.max(p.bottom, EDGE), Math.max(EDGE, innerHeight - hgt - EDGE))),
      };
    }
    function placeLauncher(el) {
      if (!el) return;
      if (!launcherPos) { el.style.removeProperty('right'); el.style.removeProperty('bottom'); el.style.removeProperty('left'); return; }
      const p = clampPos(launcherPos, el);
      el.style.left = 'auto';
      el.style.right = p.right + 'px';
      el.style.bottom = p.bottom + 'px';
    }
    function moveLauncher(p, save) {
      const el = root.querySelector('.launcher-group');
      launcherPos = el ? clampPos(p, el) : p;
      placeLauncher(el);
      if (save && cb.onLauncherMove) cb.onLauncherMove(launcherPos);
    }
    function startDrag(e) {
      if (e.button !== 0) return;
      const r = e.currentTarget.getBoundingClientRect();
      const start = { x: e.clientX, y: e.clientY, right: innerWidth - r.right, bottom: innerHeight - r.bottom };
      let moved = false;
      const onMove = (ev) => {
        const dx = ev.clientX - start.x;
        const dy = ev.clientY - start.y;
        if (!moved && Math.hypot(dx, dy) < DRAG_PX) return;
        if (!moved) { moved = true; root.classList.add('dragging'); }
        ev.preventDefault();
        moveLauncher({ right: start.right - dx, bottom: start.bottom - dy }, false);
      };
      const onUp = () => {
        removeEventListener('pointermove', onMove, true);
        removeEventListener('pointerup', onUp, true);
        removeEventListener('pointercancel', onUp, true);
        root.classList.remove('dragging');
        if (!moved) return;
        dragged = true;
        setTimeout(() => { dragged = false; }, 0); // swallow only the click that ends this drag
        moveLauncher(launcherPos, true);
      };
      // On the window, so the drag keeps going even if the panel redraws under the pointer.
      addEventListener('pointermove', onMove, true);
      addEventListener('pointerup', onUp, true);
      addEventListener('pointercancel', onUp, true);
    }
    // Keyboard: Alt + arrow keys move the launcher (Shift for bigger steps).
    function keyMove(e) {
      const step = e.shiftKey ? 48 : 16;
      const d = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
      if (!d || !e.altKey) return;
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      moveLauncher({ right: innerWidth - r.right + d[0], bottom: innerHeight - r.bottom + d[1] }, true);
    }
    addEventListener('resize', () => { if (launcherPos) placeLauncher(root.querySelector('.launcher-group')); });

    const root = h('div', { class: 'root' });
    // Outline boxes for click setup / "show panels" live in their own layer so re-renders keep them.
    const layer = h('div', { class: 'layer' });
    shadow.append(root, layer);
    (document.body || document.documentElement).append(host);

    // The wordmark (panel/brand.js) and the product badge. Without wordmark images, or if the site blocks
    // them, the brand name shows as text instead.
    function brandMark() {
      const B = P.BRAND;
      const img = (src, cls) => h('img', {
        class: 'wordmark ' + cls, src, alt: B.name, draggable: 'false',
        onerror: (e) => e.target.replaceWith(h('span', { class: 'wordmark-text ' + cls }, B.name)),
      });
      const marks = B.wordmarkBlack ? [img(B.wordmarkBlack, 'on-light'), img(B.wordmarkWhite, 'on-dark')]
        : [h('span', { class: 'wordmark-text' }, B.name)];
      return h('h1', { 'aria-label': 'PII Review Automation' }, ...marks, h('span', { class: 'product' }, 'PII Review'));
    }

    function frame(content, statusText) {
      // Re-rendering must not steal focus or the caret from the search box.
      const active = shadow.activeElement;
      const typing = active && active.classList && active.classList.contains('search');
      const caret = typing ? active.selectionStart : null;
      requestAnimationFrame(() => {
        if (!typing) return;
        const input = root.querySelector('.search');
        if (input) { input.focus(); if (caret != null) input.setSelectionRange(caret, caret); }
      });
      // Nothing on screen unless there is a task (documents found, or setting up) or this is a
      // review page, where the quiet launcher waits and the panel explains any problem.
      const visible = mode === 'result' || mode === 'setup' || isReviewPage();
      root.className = 'root' + (ui.collapsed ? ' collapsed' : '') + (ui.dockLeft ? ' dock-left' : '') + (visible ? '' : ' hidden');
      const open = last ? last.result.findings.filter((f) => D.isIssue(f) && !last.reviewed.has(f.id)).length : null;
      const highlightsOn = last ? last.highlightsOn : true;
      // On a review page with no task open yet (the task list), the launcher stays a quiet
      // grey "PII"; the explanation and setup are inside the panel.
      const state = open == null ? 'idle' : open ? 'issues' : 'clear';
      const title = mode === 'error' ? 'PII Review Automation — no task documents found yet (click to set up)'
        : state === 'issues' ? `PII Review Automation — ${open} to check` : 'Open PII Review Automation';
      root.replaceChildren(
        h('div', { class: 'launcher-group', onpointerdown: startDrag, onkeydown: keyMove },
          h('button', {
            class: 'launcher ' + state, title: `${title}. Drag to move it (or Alt + arrow keys).`, 'aria-label': title,
            onclick: () => { if (!dragged) setOpen(true); },
          },
            h('span', { class: 'launcher-dot' }),
            h('span', {}, state === 'clear' ? 'PII ✓' : 'PII'),
            state === 'issues' ? h('span', { class: 'launcher-count' }, String(open)) : null),
          mode === 'result' && last && cb.onAutoFill ? h('button', {
            class: 'launcher-fill', title: 'Label the issues in the right document automatically (Alt + A). Click again to stop. Drag to move it with the PII button.',
            onclick: () => { if (!dragged) cb.onAutoFill(); },
          }, ui.fillLabel || 'Auto-Fill PII') : null),
        h('aside', { class: 'panel', role: 'complementary', 'aria-label': 'PII Review Automation' },
          h('header', {},
            h('div', { class: 'title-row' },
              brandMark(),
              h('button', { class: 'icon-btn', title: 'Re-analyse this task', onclick: () => cb.onRefresh() }, '↻'),
              h('button', {
                class: 'icon-btn', title: 'Show/hide colour highlights on the left document',
                'aria-pressed': String(highlightsOn), onclick: () => cb.onToggleHighlights(),
              }, 'Aa'),
              h('button', { class: 'icon-btn', title: 'Move panel to the other side', onclick: () => { ui.dockLeft = !ui.dockLeft; redraw(); } }, '⇆'),
              h('button', { class: 'icon-btn', title: 'Close panel (it stays closed until you open it)', onclick: () => setOpen(false) }, '✕'),
            ),
            h('div', { class: 'status' }, statusText, (busyEl = h('span', { class: 'busy' }, busyText))),
            mode === 'result' && last ? navBar() : null,
          ),
          content,
          h('footer', {},
            h('div', { class: 'foot-row' },
              h('span', { title: 'Document text is never sent anywhere. Auto-Fill only runs when you press it; Submit is always done by you.' },
                '🔒 On-device', P.policy.current.supportContact ? ` · ${P.policy.current.supportContact}` : ''),
              releaseTag(),
              mode === 'result' && last ? h('button', {
                class: 'link-btn', title: 'Save this task with your answers as a test file (it contains the document — share it only with your team)',
                onclick: (e) => { cb.onSaveTask(); flash(e.currentTarget, 'Saved ✓'); },
              }, 'Save task for testing') : null)),
        ),
      );
      placeLauncher(root.querySelector('.launcher-group'));
    }

    // Footer release: "✦ Andromeda  2.2 · Dates" (falls back to "v1.2.3" for a plain version).
    function releaseTag() {
      const r = P.report.release();
      const title = `PII Review Automation ${r.version}${r.codename ? ` "${r.codename}"` : ''}${r.tag ? ` — ${r.tag}` : ''}`;
      if (!r.codename) return h('span', { class: 'version', title }, `v${r.version}`);
      return h('span', { class: 'release', title },
        h('span', { class: 'codename' }, `✦ ${r.codename}`),
        h('span', { class: 'version' }, `${r.version.replace(/\.0$/, '')}${r.tag ? ` · ${r.tag}` : ''}`));
    }

    // Brief confirmation on a button ("Saved ✓"), then its label comes back.
    function flash(btn, text) {
      if (!btn) return;
      const before = btn.textContent;
      btn.textContent = text;
      btn.disabled = true;
      setTimeout(() => { btn.textContent = before; btn.disabled = false; }, 1800);
    }

    // "Details ▸" — the short version stays on screen, the long one opens on request.
    function moreToggle(key, label) {
      const open = ui.expanded.has(key);
      return h('button', {
        class: 'more-toggle', 'aria-expanded': String(open),
        onclick: () => { if (open) ui.expanded.delete(key); else ui.expanded.add(key); redraw(); },
      }, open ? 'Hide ▴' : `${label || 'Details'} ▸`);
    }

    function banner(kind, title, details, dismissKey) {
      // Notices with a key are one line with "More"; error banners always show their details.
      const key = dismissKey && `banner-${dismissKey}`;
      const showDetails = details && details.length && (!key || ui.expanded.has(key));
      return h('div', { class: `banner ${kind}` },
        dismissKey ? h('button', {
          class: 'banner-close', title: 'Hide this message', 'aria-label': 'Hide this message',
          onclick: () => { ui.dismissed.add(dismissKey); redraw(); },
        }, '×') : null,
        h('strong', {}, title, key && details && details.length ? [' ', moreToggle(key, 'More')] : null),
        showDetails ? h('ul', {}, details.map((d) => h('li', {}, h('code', {}, d)))) : null);
    }

    function renderStatus() {
      frame(h('div', { class: 'body' }, message.details.length ? banner('info', message.text, message.details) : null),
        message.text);
    }

    function renderError() {
      frame(h('div', { class: 'body' },
        banner('error', message.text, message.details),
        h('div', { class: 'setup-actions' },
          h('button', { class: 'btn primary', onclick: () => cb.onSetup() }, 'Set up manually'),
          h('button', { class: 'btn', onclick: () => cb.onRefresh() }, 'Try again')),
        h('p', { class: 'hint' }, 'Set up takes three clicks: the original document, the reviewed document, and one label. ' +
          'It is saved in this browser for this site. No document text is saved.')),
      'Not running on this page');
    }

    function renderSetup() {
      const s = setupInfo;
      frame(h('div', { class: 'body' },
        h('div', { class: 'setup' },
          h('div', { class: 'step' }, `Setup · step ${s.step} of ${s.total}`),
          h('h2', {}, s.title),
          h('p', { class: 'hint' }, s.help),
          s.detail ? h('div', { class: `banner ${s.detail.warn ? 'error' : 'info'}` }, s.detail.text) : null,
          h('div', { class: 'setup-actions' }, s.buttons.map((b) =>
            h('button', { class: 'btn' + (b.primary ? ' primary' : ''), onclick: b.onClick }, b.label))))),
      'Setting up — your clicks on the page are not sent to the site');
    }

    function setupBlock(layout) {
      if (!layout) return null;
      const src = {
        saved: `Saved setup${layout.savedAt ? ' (' + new Date(layout.savedAt).toLocaleDateString() + ')' : ''}`,
        managed: 'Set by your organisation',
        auto: `Auto-detected${layout.similarity != null ? ' (' + Math.round(layout.similarity * 100) + '% matching words)' : ''}`,
        'selectors.js': 'selectors.js',
      }[layout.source] || layout.source;
      const ls = last.labelSet;
      const setBtn = (pref, text, title) => h('button', {
        class: 'seg' + (ls && ls.pref === pref ? ' on' : ''), 'aria-pressed': String(Boolean(ls && ls.pref === pref)), title,
        onclick: () => cb.onLabelSet && cb.onLabelSet(pref),
      }, text);
      const pr = last.project;
      const projectPick = pr && cb.onProject ? [
        h('div', { class: 'sub-h' }, 'Project'),
        h('select', {
          class: 'label-filter project-pick', 'aria-label': 'Project', title: 'The project decides its rules (Code Base: developer words are not names; Golden: one label per type)',
          onchange: (e) => cb.onProject(e.target.value),
        }, [['auto', `Auto · ${(P.projects.PROFILES[pr.current] || {}).name || 'General'}`]].concat(
          Object.values(P.projects.PROFILES).map((p) => [p.id, p.name])).map(([v, text]) => {
          const o = h('option', { value: v }, text);
          if (pr.choice === v) o.selected = true;
          return o;
        })),
      ] : null;
      return h('div', { class: 'more-block' },
        projectPick,
        ls ? [
          h('div', { class: 'sub-h' + (projectPick ? ' sub-gap' : '') }, 'Label set'),
          h('div', { class: 'stage label-set' },
            setBtn('auto', ls.pref === 'auto' ? `Auto · ${ls.active === 'golden' ? 'Golden' : '13 labels'}` : 'Auto',
              'Golden when the page lists the Golden project\'s labels, else the 13 labels'),
            setBtn('standard', '13 labels', 'Every type folds into the site\'s 13 labels (Credentials, Contact Number…)'),
            setBtn('golden', 'Golden', 'Golden project: each PII type has a label of its own (Indian Aadhaar Number, Stripe Key…)')),
          h('div', { class: 'hint' }, ls.active === 'golden'
            ? `Golden: ${P.activeLabels().length} labels, one per PII type.${ls.detected ? ' Recognised from the page\'s label list.' : ''}`
            : '13 labels: IDs, keys and passwords are Credentials, phones are Contact Number…'),
          h('div', { class: 'sub-h sub-gap' }, 'Page setup'),
        ] : h('div', { class: 'sub-h' }, 'Page setup'),
        h('div', { class: 'setup-info' },
          h('div', {}, h('b', {}, 'Panels: '), src),
          h('div', {}, h('b', {}, 'Labels: '), layout.labelVia ? `${layout.labelCount} found (${layout.labelVia})` : `${layout.labelCount} found`)),
        h('div', { class: 'setup-actions' },
          h('button', { class: 'btn', onclick: () => cb.onShowPanels() }, 'Show panels'),
          layout.source === 'auto' ? h('button', { class: 'btn primary', onclick: () => cb.onSaveDetected() }, 'Looks right — save') : null,
          h('button', { class: 'btn', onclick: () => cb.onSetup() }, 'Set up manually'),
          layout.source === 'saved' ? h('button', { class: 'btn', onclick: () => cb.onResetSetup() }, 'Forget saved setup') : null));
    }

    // Layout, top to bottom: notes (folded), a summary card, the task flag, one row of filters, the
    // issue sections, and everything else (learning, colours, page setup) folded at the bottom.
    // Inside a section, findings are grouped by label, and the same value found several times is one
    // row (×3) whose answer applies to all of them.
    function renderResult() {
      const { result, info } = last;
      const CATS = D.sections(last.stage);
      const visible = filtered();
      const notes = (info || []).filter((i) => !ui.dismissed.has(i.key));
      const filtering = ui.category || ui.search.trim() || ui.hideReviewed || ui.label;

      const sections = CATS.map((c) => {
        const items = visible.filter((f) => f.category === c.key);
        return items.length ? categorySection(c, items) : null;
      });

      const body = h('div', { class: 'body' },
        noticeBox(notes),
        summaryCard(),
        taskCard(last.taskCheck),
        toolbar(),
        addSheet(),
        sections,
        sections.some(Boolean) ? null : h('div', { class: 'empty' }, filtering ? 'Nothing matches these filters.' : 'Nothing to review here.'),
        moreSection());

      const actionable = result.findings.filter(D.isIssue);
      const toCheck = actionable.filter((f) => !last.reviewed.has(f.id)).length;
      const status = `${toCheck.toLocaleString()} to check · ` +
        `${(result.findings.length - actionable.length).toLocaleString()} OK`;
      const prevScroll = root.querySelector('.body') ? root.querySelector('.body').scrollTop : 0;
      frame(body, status);
      const nb = root.querySelector('.body');
      if (nb) nb.scrollTop = prevScroll;
    }

    function section(key, title, count, ...children) {
      return h('details', {
        class: 'section', open: ui.open.has(key),
        ontoggle: (e) => {
          const was = ui.open.has(key);
          if (e.target.open) ui.open.add(key); else ui.open.delete(key);
          if (e.target.open && !was && D.sections(last && last.stage).some((c) => c.key === key)) redraw(); // render its items now
        },
      }, h('summary', {}, h('span', { class: `cat-${key}` }, title), count !== '' ? h('span', { class: 'count' }, count) : null), children);
    }

    // One note shows as is; several fold into one line so the findings stay near the top.
    function noticeBox(notes) {
      if (!notes.length) return null;
      if (notes.length === 1) return banner('info', notes[0].title, notes[0].details, notes[0].key);
      return section('notes', 'Notes', String(notes.length), h('div', { class: 'notes' }, notes.map((i) => banner('info', i.title, i.details, i.key))));
    }

    const labelOf = (f) => f.label || f.rightLabel || (f.category === 'TASK' ? 'Whole task'
      : f.category === 'OVER_REDACTED' || f.category === 'UNKNOWN_TEXT' ? 'Overscrubbed' : 'Text');
    const valueKey = (f) => (f.text ? f.text.replace(/\s+/g, ' ').trim().toLowerCase() : `#${f.id}`);

    // Findings of one label, the biggest group first; inside, one cluster per distinct value.
    function byLabel(items) {
      const groups = new Map();
      for (const f of items) {
        const label = labelOf(f);
        if (!groups.has(label)) groups.set(label, new Map());
        const clusters = groups.get(label);
        const k = valueKey(f);
        if (!clusters.has(k)) clusters.set(k, []);
        clusters.get(k).push(f);
      }
      return [...groups].map(([label, clusters]) => ({ label, clusters: [...clusters.values()], size: [...clusters.values()].reduce((n, c) => n + c.length, 0) }))
        .sort((a, b) => b.size - a.size || a.label.localeCompare(b.label));
    }

    // Labels found 2+ times get a group (with "Redact all" / "Keep all"); single findings are plain rows
    // with a small label marker, so a short list stays short.
    function categorySection(c, items) {
      const groups = ui.open.has(c.key) ? byLabel(items) : [];
      const multi = groups.filter((g2) => g2.size > 1);
      const singles = groups.filter((g2) => g2.size === 1);
      const limit = ui.limit[c.key] || PAGE;
      const el = section(c.key, c.title, items.length.toLocaleString(),
        multi.map((g2) => labelGroup(c.key, g2, multi.length)),
        singles.length ? h('ul', { class: 'items singles' + (multi.length ? ' after-groups' : '') },
          singles.slice(0, limit).map((g2) => clusterItem(g2.clusters[0], g2.label))) : null,
        singles.length > limit ? h('div', { class: 'more' },
          h('button', { class: 'btn', onclick: () => { ui.limit[c.key] = limit + PAGE; redraw(); } }, `Show ${Math.min(PAGE, singles.length - limit)} more`)) : null);
      el.querySelector('summary').title = c.hint;
      return el;
    }

    // The answer shared by every finding in `ids`, or null when they differ or none is given.
    function sharedVerdict(ids) {
      const v = last.verdicts.get(ids[0]);
      return ids.every((id) => last.verdicts.get(id) === v) ? v || null : null;
    }

    // Record an answer for one value or a whole group, and ask what it is when the answer
    // contradicts the detector ("Keep (not PII)": not PII at all, or another label?).
    function decide(key, ids, f, choice, current) {
      const v = current === choice ? null : choice;
      const plan = v ? D.learnPlan(f, last.stage, v) : null;
      ui.teach = plan && plan.mode === 'ask' && cb.onTeach ? { key, ids, pii: Boolean(plan.pii), from: f.label || '' } : null;
      cb.onVerdictMany(ids, v);
      redraw();
    }

    function labelGroup(cat, grp, groupCount) {
      const key = `${cat}|${grp.label}`;
      const isOpen = ui.groupState.has(key) ? ui.groupState.get(key) : groupCount <= 2 || grp.clusters.length <= 4;
      const all = grp.clusters.flat();
      const ids = all.map((f) => f.id);
      const first = all[0];
      const q = D.question(first, last.stage);
      const current = sharedVerdict(ids);
      const doneCount = ids.filter((id) => last.reviewed.has(id)).length;
      const limitKey = key;
      const limit = ui.limit[limitKey] || PAGE;
      const shown = grp.clusters.slice(0, limit);
      const more = grp.clusters.length - shown.length;
      const groupBtn = (opt, text) => h('button', {
        class: 'mini' + (current === opt.key ? ' on' : ''), 'aria-pressed': String(current === opt.key),
        title: `${opt.title} — all ${all.length} in this group`,
        onclick: () => decide(key, ids, first, opt.key, current),
      }, text);
      const color = P.labelInfo(grp.label).color;
      // Auto-Fill for this group alone: labels only these values on the page.
      const fillN = cb.onAutoFillGroup && cb.fillCount ? cb.fillCount(ids) : 0;
      const fillBtn = fillN ? h('button', {
        class: 'mini fill', title: `Auto-Fill only this group: ${fillN} label${fillN === 1 ? '' : 's'} on the page (click the launcher's Auto-Fill to stop)`,
        onclick: (e) => { e.currentTarget.disabled = true; e.currentTarget.textContent = 'Filling…'; cb.onAutoFillGroup(ids); },
      }, `Fill ${fillN}`) : null;
      return h('div', { class: 'grp' + (isOpen ? ' open' : '') },
        h('div', { class: 'grp-head' },
          h('button', { class: 'grp-toggle', 'aria-expanded': String(isOpen), onclick: () => { ui.groupState.set(key, !isOpen); redraw(); } },
            h('span', { class: 'caret' }, '›'),
            h('span', { class: 'dot', bg: color }),
            h('span', { class: 'grp-name' }, grp.label),
            h('span', { class: 'grp-count', title: grp.clusters.length < all.length ? `${grp.clusters.length} different values, ${all.length} in all` : '' },
              grp.clusters.length < all.length ? `${all.length} · ${grp.clusters.length} unique` : String(all.length)),
            doneCount ? h('span', { class: 'grp-done' }, doneCount === all.length ? '✓' : `${doneCount} done`) : null),
          (q && all.length > 1) || fillBtn ? h('div', { class: 'grp-actions' },
            fillBtn,
            q && all.length > 1 ? [groupBtn(q.yes, q.yes.key === 'redact' ? 'Redact all' : 'All PII'),
              groupBtn(q.no, q.no.key === 'keep' ? 'Keep all' : 'None PII')] : null) : null),
        ui.teach && ui.teach.key === key ? teachSheet() : null,
        isOpen ? h('ul', { class: 'items' }, shown.map((cl) => clusterItem(cl))) : null,
        isOpen && more > 0 ? h('div', { class: 'more' },
          h('button', { class: 'btn', onclick: () => { ui.limit[limitKey] = limit + PAGE; redraw(); } }, `Show ${Math.min(PAGE, more)} more`),
          h('span', { class: 'hint' }, ` ${more.toLocaleString()} not shown`)) : null);
    }

    // One value: its text (×N when found several times), a short status, and the two answers.
    // The explanation, tags and "Report a problem" are under "⋯".
    function clusterItem(cl, showLabel) {
      const f = cl[0];
      const ids = cl.map((x) => x.id);
      const key = `v|${f.id}`;
      const stage = last.stage;
      const verdict = sharedVerdict(ids);
      const done = ids.every((id) => last.reviewed.has(id));
      const q = D.question(f, stage);
      const res = q ? D.outcome(f, stage, verdict) : null;
      const pick = D.suggested(f, stage);
      const open = ui.expanded.has(key);
      const relabeled = last.relabel && last.relabel.get(f.id);
      const choice = (opt) => h('button', {
        class: 'vbtn' + (verdict === opt.key ? ' on' : '') + (pick === opt.key ? ' suggested' : ''),
        'aria-pressed': String(verdict === opt.key),
        title: opt.title + (pick === opt.key ? ' (the assistant suggests this)' : '') + (cl.length > 1 ? ` — all ${cl.length}` : ''),
        onclick: () => decide(key, ids, f, opt.key, verdict),
      }, opt.label);
      const details = open ? h('div', { class: 'item-details' },
        h('div', { class: 'tags' },
          f.type && f.type !== f.label ? h('span', { class: 'tag outline', title: 'The kind of PII found' }, f.type) : null,
          f.rightLabel && f.rightLabel !== f.label ? [h('span', { class: 'arrow' }, 'right says'),
            h('span', { class: 'tag', bg: P.labelInfo(f.rightLabel).color }, f.rightLabel)] : null,
          f.confidence != null ? h('span', { class: 'tag outline' }, `${Math.round(f.confidence * 100)}% · ${f.source}`) : null,
          f.source === 'learned' ? h('span', { class: 'tag learned', title: 'From your earlier answers' }, 'Learned') : null,
          f.knownName ? h('span', { class: 'tag known', title: 'On the business names list: not PII' }, `Known name · ${f.knownName.category}`) : null,
          f.left || f.right ? h('span', { class: 'where' }, f.left && f.right ? 'left ↔ right' : f.left ? 'left only' : 'right only') : null),
        f.text && f.text.length > 60 ? h('div', { class: 'quote' }, `“${truncate(f.text, 400)}”`) : null,
        f.note ? h('div', { class: 'note' }, f.note) : null,
        q ? h('div', { class: `suggest suggest-${q.tone}` }, q.suggestion) : null,
        res ? h('div', { class: 'note' }, res.text) : null,
        cl.length > 1 ? h('div', { class: 'note' }, `Found ${cl.length} times — your answer applies to all of them.`) : null,
        h('button', {
          class: 'link-btn report', title: 'Save a small report about this finding to send to the maintainer (it contains a few lines of the document)',
          onclick: (e) => { cb.onReport(f); flash(e.currentTarget, 'Report saved ✓'); },
        }, 'Report a problem')) : null;
      return h('li', {
        class: 'item' + (done ? ' done' : '') + (ids.includes(ui.cursor) ? ' current' : ''), 'data-ids': ids.join(' '),
      },
        q ? null : h('input', {
          type: 'checkbox', checked: done, title: 'Mark as reviewed', 'aria-label': 'Mark as reviewed',
          onchange: (e) => ids.forEach((id) => cb.onToggleReviewed(id, e.target.checked)),
        }),
        h('div', { class: 'item-body' },
          showLabel ? h('div', { class: 'lbl' }, h('span', { class: 'dot', bg: P.labelInfo(showLabel).color }), showLabel) : null,
          h('div', { class: 'line1' },
            h('button', { class: 'item-main', title: 'Show on both documents', onclick: () => cb.onSelect(f) },
              h('span', { class: 'quote' }, `“${truncate(f.text || '', 60)}”`)),
            cl.length > 1 ? h('span', { class: 'times', title: `Found ${cl.length} times` }, `×${cl.length}`) : null,
            h('span', { class: 'status-chip' }, D.short(f, stage))),
          h('div', { class: 'item-actions' },
            q ? [choice(q.yes), choice(q.no)] : null,
            relabeled ? h('span', { class: 'tag', bg: P.labelInfo(relabeled).color, title: 'The label you chose' }, `→ ${relabeled}`) : null,
            res ? h('span', { class: 'outcome' + (res.fix ? ' fix' : ' ok'), title: res.text }, res.fix ? 'To fix' : 'OK') : null,
            h('button', {
              class: 'icon-btn dots', 'aria-expanded': String(open), title: open ? 'Hide details' : 'Details',
              onclick: () => { if (open) ui.expanded.delete(key); else ui.expanded.add(key); redraw(); },
            }, '⋯')),
          ui.teach && ui.teach.key === key ? teachSheet() : null,
          details));
    }

    // "What is it?" after an answer that contradicts the detector. The answer is remembered on this
    // device and every other occurrence of the value follows it, in this document and the next ones.
    function teachSheet() {
      const t = ui.teach;
      const pick = (label) => { ui.teach = null; cb.onTeach(t.ids, label); };
      return h('div', { class: 'teach', role: 'group', 'aria-label': 'Teach the assistant' },
        h('div', { class: 'teach-q' }, t.pii ? 'Which label is it?' : 'Remembered as not PII ✓ — or is it a different label?'),
        labelPicker(pick, { exclude: t.pii ? '' : t.from, near: t.from, verb: 'It is PII:' }),
        h('div', { class: 'teach-foot' },
          h('span', {}, `${t.ids.length > 1 ? `Applies to all ${t.ids.length}. ` : ''}Remembered on this device only.`),
          h('button', { class: 'link-btn', onclick: () => { ui.teach = null; redraw(); } }, t.pii ? 'Skip' : 'Done')));
    }

    // The labels to choose from. The 13-label set fits as chips; the Golden set (80 labels) gets a filter
    // box, and before anything is typed it suggests the labels of the same family as `near`
    // (an "Indian Aadhaar Number" finding suggests the other ID and key labels first).
    const MAX_CHIPS = 14;
    function labelPicker(onPick, opts) {
      const o = opts || {};
      const all = P.activeLabels().filter((l) => l.group && l.name !== o.exclude);
      const chip = (l) => h('button', { class: 'tbtn', title: `${o.verb || 'Label it'} ${l.name}`, onclick: () => onPick(l.name) },
        h('span', { class: 'dot', bg: l.color }), l.name);
      if (all.length <= 16) return h('div', { class: 'teach-opts' }, all.map(chip));
      const family = o.near ? P.baseLabel(o.near) : '';
      // Within the family, labels sharing a word with the detected one first ("Stripe Key": the other keys).
      const nearWords = new Set(String(o.near || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
      const shared = (l) => l.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => nearWords.has(w)).length;
      const suggested = () => {
        const same = all.filter((l) => family && P.baseLabel(l.name) === family)
          .map((l, i) => [l, i]).sort((a, b) => (a[0].golden ? 1 : 0) - (b[0].golden ? 1 : 0) || shared(b[0]) - shared(a[0]) || a[1] - b[1]).map(([l]) => l);
        const rest = all.filter((l) => !same.includes(l) && !l.golden);
        return same.concat(rest).slice(0, MAX_CHIPS);
      };
      const list = h('div', { class: 'teach-opts' });
      const show = (q) => {
        const words = q.toLowerCase().split(/\s+/).filter(Boolean);
        const hits = words.length ? all.filter((l) => words.every((w) => l.name.toLowerCase().includes(w))) : suggested();
        list.replaceChildren(...hits.slice(0, MAX_CHIPS).map(chip),
          ...(hits.length > MAX_CHIPS ? [h('span', { class: 'picker-more' }, `+${hits.length - MAX_CHIPS} more — type to narrow`)] : []),
          ...(!hits.length ? [h('span', { class: 'picker-more' }, 'No label matches')] : []));
      };
      const input = h('input', {
        class: 'search picker-input', type: 'search', placeholder: `Find a label (${all.length})…`, 'aria-label': 'Find a label',
        oninput: (e) => show(e.target.value),
        onkeydown: (e) => {
          if (e.key !== 'Enter') return;
          const first = list.querySelector('.tbtn');
          if (first) first.click();
        },
      });
      show('');
      return h('div', { class: 'picker' }, input, list);
    }

    // Open issues, progress and the buckets at a glance. Clicking a bucket filters the list to it.
    function summaryCard() {
      const stage = last.stage;
      const b = last.brief;
      const n = (x) => Number(x || 0).toLocaleString();
      const actionable = last.result.findings.filter(D.isIssue);
      const doneCount = actionable.filter((f) => last.reviewed.has(f.id)).length;
      const open = actionable.length - doneCount;
      const pct = actionable.length ? Math.round((doneCount / actionable.length) * 100) : 100;
      const t = D.summary(last.result.findings, stage, last.verdicts);
      const rows = D.buckets(last.result.findings, stage, last.reviewed).filter((r) => r.total);
      const learned = last.learning && last.learning.remembered;
      const brief = b ? [
        `Original ${n(b.left.words)} words · ${n(b.pii)} PII`,
        `${n(b.rightLabels)} labels · ${n(b.replaced)} replaced · ${n(b.leaked)} visible`,
      ] : [];
      const odd = b && !(b.language === 'English' && b.structured) ? `${b.language}${b.structured ? '' : ' · unstructured'}` : '';
      return h('div', { class: 'summary' },
        h('div', { class: 'sum-head' },
          h('span', { class: 'sum-big' + (open ? '' : ' zero') }, open ? n(open) : '✓'),
          h('div', { class: 'sum-text' },
            h('div', { class: 'sum-title' }, open ? `open issue${open === 1 ? '' : 's'}` : 'No open issues'),
            h('div', { class: 'sum-sub' }, `${n(doneCount)} of ${n(actionable.length)} reviewed${t.fix ? ` · ${n(t.fix)} to fix` : ''}`)),
          h('span', { class: 'sum-pct' }, `${pct}%`)),
        h('div', { class: 'bar' }, (() => { const d = h('div'); d.style.width = pct + '%'; return d; })()),
        rows.length ? h('div', { class: 'buckets', role: 'list' }, rows.map((r) => h('button', {
          class: 'bucket' + (r.ok ? ' ok' : r.open ? ' has' : '') + (ui.category === r.key ? ' active' : ''), role: 'listitem', title: r.hint,
          onclick: () => { ui.category = ui.category === r.key ? null : r.key; ui.open.add(r.key); resetPaging(); redraw(); },
        }, h('span', { class: 'b-name' }, r.title.replace(/ ✓$/, '')), h('b', {}, n(r.ok ? r.total : r.open))))) : null,
        h('div', { class: 'sum-brief', title: b && b.topKinds.length ? `Most found: ${b.topKinds.map((k) => `${k.name} ${n(k.count)}`).join(' · ')}` : '' },
          brief.join(' · '),
          odd ? h('span', { class: 'warn' }, ` · ${odd}`) : null,
          learned ? h('span', { class: 'learned-note', title: 'Values you answered before, applied to this document' }, ` · ${n(learned)} learned`) : null));
    }

    function toolbar() {
      return h('div', { class: 'toolbar' },
        h('input', {
          class: 'search', type: 'search', placeholder: 'Filter…', value: ui.search, 'aria-label': 'Filter findings',
          // Large documents can have thousands of findings: filter once typing pauses.
          oninput: (e) => {
            ui.search = e.target.value;
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => { resetPaging(); redraw(); }, SEARCH_DELAY);
          },
        }),
        h('select', {
          class: 'label-filter', title: 'Show only one label', 'aria-label': 'Show only one label',
          onchange: (e) => { ui.label = e.target.value; resetPaging(); redraw(); },
        },
        h('option', { value: '' }, 'All labels'),
        ['PI', 'BI', 'CRED', null].map((grp) => {
          const labels = P.activeLabels().filter((l) => l.group === grp);
          const opts = labels.map((l) => {
            const o = h('option', { value: l.name }, l.name);
            if (ui.label === l.name) o.selected = true;
            return o;
          });
          return grp && labels.length > 3 ? h('optgroup', { label: P.GROUP_NAMES[grp] }, opts) : opts;
        })),
        h('button', {
          class: 'toggle' + (ui.hideReviewed ? ' on' : ''), 'aria-pressed': String(ui.hideReviewed), title: 'Hide the items you have reviewed',
          onclick: () => { ui.hideReviewed = !ui.hideReviewed; resetPaging(); redraw(); },
        }, 'Hide done'),
        cb.onAddAnnotation ? h('button', {
          class: 'toggle' + (ui.adding ? ' on' : ''), 'aria-pressed': String(ui.adding),
          title: 'Add an annotation the assistant missed: select a word on the page, then pick its label',
          onclick: () => { ui.adding = !ui.adding; ui.addEdited = false; redraw(); },
        }, '＋ Add') : null);
    }

    // A value the assistant missed (or wrongly flags): the reviewer selects it on the page (or types it)
    // and picks a label. It is learned at once, and every occurrence is marked from then on.
    function addSheet() {
      if (!ui.adding) return null;
      const input = h('input', {
        class: 'search add-input', type: 'text', value: ui.addText, placeholder: 'Select a word on the page, or type it',
        'aria-label': 'Text to annotate',
        oninput: (e) => { ui.addText = e.target.value; ui.addEdited = true; },
      });
      const pick = (label) => {
        const text = ui.addText.trim();
        if (!text) { input.focus(); input.classList.add('warn'); return; }
        if (cb.onAddAnnotation(text, label) === false) { input.classList.add('warn'); return; }
        ui.adding = false;
        ui.addText = '';
        ui.addEdited = false;
        redraw();
      };
      return h('div', { class: 'teach add-sheet', role: 'group', 'aria-label': 'Add annotation' },
        h('div', { class: 'add-head' },
          h('span', { class: 'teach-q' }, 'Add an annotation'),
          h('button', { class: 'icon-btn', title: 'Close', 'aria-label': 'Close', onclick: () => { ui.adding = false; redraw(); } }, '✕')),
        input,
        h('div', { class: 'add-h' }, 'Label it'),
        labelPicker(pick, { verb: 'Label it' }),
        h('div', { class: 'add-h' }, 'Or mark it'),
        h('div', { class: 'teach-opts' },
          h('button', { class: 'tbtn', title: 'Replaced on the right, but the original is not PII', onclick: () => pick('Overscrubbed') },
            h('span', { class: 'dot', bg: P.labelInfo('Overscrubbed').color }), 'Overscrubbed'),
          h('button', { class: 'tbtn', title: 'Never flag this value', onclick: () => pick(P.learning.NOT_PII) }, 'Not PII')),
        h('div', { class: 'teach-foot' }, 'Every occurrence follows, in this file and the next ones.'));
    }

    function legendBlock() {
      const { hidden } = last;
      const row = (key, mark, name, left, right, titles) => {
        const off = hidden.has(key);
        return h('tr', { class: off ? 'off' : '' },
          h('td', {}, h('button', { class: 'swatch-toggle', title: off ? titles[0] : titles[1], onclick: () => cb.onToggleLabel(key) }, mark, name)),
          h('td', { class: 'num' }, left), h('td', { class: 'num' }, right));
      };
      return h('div', { class: 'more-block' },
        h('div', { class: 'sub-h' }, 'Labels & colours'),
        h('table', { class: 'legend' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Label (click to hide)'), h('th', { class: 'num' }, 'Left'), h('th', { class: 'num' }, 'Right'))),
          h('tbody', {},
            ['PI', 'BI', 'CRED'].flatMap((grp) => {
              const stat = (l) => last.legendStats.byLabel[l.name] || { detected: 0, labeled: 0 };
              // With the Golden set (80 labels) only the labels found on either side are listed.
              const many = P.activeLabels().length > 16;
              const labels = P.activeLabels().filter((l) => l.group === grp &&
                (!many || stat(l).detected || stat(l).labeled || hidden.has(l.name)));
              if (!labels.length) return [];
              return [h('tr', { class: 'grp' }, h('td', { colspan: '3' }, P.GROUP_NAMES[grp]))].concat(labels.map((l) =>
                row(l.name, h('span', { class: 'dot', bg: l.color }), l.name, stat(l).detected, stat(l).labeled,
                  ['Show highlights for this label', 'Hide highlights for this label'])));
            }),
            row(P.RIGHT_OVERSCRUB_KEY, h('span', { class: 'wavy' }), 'Possible overscrub (right side)', '—', last.legendStats.byCategory.OVERSCRUB || 0,
              ['Show overscrub marks on the right document', 'Hide overscrub marks on the right document']),
            row(P.KNOWN_NAMES_KEY, h('span', { class: 'known-mark' }), 'Known names (not PII)', last.knownCount, '—',
              ['Show the marks on known names', 'Hide the marks on known names']))),
        h('div', { class: 'hint' }, 'Left = detected by the assistant. Right = labels already on the reviewed document. ' +
          'Possible overscrubs are marked on the right with a wavy underline; names from the business names list ' +
          'are dotted green on the left: they are not PII and must not be redacted.'));
    }

    // What the assistant has learned from this reviewer's answers, kept on this device.
    function learningBlock() {
      const s = last.learning;
      if (!s || !cb.onLearningReset) return null;
      const n = (x) => Number(x || 0).toLocaleString();
      const stat = (value, word) => h('div', { class: 'stat' }, h('b', {}, value), h('span', {}, word));
      const resetBtn = h('button', {
        class: 'btn quiet', title: 'Forget every answer remembered on this device',
        onclick: () => {
          if (!ui.confirmReset) {
            ui.confirmReset = true;
            resetBtn.textContent = 'Click again to forget';
            setTimeout(() => { ui.confirmReset = false; if (resetBtn.isConnected) resetBtn.textContent = 'Forget everything learned'; }, 4000);
            return;
          }
          ui.confirmReset = false;
          cb.onLearningReset();
        },
      }, 'Forget everything learned');
      const c = last.cloud;
      const ago = (t) => { if (!t) return 'never'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
      const team = c && c.enabled ? h('div', { class: 'team' },
        h('div', { class: 'team-row' },
          h('span', { class: 'team-dot' + (c.error ? ' bad' : '') }),
          h('span', {}, c.error ? `Team sync: ${c.error}` : `Team sync on · project ${c.project || '—'} · list v${c.version} (${n(c.entries)} values)`),
          cb.onCloudSync ? h('button', { class: 'link-btn', title: 'Send your queued answers and get the latest team list', onclick: (e) => { cb.onCloudSync(); flash(e.currentTarget, 'Syncing…'); } }, 'Sync now') : null),
        h('div', { class: 'hint' }, `${n(c.queued)} answer${c.queued === 1 ? '' : 's'} waiting · sent on Submit. Only company names and plain "not PII" words are shared.`))
        : h('div', { class: 'hint' }, 'Team sync is off. Set the server address and API key in the extension options to share company names with your team.');
      return h('div', { class: 'more-block' },
        h('div', { class: 'sub-h' }, 'Learning from your answers'),
        team,
        h('div', { class: 'stats' },
          stat(n(s.remembered), 'remembered'), stat(n(s.notPii), 'not PII'), stat(n(s.relabels), 'relabeled'),
          stat(s.accuracy == null ? '—' : `${Math.round(s.accuracy * 100)}%`, 'agreed')),
        h('div', { class: 'hint' }, s.generalising
          ? 'Exact values get your answer everywhere. Similar values the assistant is sure about are marked “possible” (never auto-labeled) or relabeled.'
          : `Exact values already get your answer everywhere. ${s.needed} more answer${s.needed === 1 ? '' : 's'} and it starts recognising similar values too.`),
        h('div', { class: 'setup-actions' },
          s.canUndo && cb.onLearningUndo ? h('button', { class: 'btn primary', title: 'Forget your last "what is it?" answer', onclick: () => cb.onLearningUndo() }, 'Undo last answer') : null,
          h('button', { class: 'btn', title: 'Save what was learned (hashes and labels, no document text)', onclick: () => cb.onLearningExport() }, 'Export dataset'),
          resetBtn));
    }

    function moreSection() {
      return section('more', 'Learning, colours & setup', '', learningBlock(), legendBlock(), setupBlock(last.layout));
    }

    function taskCard(tc) {
      if (!tc) return null;
      const lang = tc.language;
      const hasLang = lang && lang.verdict !== 'english';
      if (!hasLang && !tc.structure) return null;
      const reasons = [];
      if (hasLang) reasons.push(lang.reason);
      if (tc.structure) reasons.push(`Task text is unstructured (${tc.structure.reasons.join('; ')}).`);
      const reasonText = reasons.join(' ');
      const pct = (x) => (x > 0 && x < 0.01 ? '<1' : String(Math.round(x * 100))) + '%';
      const title = hasLang
        ? (lang.verdict === 'other' ? 'Flag this task: not in English' : 'Flag this task: contains other language')
        : 'Flag this task: unstructured text';
      const copyBtn = h('button', { class: 'btn primary', title: 'Copy the reason to paste into the site', onclick: async () => {
        try {
          await navigator.clipboard.writeText(reasonText);
          copyBtn.textContent = 'Copied ✓';
        } catch (e) {
          copyBtn.textContent = 'Copy blocked — select the text below';
        }
        setTimeout(() => { copyBtn.textContent = 'Copy reason'; }, 2500);
      } }, 'Copy reason');
      const others = hasLang ? lang.languages.filter((l) => l.language !== 'English') : [];
      const line = [others.map((l) => `${l.language} ${pct(l.share)}`).join(' · '), hasLang && `lines ${lang.where}`,
        tc.structure && 'unstructured text'].filter(Boolean).join(' — ');
      const open = ui.expanded.has('task-card');
      return h('div', { class: 'task-card' },
        h('div', { class: 'task-title' }, '⚠ ', title),
        h('div', { class: 'task-sub' }, line),
        h('div', { class: 'item-actions' }, copyBtn, moreToggle('task-card')),
        !open ? null : h('div', { class: 'item-details' },
        h('div', { class: 'task-sub' }, 'Other language and unstructured text are sampling imperfections.'),
        hasLang ? h('table', { class: 'task-langs' },
          h('tbody', {}, lang.languages.map((l) => h('tr', { class: l.language === 'English' ? 'en' : '' },
            h('td', {}, l.language), h('td', { class: 'num' }, pct(l.share)),
            h('td', { class: 'num' }, `${l.lines} line${l.lines > 1 ? 's' : ''}`))))) : null,
        hasLang ? h('div', { class: 'task-where' }, `Where: line${lang.segments.length > 1 || (lang.segments[0] && lang.segments[0].lines > 1) ? 's' : ''} ${lang.where}`) : null,
        tc.structure ? h('div', { class: 'task-where' }, `Unstructured: ${tc.structure.reasons.join('; ')}`) : null,
        h('div', { class: 'task-reason' }, reasonText),
        hasLang && lang.segments.length ? section('task-parts', `Show the non-English parts`, String(lang.segments.length),
          h('ul', { class: 'items' }, lang.segments.slice(0, 50).map((sg) => h('li', { class: 'item' },
            h('button', { class: 'item-main', title: 'Show it in the document', onclick: () => cb.onSelect({ left: { start: sg.start, end: sg.end } }) },
              h('div', { class: 'tags' }, h('span', { class: 'tag outline' }, sg.lines > 1 ? `Lines ${sg.line}–${sg.lastLine}` : `Line ${sg.line}`),
                h('span', { class: 'tag outline' }, sg.language)),
              h('div', { class: 'quote' }, `“${truncate(last.leftText.slice(sg.start, sg.end), 120)}”`))))),
          lang.segments.length > 50 ? h('div', { class: 'hint' }, `${lang.segments.length - 50} more not shown`) : null) : null));
    }

    function filtered() {
      const { result, reviewed } = last;
      const q = ui.search.trim().toLowerCase();
      return result.findings.filter((f) =>
        (!ui.category || f.category === ui.category) &&
        (!ui.label || f.label === ui.label || f.rightLabel === ui.label) &&
        (!ui.hideReviewed || !reviewed.has(f.id)) &&
        (!q || [f.text, f.label, f.type, f.rightLabel, f.note].some((s) => s && s.toLowerCase().includes(q))));
    }

    function resetPaging() { ui.limit = {}; }

    // Issues still to check (not Correct, not ticked), in document order, within the current filters.
    function issues() {
      return filtered().filter((f) => D.isIssue(f) && !last.reviewed.has(f.id));
    }

    function navBar() {
      const list = issues();
      const idx = list.findIndex((f) => f.id === ui.cursor);
      const label = !list.length ? 'No open issues' : idx >= 0 ? `Issue ${(idx + 1).toLocaleString()} of ${list.length.toLocaleString()}`
        : `${list.length.toLocaleString()} open issues`;
      return h('div', { class: 'nav' },
        h('button', { class: 'btn', disabled: !list.length, title: 'Previous open issue', onclick: () => go(-1) }, '◀ Prev'),
        h('span', { class: 'nav-label' }, label),
        h('button', { class: 'btn primary', disabled: !list.length, title: 'Next open issue', onclick: () => go(1) }, 'Next ▶'));
    }

    function go(step) {
      const list = issues();
      if (!list.length) return;
      const idx = list.findIndex((f) => f.id === ui.cursor);
      const next = list[idx < 0 ? (step > 0 ? 0 : list.length - 1) : (idx + step + list.length) % list.length];
      ui.cursor = next.id;
      // Make sure the finding is rendered: open its section and label group, and page far enough.
      const groupKey = `${next.category}|${labelOf(next)}`;
      ui.open.add(next.category);
      ui.groupState.set(groupKey, true);
      ui.limit[groupKey] = Number.MAX_SAFE_INTEGER;
      ui.limit[next.category] = Number.MAX_SAFE_INTEGER;
      redraw();
      const li = [...root.querySelectorAll('li.item')].find((el) => (el.getAttribute('data-ids') || '').split(' ').includes(next.id));
      if (li) li.scrollIntoView({ block: 'center' });
      cb.onSelect(next);
    }

    function redraw() {
      if (mode === 'setup' && setupInfo) renderSetup();
      else if (mode === 'error') renderError();
      else if (mode === 'result' && last) renderResult();
      else renderStatus();
    }

    redraw();

    return {
      host,
      layer,
      render(args) {
        last = args;
        mode = 'result';
        busyText = '';
        // Re-open on the first task only if the reviewer left the panel open last time.
        if (!ui.shownOnce) { ui.shownOnce = true; if (ui.wantOpen) ui.collapsed = false; }
        redraw();
      },
      /** The reviewer's last choice (open or closed), from saved preferences. */
      preferOpen(open) { ui.wantOpen = Boolean(open); },
      /** Where the reviewer last dragged the launcher, from saved preferences. */
      setLauncherPos(pos) { launcherPos = validPos(pos); placeLauncher(root.querySelector('.launcher-group')); },
      /** Text of the Auto-Fill button next to the PII button (progress while it runs). */
      setAutoFillLabel(text) {
        ui.fillLabel = text;
        const b = root.querySelector('.launcher-fill');
        if (b) b.textContent = text;
      },
      /** The text the reviewer just selected in a document, for the "Add annotation" box (no redraw). */
      setSelection(text) {
        if (ui.addEdited) return;
        ui.addText = text || '';
        const input = root.querySelector('.add-input');
        if (input) { input.value = ui.addText; input.classList.remove('warn'); }
      },
      /** Show/hide a small "Updating…" note without redrawing the panel. */
      setBusy(text) { busyText = text || ''; if (busyEl) busyEl.textContent = busyText; },
      // Status changes and errors never open the panel: the reviewer opens it from the launcher.
      showError(text, details) {
        message = { text, details: details || [] };
        mode = 'error';
        last = null;
        redraw();
      },
      showSetup(info) { setupInfo = info; mode = 'setup'; ui.collapsed = false; redraw(); },
      endSetup() { setupInfo = null; if (mode === 'setup') mode = 'status'; redraw(); },
      get mode() { return mode; },
      showStatus(text, details) { message = { text, details: details || [] }; mode = 'status'; last = null; redraw(); },
      contains(node) { return node === host || host.contains(node); },
    };
  }

  P.panel = { create };
})(globalThis);
