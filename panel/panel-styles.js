// Styles for the side panel: frosted glass over the page, in black and white. Applied inside the panel's Shadow DOM only, so
// they cannot leak into the Peak Talent page (and the page's CSS cannot
// reach in). Kept as a JS string so no web_accessible_resources are needed.
(function (g) {
  'use strict';
  g.PIIRA.PANEL_CSS = `
/* ---------- tokens */
:host { all: initial; }
* { box-sizing: border-box; }
.root {
  /* Black and white like the wordmark. --accent is the "ink"
     (black on light, white on dark) and --on-ink the text on it. Colour is kept only where it
     matches something on the page: the label tags and highlight swatches, and the launcher dot. */
  --bg: rgba(255, 255, 255, .55); --bg2: rgba(15, 23, 42, .045); --fg: #0b0d12; --muted: #555b6a; --faint: #9aa0ad;
  --line: rgba(15, 23, 42, .09);
  --accent: #0b0d12; --on-ink: #ffffff; --accent-soft: rgba(15, 23, 42, .05);
  --missed: #0b0d12; --wrong: #0b0d12; --review: #555b6a; --ok: #555b6a; --over: #7c3aed; --known: #2e7d32;
  --flag: #0b0d12; --flag-ink: #0b0d12;
  --shadow: 0 1px 2px rgba(0, 0, 0, .04), 0 16px 40px rgba(0, 0, 0, .14);
  /* glass: the panel is frosted glass over the page; cards and controls are lighter glass inside it */
  --glass: rgba(255, 255, 255, .8); --glass-solid: #f7f8fb; --glass-edge: rgba(255, 255, 255, .6);
  --glass-shadow: inset 0 1px 0 rgba(255, 255, 255, .7), 0 1px 2px rgba(15, 23, 42, .06), 0 12px 40px rgba(15, 23, 42, .18);
  --surface: rgba(255, 255, 255, .55); --surface-hover: rgba(255, 255, 255, .8);
  --control: rgba(255, 255, 255, .6); --control-hover: rgba(255, 255, 255, .9); --line-strong: rgba(15, 23, 42, .22);
  /* the accent is the brand ink: black glass with a soft sheen on light, white glass on dark */
  --grad: linear-gradient(135deg, #2b2f3a 0%, #0b0d12 100%); --on-grad: #ffffff;
  --glow: inset 0 1px 0 rgba(255, 255, 255, .18), 0 4px 14px rgba(11, 13, 18, .28);
  --focus: #0b0d12; --focus-ring: rgba(11, 13, 18, .16); --scroll: rgba(15, 23, 42, .18);
  --launcher-glass: rgba(255, 255, 255, .72); --launcher-fg: #0b0d12;
  font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif;
  color: var(--fg); -webkit-font-smoothing: antialiased; color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  .root { color-scheme: dark; --bg: rgba(255, 255, 255, .04); --bg2: rgba(255, 255, 255, .06); --fg: #f3f5fa; --muted: #a9b0c0; --faint: #6f7686;
    --line: rgba(255, 255, 255, .1);
    --accent: #f3f5fa; --on-ink: #0b0d12; --accent-soft: rgba(255, 255, 255, .06);
    --missed: #f3f5fa; --wrong: #f3f5fa; --review: #a9b0c0; --ok: #a9b0c0; --over: #b388ff; --known: #66bb6a;
    --flag: #f3f5fa; --flag-ink: #f3f5fa; --shadow: 0 16px 40px rgba(0, 0, 0, .6);
    --glass: rgba(20, 20, 30, .78); --glass-solid: #16171f; --glass-edge: rgba(255, 255, 255, .12);
    --glass-shadow: inset 0 1px 0 rgba(255, 255, 255, .08), 0 8px 32px rgba(0, 0, 0, .37);
    --surface: rgba(255, 255, 255, .05); --surface-hover: rgba(255, 255, 255, .09);
    --control: rgba(255, 255, 255, .06); --control-hover: rgba(255, 255, 255, .12); --line-strong: rgba(255, 255, 255, .26);
    --grad: linear-gradient(135deg, #ffffff 0%, #d9dde6 100%); --on-grad: #0b0d12;
    --glow: inset 0 1px 0 rgba(255, 255, 255, .7), 0 4px 16px rgba(255, 255, 255, .12);
    --focus: #f3f5fa; --focus-ring: rgba(255, 255, 255, .2); --scroll: rgba(255, 255, 255, .18);
    --launcher-glass: rgba(20, 20, 30, .78); --launcher-fg: #f3f5fa; }
}
.root.hidden { display: none; }

/* ---------- shell: a floating card, and a small launcher when closed */
.panel {
  position: fixed; top: 12px; right: 12px; bottom: 12px; width: 384px; max-width: calc(100vw - 24px);
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--bg); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow);
  z-index: 2147483646; animation: piira-in .16s ease-out;
}
@keyframes piira-in { from { opacity: 0; transform: translateX(8px); } to { opacity: 1; transform: none; } }
.root.dock-left .panel { right: auto; left: 12px; }
.root.collapsed .panel { display: none; }
.launcher-group {
  position: fixed; right: 18px; bottom: 18px; z-index: 2147483646; display: none; align-items: center; gap: 8px;
  touch-action: none; user-select: none; -webkit-user-select: none;
}
.launcher {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 12px 8px 11px; border: 1px solid var(--accent); border-radius: 999px; cursor: pointer;
  background: var(--accent); color: var(--on-ink); font: 700 12.5px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; letter-spacing: .02em;
  box-shadow: 0 8px 24px rgba(0, 0, 0, .25); transition: transform .12s ease, box-shadow .12s ease;
}
.launcher:hover { transform: translateY(-1px); box-shadow: 0 12px 28px rgba(0, 0, 0, .32); }
/* Draggable: no page scrolling or text selection while it is moved. */
.launcher { touch-action: none; user-select: none; -webkit-user-select: none; }
.root.dragging .launcher-group { cursor: grabbing; transform: scale(1.04); }
.root.dragging .launcher, .root.dragging .launcher-fill { box-shadow: 0 16px 36px rgba(0, 0, 0, .38); transition: none; }
.launcher:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.launcher-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--faint); }
.launcher.issues .launcher-dot { background: #ef4444; }
.launcher.clear .launcher-dot { background: #22c55e; }
.launcher-count { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; display: inline-grid; place-items: center;
  background: var(--on-ink); color: var(--accent); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.root.dock-left .launcher-group { right: auto; left: 18px; }
.root.collapsed .launcher-group { display: flex; }
/* The Auto-Fill button travels with the PII button (same group), in the same pill shape, dark. */
.launcher-fill {
  padding: 8px 13px; border: 1px solid #141414; border-radius: 999px; cursor: pointer; background: #141414; color: #fff;
  font: 700 12.5px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; letter-spacing: .02em; white-space: nowrap;
  box-shadow: 0 8px 24px rgba(0, 0, 0, .25); transition: transform .12s ease, box-shadow .12s ease, background .12s ease;
}
.launcher-fill:hover { background: #2a2a2a; transform: translateY(-1px); }
.launcher-fill:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
header { padding: 14px 16px 12px; border-bottom: 1px solid var(--line); background: var(--bg); }
.title-row { display: flex; align-items: center; gap: 4px; }
h1 { margin: 0; flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; overflow: hidden; }
.title-row .icon-btn { flex: none; }
/* the wordmark: black on light, white on dark (the same files as the desktop app) */
.wordmark { display: block; width: 104px; min-width: 72px; flex: 0 1 auto; height: auto; }
.wordmark.on-dark, .wordmark-text.on-dark { display: none; }
@media (prefers-color-scheme: dark) {
  .wordmark.on-light, .wordmark-text.on-light { display: none; }
  .wordmark.on-dark { display: block; } .wordmark-text.on-dark { display: inline; }
}
.wordmark-text { font-size: 16px; font-weight: 600; letter-spacing: -.02em; }
.product { font-size: 11.5px; font-weight: 600; letter-spacing: .02em; padding: 2px 8px; border: 1px solid var(--accent); border-radius: 6px; white-space: nowrap; }
@media (max-width: 400px) { .product { display: none; } }
.status { color: var(--muted); font-size: 12px; margin-top: 6px; }
.busy { margin-left: 6px; color: var(--accent); }
.body { flex: 1; overflow: auto; padding: 2px 16px 16px; scrollbar-width: thin; }
footer { border-top: 1px solid var(--line); padding: 9px 16px; color: var(--muted); font-size: 11px; background: var(--bg); }

/* ---------- controls */
.icon-btn {
  border: 1px solid transparent; background: transparent; color: var(--muted); border-radius: 8px;
  height: 28px; min-width: 28px; padding: 0 7px; cursor: pointer; font: inherit; font-size: 13px;
}
.icon-btn:hover { background: var(--bg2); color: var(--fg); border-color: var(--line); }
.icon-btn:focus-visible, .btn:focus-visible, .seg:focus-visible, .chip:focus-visible, .vbtn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.icon-btn[aria-pressed="false"] { opacity: .5; }
.btn { border: 1px solid var(--line); background: var(--bg); color: var(--fg); border-radius: 8px; padding: 6px 12px; cursor: pointer; font: inherit; font-size: 12.5px; font-weight: 600; }
.btn:hover { border-color: var(--accent); }
.btn:disabled { opacity: .45; cursor: default; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--on-ink); }
.btn.primary:hover { opacity: .88; }
.stage { display: grid; grid-template-columns: 1fr 1fr; gap: 3px; margin-top: 10px; padding: 3px; border-radius: 10px; background: var(--bg2); border: 1px solid var(--line); }
.seg { border: 0; border-radius: 7px; background: transparent; color: var(--muted); font: inherit; font-size: 12px; font-weight: 600; padding: 6px 4px; cursor: pointer; }
.seg.on { background: var(--accent); color: var(--on-ink); }
.nav { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.nav .nav-label { flex: 1; text-align: center; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
/* one row of filters: search, label, "Hide done" */
.toolbar { display: flex; gap: 6px; margin-top: 12px; align-items: stretch; }
.search { flex: 1; min-width: 0; padding: 6px 10px; border: 1px solid var(--line); border-radius: 999px; background: var(--bg); color: var(--fg); font: inherit; font-size: 12.5px; }
.search:focus { outline: none; border-color: var(--accent); }
.label-filter { max-width: 120px; padding: 0 8px; border: 1px solid var(--line); border-radius: 999px; background: var(--bg); color: var(--fg); font: inherit; font-size: 12px; }
.toggle { flex: none; padding: 0 10px; border: 1px solid var(--line); border-radius: 999px; background: var(--bg); color: var(--muted); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.toggle:hover { border-color: var(--accent); color: var(--fg); }
.toggle.on { background: var(--accent); border-color: var(--accent); color: var(--on-ink); }
.toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
label.check { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }
.bar { height: 3px; background: var(--bg2); border-radius: 999px; overflow: hidden; margin-top: 10px; }
.bar > div { height: 100%; background: var(--accent); border-radius: 999px; width: 0; transition: width .3s; }

/* ---------- notices */
.banner { position: relative; margin: 10px 0 0; padding: 10px 12px; border-radius: 10px; font-size: 12.5px; }
.banner { border: 1px solid var(--line); border-left: 3px solid var(--accent); color: var(--fg); }
.banner.error { background: var(--bg2); }
.banner.info { background: var(--bg); }
.banner li, .banner code { color: var(--muted); }
.banner strong { display: block; margin-bottom: 4px; padding-right: 18px; }
.banner ul { margin: 4px 0 0; padding-left: 18px; }
.banner code { font-size: 11.5px; word-break: break-all; }
.banner-close { position: absolute; top: 4px; right: 6px; padding: 2px 4px; border: 0; background: none; color: inherit; font-size: 16px; line-height: 1; cursor: pointer; opacity: .7; }
.banner-close:hover { opacity: 1; }

/* task check: other language / unstructured text */
.task-card { margin-top: 12px; padding: 10px 12px; border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 10px; background: var(--bg2); }
.task-title { font-weight: 700; font-size: 13.5px; color: var(--flag-ink); }
.task-sub { margin-top: 2px; font-size: 11.5px; color: var(--muted); }
.task-langs { width: 100%; margin-top: 8px; border-collapse: collapse; font-size: 12px; }
.task-langs td { padding: 3px 0; border-top: 1px solid var(--line); }
.task-langs td.num { width: 70px; text-align: right; font-variant-numeric: tabular-nums; }
.task-langs tr.en td { color: var(--muted); }
.task-where { margin-top: 6px; font-size: 12px; }
.task-reason { margin-top: 8px; padding: 6px 8px; border: 1px dashed var(--line); border-radius: 6px; background: var(--bg); font-size: 11.5px; user-select: text; }
.task-card details.section { background: var(--bg); }

/* Summary card: open issues, progress, buckets, a one-line brief */
.summary { margin-top: 12px; padding: 12px 12px 10px; border: 1px solid var(--line); border-radius: 12px; background: var(--bg); }
.sum-head { display: flex; align-items: center; gap: 10px; }
.sum-big { font-size: 26px; font-weight: 800; line-height: 1; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.sum-big.zero { color: var(--muted); font-size: 22px; }
.sum-text { flex: 1; min-width: 0; }
.sum-title { font-weight: 650; font-size: 13px; }
.sum-sub { font-size: 11.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
.sum-pct { font-size: 11.5px; font-weight: 700; color: var(--muted); font-variant-numeric: tabular-nums; }
.buckets { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 10px; }
.bucket { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 3px 9px;
  border: 1px solid var(--line); border-radius: 999px; background: var(--bg); color: var(--muted); font: inherit; font-size: 11.5px; cursor: pointer; }
.bucket .b-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bucket b { font-variant-numeric: tabular-nums; }
.bucket.has { color: var(--fg); border-color: var(--fg); }
.bucket.has b { font-weight: 800; }
.bucket.ok { border-style: dashed; }
.bucket:hover { border-color: var(--accent); }
.bucket.active { background: var(--accent); border-color: var(--accent); color: var(--on-ink); }
.bucket:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.sum-brief { margin-top: 8px; font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
.sum-brief .warn { color: var(--fg); font-weight: 700; }
.learned-note { color: var(--fg); }

/* ---------- sections and the legend */
details.section { margin-top: 12px; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: var(--bg); }
details.section > summary {
  list-style: none; cursor: pointer; padding: 9px 12px; font-weight: 650; display: flex; align-items: center; gap: 8px;
  background: var(--bg);
}
details.section > summary:hover { background: var(--bg2); }
details.section[open] > summary { border-bottom: 1px solid var(--line); }
details.section > summary::-webkit-details-marker { display: none; }
details.section > summary::before { content: "›"; color: var(--faint); font-size: 16px; line-height: 1; width: 8px; transition: transform .15s; }
details.section[open] > summary::before { transform: rotate(90deg); }
.count { margin-left: auto; color: var(--muted); font-weight: 600; font-size: 11.5px; background: var(--bg2); padding: 1px 8px; border-radius: 999px; }
.hint { color: var(--muted); font-size: 11.5px; padding: 6px 10px 0; }
.body > .hint { padding: 0; margin: 8px 0 0; }
.empty { padding: 10px; color: var(--muted); font-size: 12px; }
.section-empty { display: flex; gap: 8px; margin-top: 6px; padding: 4px 10px; font-size: 12px; opacity: .6; }
.more { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-top: 1px solid var(--line); }
table.legend { width: 100%; border-collapse: collapse; font-size: 12px; }
table.legend th { text-align: left; font-weight: 600; color: var(--muted); padding: 6px 10px 4px; font-size: 11px; }
table.legend td { padding: 4px 10px; border-top: 1px solid var(--line); }
table.legend td.num { width: 44px; text-align: right; font-variant-numeric: tabular-nums; }
table.legend tr.grp td { background: var(--bg2); color: var(--muted); font-weight: 650; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
table.legend tr.off td { opacity: .45; }
.swatch-toggle { display: inline-flex; align-items: center; gap: 7px; padding: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; }
.dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; flex: none; }
.wavy { width: 18px; height: 9px; flex: none; display: inline-block; border-bottom: 2px dotted var(--over); background: rgba(124,58,237,.22); border-radius: 2px; }
.setup-info { display: grid; gap: 4px; padding: 8px 10px; font-size: 12px; }

.known-mark { width: 18px; height: 9px; flex: none; display: inline-block; border-bottom: 2px dotted var(--known); }
.tag.known { background: transparent; color: var(--known); border: 1px solid var(--known); font-weight: 600; }

/* section titles: text colour, with a filled dot for "to fix" and a ring for "looks fine" */
[class^="cat-"], [class*=" cat-"] { color: var(--fg); }
.chip.active [class^="cat-"] { color: inherit; }
.cat-IDENTIFIED, .cat-REDACTED_OK { color: var(--muted); }

/* ---------- findings */
ul.items { list-style: none; margin: 0; padding: 0; }
li.item { display: flex; gap: 8px; padding: 9px 12px; border-top: 1px solid var(--line); align-items: flex-start; transition: background .1s; }
li.item:hover { background: var(--bg2); }
li.item:first-child { border-top: 0; }
li.item.done { opacity: .75; }
li.item.current { background: var(--bg2); box-shadow: inset 3px 0 0 var(--accent); }
li.item input { margin-top: 3px; cursor: pointer; flex: none; }
.item-body { flex: 1; min-width: 0; }
.item-main { width: 100%; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.item-main:hover .quote { text-decoration: underline; }
.item-main:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
.tags { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.tag { font-size: 11px; padding: 2px 7px; border-radius: 5px; color: #fff; font-weight: 700; }
.tag.outline { background: transparent !important; color: var(--fg); border: 1px solid var(--line); font-weight: 500; }
.arrow { color: var(--muted); font-size: 11px; }
.quote { margin-top: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; word-break: break-word; }
.note { margin-top: 3px; color: var(--muted); font-size: 11.5px; }
.where { margin-top: 2px; color: var(--muted); font-size: 10.5px; text-transform: uppercase; letter-spacing: .03em; }

/* compact finding: one line + actions; the rest under "Details" */
.line1 { display: flex; align-items: center; gap: 6px; min-width: 0; }
.line1 .quote { margin-top: 0; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status-chip { flex: none; font-size: 11px; color: var(--muted); white-space: nowrap; }
.item-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 6px; }
.more-toggle { padding: 2px 4px; border: 0; background: none; color: var(--fg); font: inherit; font-size: 11.5px; font-weight: 600;
  text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.more-toggle:hover { color: var(--muted); }
.item-details { margin-top: 6px; padding: 6px 8px; border-left: 2px solid var(--line); }
.item-details .quote { margin-top: 4px; }
.vbtn.suggested { border-style: dashed; border-color: var(--accent); }

/* the decision under a finding */
.decide { margin-top: 6px; }
.suggest { font-size: 11.5px; font-weight: 600; }
.suggest-redact { color: var(--fg); } .suggest-keep, .suggest-unsure { color: var(--muted); }
.verdict { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 5px; }
.verdict .q { margin-right: 2px; color: var(--muted); font-size: 11.5px; }
.vbtn { padding: 3px 11px; border: 1px solid var(--line); border-radius: 999px; background: var(--bg); color: var(--fg); font: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer; }
.vbtn:hover { border-color: var(--accent); }
.vbtn.on.redact, .vbtn.on.keep, .vbtn.on { background: var(--accent); border-color: var(--accent); border-style: solid; color: var(--on-ink); }
.outcome { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 10.5px; font-weight: 700; letter-spacing: .02em; }
.outcome.fix { background: var(--accent); color: var(--on-ink); }
.outcome.ok { background: var(--bg2); color: var(--muted); }
li.item.done .outcome { opacity: 1; }
.times { flex: none; font-size: 10.5px; font-weight: 700; color: var(--muted); padding: 0 5px; border: 1px solid var(--line); border-radius: 999px; font-variant-numeric: tabular-nums; }
.icon-btn.dots { height: 22px; min-width: 22px; padding: 0 5px; margin-left: auto; font-size: 14px; line-height: 1; letter-spacing: .05em; }
.icon-btn.dots[aria-expanded="true"] { background: var(--bg2); color: var(--fg); }
.tag.learned { background: transparent; color: var(--fg); border: 1px dashed var(--fg); font-weight: 600; }

/* ---------- label groups inside a section: one header per label, values below */
.grp + .grp { border-top: 1px solid var(--line); }
.grp-head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; padding: 6px 8px 6px 10px; background: var(--bg); }
.grp.open > .grp-head { background: var(--bg2); }
.grp-toggle { flex: 1 1 150px; min-width: 0; display: flex; align-items: center; gap: 7px; padding: 2px 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; text-align: left; }
.grp-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
.caret { width: 8px; color: var(--faint); font-size: 15px; line-height: 1; transition: transform .15s; }
.grp.open .caret { transform: rotate(90deg); }
.grp-name { font-weight: 650; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.grp-count { white-space: nowrap; font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
.grp-done { font-size: 10.5px; color: var(--muted); }
.grp-actions { flex: none; display: flex; gap: 4px; margin-left: auto; }
.mini { padding: 2px 8px; border: 1px solid var(--line); border-radius: 999px; background: var(--bg); color: var(--muted); font: inherit; font-size: 11px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.mini:hover { border-color: var(--accent); color: var(--fg); }
.mini.on { background: var(--accent); border-color: var(--accent); color: var(--on-ink); }
.mini:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.mini.fill { color: var(--fg); border-color: var(--line-strong); }
.mini.fill:disabled { opacity: .6; cursor: default; }
.grp ul.items li.item { padding-left: 25px; }
ul.items.after-groups { border-top: 1px solid var(--line); }
.lbl { display: flex; align-items: center; gap: 5px; margin-bottom: 2px; font-size: 10.5px; font-weight: 700; letter-spacing: .03em; text-transform: uppercase; color: var(--muted); }
.lbl .dot { width: 7px; height: 7px; }
.line1 .item-main { flex: 1; min-width: 0; width: auto; overflow: hidden; }
.line1 .item-main .quote { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.grp ul.items li.item:first-child { border-top: 1px solid var(--line); }

/* ---------- "what is it?" after a "Not PII" / "Keep" answer */
.teach { margin: 8px 0 2px; padding: 9px 10px; border: 1px dashed var(--accent); border-radius: 10px; background: var(--bg); animation: piira-in .14s ease-out; }
.grp > .teach { margin: 6px 10px 8px; }
.teach-q { font-size: 12px; font-weight: 650; }
.teach-opts { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 7px; }
.tbtn { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border: 1px solid var(--line); border-radius: 999px; background: var(--bg); color: var(--fg); font: inherit; font-size: 11.5px; cursor: pointer; }
.tbtn:hover { border-color: var(--accent); }
.tbtn.primary { background: var(--accent); border-color: var(--accent); color: var(--on-ink); font-weight: 700; }
.tbtn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.tbtn .dot { width: 7px; height: 7px; }
.add-sheet { margin-top: 8px; padding: 10px 12px 11px; }
.add-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: -2px -4px 0 0; }
.add-head .icon-btn { width: 24px; height: 24px; font-size: 12px; }
.add-h { margin-top: 10px; font-size: 10.5px; font-weight: 650; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); }
.add-h + .picker .picker-input, .add-h + .teach-opts { margin-top: 5px; }
.picker-input { display: block; width: 100%; margin-top: 7px; font-size: 12px; }
.picker-more { align-self: center; font-size: 11px; color: var(--muted); padding: 0 4px; }
.label-set { margin-top: 0; grid-template-columns: repeat(3, 1fr); }
.label-set .seg { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* the panel's selects (label filter, project): its own control look instead of the native grey box and
   chevron; the open list follows the panel's light / dark scheme through color-scheme */
select.label-filter { padding: 0 26px 0 10px; appearance: none; -webkit-appearance: none; cursor: pointer; background-color: var(--control);
  background-image: linear-gradient(45deg, transparent 50%, var(--muted) 50%), linear-gradient(135deg, var(--muted) 50%, transparent 50%);
  background-position: calc(100% - 15px) 50%, calc(100% - 10px) 50%; background-size: 5px 5px; background-repeat: no-repeat; }
select.label-filter:hover { background-color: var(--control-hover); border-color: var(--line-strong); }
select.label-filter option { background: var(--glass-solid); color: var(--fg); }
select.project-pick { max-width: none; width: 100%; height: 32px; padding-left: 12px; }
.team { margin-bottom: 10px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 9px; background: var(--bg2); }
.team-row { display: flex; align-items: center; gap: 7px; font-size: 12px; }
.team-row .link-btn { margin-left: auto; font-size: 11.5px; }
.team-dot { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; flex: none; }
.team-dot.bad { background: #ef4444; }
.team .hint { padding: 3px 0 0; }
.sub-h.sub-gap { margin-top: 12px; }
.add-input { display: block; width: 100%; margin-top: 8px; }
.add-input.warn { border-color: #ef4444; }
.teach-foot { display: flex; justify-content: space-between; gap: 8px; margin-top: 7px; font-size: 11px; color: var(--muted); }

/* ---------- the folded "Learning, colours & setup" section */
.more-block { padding: 10px 12px 12px; }
.more-block + .more-block { border-top: 1px solid var(--line); }
.sub-h { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
.more-block .hint { padding: 6px 0 0; }
.more-block .setup-info { padding: 0; }
.more-block table.legend td, .more-block table.legend th { padding-left: 0; }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
.stat { padding: 6px 8px; border: 1px solid var(--line); border-radius: 9px; background: var(--bg2); min-width: 0; }
.stat b { display: block; font-size: 15px; font-weight: 800; font-variant-numeric: tabular-nums; }
.stat span { font-size: 10.5px; color: var(--muted); }
.btn.quiet { color: var(--muted); }
.notes { padding: 0 10px 10px; }

/* ---------- page setup and the click-setup overlay */
.setup { margin-top: 14px; }
.setup h2 { font-size: 15px; margin: 4px 0 6px; }
.setup .step { color: var(--muted); font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em; }
.setup .hint { padding: 0; margin: 8px 0 0; }
.setup .banner { margin: 10px 0 0; }
.setup-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; }
.pick-box { position: fixed; display: none; pointer-events: none; border: 2px solid #0a0a0a; border-radius: 4px; background: rgba(10,10,10,.06);
  box-shadow: 0 0 0 1px rgba(255,255,255,.8); }
.pick-box.fixed { border-style: dashed; border-color: #6b6b6b; background: rgba(10,10,10,.03); }
.pick-tag { position: absolute; top: -20px; left: -2px; padding: 4px 6px; border-radius: 4px 4px 0 0; background: #0a0a0a; color: #fff; font: 700 11px/1 -apple-system, sans-serif; letter-spacing: .03em; white-space: nowrap; }
.pick-box.fixed .pick-tag { background: #6b6b6b; }

  footer .foot-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  footer .version { opacity: .7; font-variant-numeric: tabular-nums; }
  footer .release { display: inline-flex; align-items: center; gap: 6px; min-width: 0; white-space: nowrap; }
  footer .codename { font-weight: 650; letter-spacing: .02em; padding: 1px 7px; border-radius: 999px;
    border: 1px solid var(--line-strong); background: linear-gradient(135deg, rgba(255,255,255,.18), rgba(255,255,255,0)); }
  .link-btn { background: none; border: 0; padding: 0; font: inherit; color: inherit; text-decoration: underline; cursor: pointer; opacity: .85; }
  .link-btn:hover { opacity: 1; }
  .link-btn:disabled { text-decoration: none; cursor: default; }
  .item-details .report { display: inline-block; margin-top: 6px; font-size: 11px; }

/* ---------- glass layer
   The panel is frosted glass over the page (blur + translucency); everything inside is a lighter glass
   layer (cards, rows, controls) so the hierarchy reads by depth, not by heavy borders. Primary actions
   carry the brand ink as a glassy accent (--grad: black on light, white on dark). Solid fallbacks: no backdrop-filter, or "reduce transparency". */
.panel {
  background: var(--glass); border: 1px solid var(--glass-edge); border-radius: 16px; box-shadow: var(--glass-shadow);
  -webkit-backdrop-filter: blur(18px) saturate(130%); backdrop-filter: blur(18px) saturate(130%);
}
header, footer { background: transparent; }
header { border-bottom: 1px solid var(--line); }
footer { border-top: 1px solid var(--line); }

/* nested glass: cards, sections, rows */
.summary, details.section, .task-card, .banner, .banner.info, .banner.error, .stat, .team, .doc-tile, .decisions, .teach {
  background: var(--surface); border-color: var(--line); border-radius: 12px;
}
.teach { border: 1px solid var(--line-strong); }
details.section > summary { background: transparent; transition: background .2s ease; }
details.section > summary:hover { background: var(--surface-hover); }
.grp-head { background: transparent; }
.grp.open > .grp-head { background: var(--bg2); }
li.item { transition: background .2s ease; }
li.item:hover { background: var(--surface-hover); }
li.item.current { background: var(--surface-hover); box-shadow: inset 3px 0 0 var(--focus); }
.stage { background: var(--bg2); border-color: var(--line); }

/* controls: translucent, brighten on hover */
.btn, .vbtn, .chip, .bucket, .toggle, .mini, .tbtn, .icon-btn:hover, .search, .label-filter {
  background: var(--control); border-color: var(--line); transition: all .2s ease;
}
.btn:hover, .vbtn:hover, .chip:hover, .bucket:hover, .toggle:hover, .mini:hover, .tbtn:hover {
  background: var(--control-hover); border-color: var(--line-strong);
}
.search:focus, .label-filter:focus { outline: none; border-color: var(--focus); box-shadow: 0 0 0 3px var(--focus-ring); }

/* primary and selected: the accent gradient with a soft inner glow */
.btn.primary, .seg.on, .vbtn.on, .vbtn.on.redact, .vbtn.on.keep, .toggle.on, .mini.on, .tbtn.primary, .bucket.active, .chip.active {
  background: var(--grad); border-color: transparent; color: var(--on-grad); box-shadow: var(--glow);
}
.btn.primary:hover, .seg.on:hover, .vbtn.on:hover, .toggle.on:hover, .mini.on:hover, .tbtn.primary:hover, .bucket.active:hover {
  opacity: 1; filter: brightness(1.08) saturate(1.05); background: var(--grad); border-color: transparent;
}
.seg { transition: all .2s ease; }
.seg:not(.on):hover { background: var(--control-hover); color: var(--fg); }
.vbtn.suggested:not(.on) { border-style: dashed; border-color: var(--focus); }
.outcome.fix { background: var(--grad); color: var(--on-grad); }
.bar > div { background: var(--grad); }
.icon-btn:focus-visible, .btn:focus-visible, .seg:focus-visible, .chip:focus-visible, .vbtn:focus-visible, .toggle:focus-visible,
.mini:focus-visible, .tbtn:focus-visible, .bucket:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }

/* scrollbars: thin, no track, blend into the glass */
.panel, .panel * { scrollbar-width: thin; scrollbar-color: var(--scroll) transparent; }
.panel ::-webkit-scrollbar { width: 8px; height: 8px; }
.panel ::-webkit-scrollbar-track { background: transparent; }
.panel ::-webkit-scrollbar-thumb { background: var(--scroll); border-radius: 999px; border: 2px solid transparent; background-clip: padding-box; }
.panel ::-webkit-scrollbar-thumb:hover { background-color: var(--line-strong); }

/* the launcher: a glass pill; the count carries the accent */
.launcher {
  background: var(--launcher-glass); color: var(--launcher-fg); border: 1px solid var(--glass-edge); box-shadow: var(--glass-shadow);
  -webkit-backdrop-filter: blur(14px) saturate(130%); backdrop-filter: blur(14px) saturate(130%);
}
.launcher-count { background: var(--grad); color: var(--on-grad); box-shadow: var(--glow); }
.launcher-fill {
  background: rgba(20, 20, 30, .7); border-color: rgba(255, 255, 255, .14); color: #fff;
  -webkit-backdrop-filter: blur(14px) saturate(130%); backdrop-filter: blur(14px) saturate(130%);
}
.launcher-fill:hover { background: rgba(32, 32, 46, .82); }
.launcher:focus-visible, .launcher-fill:focus-visible { outline: 2px solid var(--focus); outline-offset: 3px; }

/* solid fallbacks */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .panel, .launcher { background: var(--glass-solid); }
}
@media (prefers-reduced-transparency: reduce) {
  .panel, .launcher { background: var(--glass-solid); -webkit-backdrop-filter: none; backdrop-filter: none; }
  .launcher-fill { background: #16171f; -webkit-backdrop-filter: none; backdrop-filter: none; }
}
@media (prefers-reduced-motion: reduce) {
  .panel { animation: none; }
  .btn, .vbtn, .chip, .bucket, .toggle, .mini, .tbtn, .seg, li.item, details.section > summary { transition: none; }
}
`;
})(globalThis);
