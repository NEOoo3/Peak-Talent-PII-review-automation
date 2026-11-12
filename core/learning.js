// On-device learning from the reviewer's answers. Nothing leaves the browser.
//
// The GLiNER model and the rules cannot be retrained inside a tab, so the extension learns
// around them, in three layers, strongest first:
//
//   1. Value memory   A value the reviewer has judged ("557058:4116…" is not PII, "Acme Ltd" is a
//                     Business Name) gets the same answer in every later document: dropped,
//                     relabeled, or added where the detectors missed it.
//   2. Learned model  A small classifier (multinomial logistic regression over hashed features:
//                     the value's shape, character trigrams, the detector that found it, the field
//                     name and nearby words) trained on every answer. It generalises to values never
//                     seen before ("other Atlassian IDs are not PII either"). It only acts when it is
//                     sure and has enough examples, and it never deletes a detection on its own:
//                     a "not PII" guess lowers the confidence, so the finding becomes "Possible PII"
//                     (shown, but never auto-labeled) instead of disappearing.
//   3. The detectors and the GLiNER model, unchanged.
//
// Privacy: values are stored as hashes (two 32-bit FNV-1a hashes), and examples as hashed feature
// numbers, never as document text. Stored in IndexedDB in the extension's own origin (sw/memory.js;
// localStorage on test pages). Below this reviewer's answers sits the team's list for the project
// (setTeam, from the PIIRA server): a reviewer's own answer always wins over the team's.
(function (g) {
  'use strict';
  const P = g.PIIRA;

  const KEY = 'piira.learning.v1';
  const NOT_PII = 'NOT_PII';
  const DIM = 1 << 14;          // hashed feature space
  const MAX_FEATURES = 64;      // per example, keeps storage small
  const MAX_EXAMPLES = 3000;    // oldest dropped first
  const MAX_MEMORY = 20000;
  const MAX_VALUE = 200;        // longer spans are sentences, not values: not remembered
  const MAX_WORDS = 6;          // longest remembered value scanned for in new documents
  // When the learned model may act on its own.
  const MIN_EXAMPLES = 4;       // in total
  const MIN_CLASS = 2;          // of the class it predicts
  const SOFTEN_P = 0.6;         // "not PII" this sure -> confidence lowered to SOFT_CONFIDENCE
  const RELABEL_P = 0.7;        // another label this sure -> relabeled
  const KIND_AGREEMENT = 0.8;   // share of same-kind answers that must agree
  const MAX_GRAMS = 16;         // character trigrams per example
  const SOFT_CONFIDENCE = 0.5;  // below P.REVIEW_THRESHOLD: reported as possible, never auto-labeled
  const PRIOR = 1.5;            // head start (in logits) for the detector's own label
  const REFIT_BELOW = 400;      // up to this many examples, every answer refits the model from scratch

  const hasChrome = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  const CLASSES = P.LABELS.filter((l) => l.group).map((l) => l.name).concat([NOT_PII]);
  const C = CLASSES.length;
  const classIndex = new Map(CLASSES.map((c, i) => [c, i]));

  let mem = new Map();          // value key -> {l: label, f: label it was detected as, n, t, w: words, s: shape}
  let examples = [];            // [{k, x: [feature ids], y: label, t}]
  let stats = { seen: 0, hit: 0 };
  let W = new Float32Array(DIM * C);
  let classCount = new Map();
  let ready = false;
  let version = 0;              // bumped on every change; part of the analysis cache key
  let saveTimer = null;
  let nonce = '';               // tells our own writes apart from other tabs' in onChanged
  const listeners = new Set();

  // ---------- hashing and normalising

  function fnv(str, seed) {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  /** The form a value is remembered in: case, spacing and edge punctuation do not matter. */
  function normalize(v) {
    return String(v || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ')
      .replace(/^[\s"'`([{<,.;:!?]+|[\s"'`)\]}>,.;:!?]+$/g, '').trim();
  }

  function keyOf(v) {
    const n = normalize(v);
    return n ? fnv(n, 0x811c9dc5).toString(36) + '.' + fnv(n, 0x9747b28c).toString(36) : '';
  }

  const wordCount = (n) => (n ? n.split(' ').length : 0);

  /**
   * The value's shape with runs collapsed: "John Smith" -> "Aa Aa", "557058:4116-9a0f" -> "w:w-w".
   * In values with digits, letters and digits are one class, so IDs with different hex share a shape.
   */
  function shape(v) {
    const s = String(v || '').trim();
    const id = /\d/.test(s);
    let out = '';
    let prev = '';
    for (const ch of s) {
      let c;
      if (/\d/.test(ch)) c = id ? 'w' : 'd';
      else if (/\p{L}/u.test(ch)) c = id ? 'w' : (/\p{Lu}/u.test(ch) ? 'A' : 'a');
      else if (/\s/.test(ch)) c = ' ';
      else c = ch;
      if (c !== prev || !/[wdAa ]/.test(c)) out += c;
      prev = c;
      if (out.length >= 40) break;
    }
    return out;
  }

  const bucket = (n) => (n <= 3 ? n : n <= 6 ? '4-6' : n <= 10 ? '7-10' : n <= 16 ? '11-16' : n <= 32 ? '17-32' : '33+');

  // The field a value sits in: a JSON key ("assignee": "…") or a "Key:" label on the same line.
  function fieldKey(text, start) {
    const ls = text.lastIndexOf('\n', start - 1) + 1;
    const before = text.slice(Math.max(ls, start - 120), start);
    const m = /"([^"\n]{1,60})"\s*:\s*\[?\s*"?$/.exec(before) || /([\p{L}][\p{L}\d _.-]{0,40})\s*[:=]\s*["']?$/u.exec(before);
    return m ? m[1].trim().toLowerCase().replace(/[\s.-]+/g, '_').slice(-40) : '';
  }

  /** Hashed features of the value text[start, end) in its document, plus what the detector said. */
  function features(text, start, end, meta) {
    const v = text.slice(start, end);
    const n = normalize(v);
    const out = new Set();
    const add = (f) => out.add(fnv(f, 0x811c9dc5) & (DIM - 1));
    // What kind of value it is (shape, detector, field) counts three times as much as its letters:
    // two Atlassian IDs share almost no trigrams but are the same kind of thing.
    const strong = (f) => { add(f); add(f + '#2'); add(f + '#3'); };
    const m = meta || {};
    add('bias');
    strong('sh:' + shape(v));
    add('len:' + bucket(n.length));
    add('nw:' + Math.min(wordCount(n), 5));
    if (m.label) strong('l:' + m.label);
    if (m.type && m.type !== m.label) strong('t:' + m.type);
    if (m.rule) strong('r:' + String(m.rule).replace(/[\d-]+$/, ''));
    if (m.source) add('src:' + m.source);
    if (/\d/.test(v)) add('has:digit');
    if (/\p{L}/u.test(v)) add('has:letter');
    if (/[@]/.test(v)) add('has:@');
    if (/[:/]/.test(v)) add('has:sep');
    if (/^\p{Lu}[\p{Ll}]/u.test(v)) add('case:title');
    if (v === v.toUpperCase() && /\p{L}/u.test(v)) add('case:upper');
    add('pre:' + n.slice(0, 3));
    add('suf:' + n.slice(-3));
    const key = fieldKey(text, start);
    if (key) {
      strong('key:' + key);
      for (const part of key.split('_')) if (part.length > 1) add('kw:' + part);
    }
    const left = (text.slice(Math.max(0, start - 60), start).toLowerCase().match(/\p{L}{2,}/gu) || []).slice(-3);
    const right = (text.slice(end, end + 40).toLowerCase().match(/\p{L}{2,}/gu) || []).slice(0, 2);
    left.forEach((w, i) => add((i === left.length - 1 ? 'c1:' : 'cl:') + w));
    right.forEach((w) => add('cr:' + w));
    // Letters last, in whatever room is left (names and words are told apart by them).
    const padded = '^' + n.slice(0, 48) + '$';
    for (let i = 0, grams = 0; i + 3 <= padded.length && grams < MAX_GRAMS && out.size < MAX_FEATURES; i++, grams++) add('g:' + padded.slice(i, i + 3));
    return [...out].sort((a, b) => a - b);
  }

  // ---------- the learned model

  // `prior`: the label the detector gave. It gets a head start, so the learned model has to be clearly
  // surer than the detector before it overrides it.
  function scores(x, prior) {
    const z = new Float64Array(C);
    for (const i of x) {
      const o = i * C;
      for (let c = 0; c < C; c++) z[c] += W[o + c];
    }
    const pi = prior ? classIndex.get(prior) : undefined;
    if (pi !== undefined) z[pi] += PRIOR;
    let max = -Infinity;
    for (let c = 0; c < C; c++) if (z[c] > max) max = z[c];
    let sum = 0;
    for (let c = 0; c < C; c++) { z[c] = Math.exp(z[c] - max); sum += z[c]; }
    for (let c = 0; c < C; c++) z[c] /= sum;
    return z;
  }

  function predict(x, prior) {
    const p = scores(x, prior);
    let best = 0;
    for (let c = 1; c < C; c++) if (p[c] > p[best]) best = c;
    return { label: CLASSES[best], p: p[best], probs: p };
  }

  // One step of gradient descent on the softmax loss. The step is split over the example's
  // features, so long and short values move the model by the same amount.
  function step(x, y, rate) {
    const yi = classIndex.get(y);
    if (yi === undefined || !x.length) return;
    const p = scores(x);
    const lr = (rate || 2) / x.length;
    for (let c = 0; c < C; c++) {
      const grad = p[c] - (c === yi ? 1 : 0);
      if (Math.abs(grad) < 1e-4) continue;
      for (const i of x) W[i * C + c] -= lr * grad;
    }
  }

  function retrain() {
    W = new Float32Array(DIM * C);
    kinds = null;
    classCount = new Map();
    for (const e of examples) classCount.set(e.y, (classCount.get(e.y) || 0) + 1);
    if (!examples.length) return;
    const order = examples.map((_, i) => i);
    let seed = 42;
    const epochs = examples.length <= REFIT_BELOW ? 12 : 6;   // few answers: fit them closely
    for (let epoch = 0; epoch < epochs; epoch++) {
      for (let i = order.length - 1; i > 0; i--) {     // deterministic shuffle
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        const j = seed % (i + 1);
        [order[i], order[j]] = [order[j], order[i]];
      }
      const rate = 2 / (1 + epoch * 0.5);
      for (const i of order) step(examples[i].x, examples[i].y, rate);
    }
  }

  const modelReady = () => examples.length >= MIN_EXAMPLES;

  // The learned model only overrides a detector for the kind of value the reviewer has answered:
  // an answer with the same label, about a value of the same shape that the detector gave the same
  // label. Several "not PII" Atlassian IDs teach it about Atlassian IDs, not about names or API keys.
  // At least MIN_CLASS answers of that kind, and (almost) all of them the same.
  let kinds = null;
  function sameKindAnswered(label, detected, sh) {
    if (!kinds) {
      kinds = new Map();
      for (const e of examples) {
        if (!e.s) continue;
        const k = `${e.f}|${e.s}`;
        if (!kinds.has(k)) kinds.set(k, new Map());
        const votes = kinds.get(k);
        votes.set(e.y, (votes.get(e.y) || 0) + 1);
      }
    }
    const votes = kinds.get(`${detected}|${sh}`);
    if (!votes) return false;
    const yes = votes.get(label) || 0;
    const all = [...votes.values()].reduce((a, b) => a + b, 0);
    return yes >= MIN_CLASS && yes / all >= KIND_AGREEMENT;
  }

  // ---------- storage

  async function load() {
    let data = null;
    try { data = await readStore(); } catch (e) { data = null; }
    fromData(data);
    ready = true;
    return summary();
  }

  function fromData(data) {
    mem = new Map(data && Array.isArray(data.mem) ? data.mem : []);
    examples = data && Array.isArray(data.ex) ? data.ex.filter((e) => e && Array.isArray(e.x) && classIndex.has(e.y)) : [];
    stats = Object.assign({ seen: 0, hit: 0 }, data && data.st);
    retrain();
    version++;
  }

  // ---------- storage
  // In the extension: IndexedDB in the extension's own origin, through the background (sw/memory.js),
  // written incrementally (one value and its example per answer). On test pages: localStorage, whole.
  let backend = 'local';
  let pending = [];          // writes not sent yet: {store, put} | {store, del}
  let clearPending = false;

  async function readStore() {
    const r = P.ext ? await P.ext.background('mem-load', null, 15000) : { ok: false };
    if (r && r.ok) { backend = 'idb'; return r; }
    backend = 'local';
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }

  function queueWrite(ops) {
    pending.push(...ops);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 300);
  }

  async function save() {
    nonce = Math.random().toString(36).slice(2);
    if (backend === 'idb') {
      const ops = pending;
      const clear = clearPending;
      pending = [];
      clearPending = false;
      const r = await P.ext.background('mem-write', { ops, stats, clear, from: nonce }, 15000);
      if (!r.ok) { pending = ops.concat(pending); clearPending = clearPending || clear; }  // retried with the next answer
      return;
    }
    pending = [];
    clearPending = false;
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, w: nonce, mem: [...mem], ex: examples, st: stats })); } catch (e) { /* keep in memory */ }
  }

  // Answers given in another tab reach this one too.
  if (hasChrome && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      const rev = area === 'local' && changes['piira.learning.rev'];
      if (!rev || !rev.newValue || rev.newValue.from === nonce) return;
      readStore().then((data) => { fromData(data); listeners.forEach((fn) => fn()); });
    });
  }

  // ---------- the team's list (pulled from the PIIRA server per project, see sw/cloud-sync.js)
  // Values the team agreed on: a lower layer than this reviewer's own answers, which always win.
  let team = new Map();
  let teamNames = [];
  let teamInfo = { project: '', version: 0, entries: 0 };

  function setTeam(profile) {
    const next = new Map();
    const names = [];
    for (const e of (profile && Array.isArray(profile.entries) ? profile.entries : [])) {
      if (!classIndex.has(e.label)) continue;
      const n = normalize(e.value);
      if (!n || n.length > MAX_VALUE) continue;
      next.set(keyOf(e.value), { l: e.label, f: '', w: wordCount(n), team: true });
      if (e.label === 'Business Name') names.push(e.value.replace(/\s+/g, ' ').trim());
    }
    teamNames = names;
    const same = profile && profile.version === teamInfo.version && profile.project === teamInfo.project && next.size === team.size;
    team = next;
    teamInfo = { project: (profile && profile.project) || '', version: (profile && profile.version) || 0, entries: next.size };
    if (!same) version++;
    return !same;
  }
  /** This reviewer's answer for a value key, else the team's. */
  const recOf = (k) => mem.get(k) || team.get(k);

  const recordListeners = new Set();

  // ---------- learning from an answer

  /**
   * Remember the reviewer's answer for the value text[start, end).
   * @param a {text, start, end, label: a site label or 'NOT_PII', from: the label it was detected as, type, rule, source}
   * @returns the value key, or '' when the value is not remembered (empty or a whole sentence)
   */
  function record(a) {
    if (!a || !a.text || !(a.end > a.start) || !classIndex.has(a.label)) return '';
    const v = a.text.slice(a.start, a.end);
    const n = normalize(v);
    if (!n || n.length > MAX_VALUE) return '';
    const k = keyOf(v);
    const x = features(a.text, a.start, a.end, { label: a.from, type: a.type, rule: a.rule, source: a.source });
    // How good the learned model already was, before it sees this answer.
    if (modelReady()) {
      stats.seen++;
      const expected = (mem.get(k) || {}).l || predict(x).label;
      if (expected === a.label) stats.hit++;
    }
    const old = mem.get(k);
    const rec = { l: a.label, f: a.from || '', n: old && old.l === a.label ? old.n + 1 : 1, t: Date.now(), w: wordCount(n), s: shape(v) };
    // A company name is business data, not a person's: kept in plain text so the business-name detector finds it
    // in every spelling and inside links and code ("acme.com", "TeamAcme"). Personal values stay hashes only.
    if (a.label === 'Business Name') rec.v = v.replace(/\s+/g, ' ').trim();
    mem.set(k, rec);
    const ops = [{ store: 'memory', put: { k, ...rec } }];
    if (mem.size > MAX_MEMORY) {
      const oldest = [...mem].sort((p, q) => p[1].t - q[1].t).slice(0, mem.size - MAX_MEMORY);
      for (const [key] of oldest) { mem.delete(key); ops.push({ store: 'memory', del: key }); }
    }
    examples = examples.filter((e) => e.k !== k);     // the newest answer for a value replaces older ones
    const example = { k, x, y: a.label, t: Date.now(), s: shape(v), f: a.from || '' };
    examples.push(example);
    ops.push({ store: 'examples', put: example });
    if (examples.length > MAX_EXAMPLES) {
      for (const e of examples.slice(0, examples.length - MAX_EXAMPLES)) ops.push({ store: 'examples', del: e.k });
      examples = examples.slice(-MAX_EXAMPLES);
    }
    if (examples.length <= REFIT_BELOW) retrain();      // small data: a full refit takes a few ms
    else {
      classCount.set(a.label, (classCount.get(a.label) || 0) + 1);
      kinds = null;
      // Learn it now (a few steps), and replay recent answers so older lessons are not overwritten.
      for (let i = 0; i < 4; i++) step(x, a.label, 2);
      for (const e of examples.slice(-40)) step(e.x, e.y, 0.5);
    }
    version++;
    queueWrite(ops);
    // Team sync decides what may be shared (core/cloud-share.js); the full value goes to listeners only.
    const answer = { value: v.replace(/\s+/g, ' ').trim(), label: a.label, from: a.from || '', fieldKey: fieldKey(a.text, a.start), at: Date.now() };
    recordListeners.forEach((fn) => { try { fn(answer); } catch (e) { /* a listener never breaks learning */ } });
    return k;
  }

  /** Undo an answer (the reviewer changed their mind): forget the value and retrain. */
  function forget(k) {
    if (!k || !mem.has(k)) return;
    mem.delete(k);
    examples = examples.filter((e) => e.k !== k);
    retrain();
    version++;
    queueWrite([{ store: 'memory', del: k }, { store: 'examples', del: k }]);
  }

  async function reset() {
    mem = new Map();
    examples = [];
    stats = { seen: 0, hit: 0 };
    retrain();
    version++;
    pending = [];
    clearPending = true;
    clearTimeout(saveTimer);
    if (backend === 'idb') { await save(); return; }
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  /** Company names taught by this reviewer or the team (plain text), for detectors/business-name.js. */
  function businessNames() {
    const out = new Set();
    for (const r of mem.values()) if (r.l === 'Business Name' && r.v) out.add(r.v);
    for (const v of teamNames) out.add(v);
    // A name this reviewer later called something else is not a company any more.
    return [...out].filter((v) => { const r = recOf(keyOf(v)); return r && r.l === 'Business Name'; });
  }

  /** The remembered answer for a value (this reviewer's, else the team's): a label, 'NOT_PII', or null. */
  function lookup(v) {
    const r = recOf(keyOf(v));
    return r ? r.l : null;
  }
  const isNotPii = (v) => lookup(v) === NOT_PII;

  // ---------- using what was learned

  // Whitespace-separated words with their offsets, edge punctuation trimmed.
  function words(text) {
    const out = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      let s = m.index;
      let e = s + m[0].length;
      while (s < e && /["'`([{<,.;:!?]/.test(text[s])) s++;
      while (e > s && /["'`)\]}>,.;:!?]/.test(text[e - 1])) e--;
      if (e > s) out.push({ start: s, end: e });
    }
    return out;
  }

  // Values the reviewer called PII that the detectors did not find: every word-bounded occurrence.
  function findRemembered(text) {
    const lengths = new Set();
    for (const src of [mem, team]) for (const r of src.values()) if (r.l !== NOT_PII && r.w >= 1 && r.w <= MAX_WORDS) lengths.add(r.w);
    if (!lengths.size) return [];
    const ws = words(text);
    const found = [];
    for (let i = 0; i < ws.length; i++) {
      for (const len of lengths) {
        if (i + len > ws.length) continue;
        const start = ws[i].start;
        const end = ws[i + len - 1].end;
        if (end - start > MAX_VALUE) continue;
        const r = recOf(keyOf(text.slice(start, end)));
        if (r && r.l !== NOT_PII && r.w === len) found.push({ start, end, label: r.l, team: Boolean(r.team) });
      }
    }
    return found;
  }

  // One label per piece of text: on overlap the surer (then longer) detection stays.
  function withoutOverlaps(list) {
    const sorted = list.slice().sort((a, b) => a.start - b.start || b.end - a.end);
    const out = [];
    for (const d of sorted) {
      const prev = out[out.length - 1];
      if (!prev || d.start >= prev.end) { out.push(d); continue; }
      const better = (d.confidence || 0) > (prev.confidence || 0) ||
        ((d.confidence || 0) === (prev.confidence || 0) && d.end - d.start > prev.end - prev.start);
      if (better) out[out.length - 1] = d;
    }
    return out;
  }

  /**
   * Cross-check detections against everything learned. Pure apart from reading the memory.
   * @returns {detections, stats: {dropped, relabeled, softened, added, confirmed}}
   */
  function apply(text, detections) {
    const st = { dropped: 0, relabeled: 0, softened: 0, added: 0, confirmed: 0 };
    if (!ready || (!mem.size && !examples.length && !team.size)) return { detections, stats: st };
    const generalise = modelReady();
    const out = [];
    for (const d of detections) {
      const v = text.slice(d.start, d.end);
      const r = recOf(keyOf(v));
      if (r) {
        const via = r.team ? 'team' : 'memory';
        if (r.l === NOT_PII) { st.dropped++; continue; }
        if (r.l !== d.label) {
          st.relabeled++;
          out.push({ ...d, label: r.l, type: r.l, confidence: Math.max(d.confidence || 0, 0.95), source: r.team ? 'team' : 'learned', learned: { via, from: d.label } });
        } else {
          st.confirmed++;
          out.push({ ...d, confidence: Math.max(d.confidence || 0, 0.95), learned: { via, confirmed: true } });
        }
        continue;
      }
      // Auto-Fill labels one word at a time, so a removed label is often one word of a longer value:
      // when every word of it was answered "not PII", so is the value.
      const parts = v.trim().split(/\s+/);
      if (parts.length > 1 && parts.length <= MAX_WORDS && parts.every((w) => (recOf(keyOf(w)) || {}).l === NOT_PII)) {
        st.dropped++;
        continue;
      }
      if (generalise) {
        const pr = predict(features(text, d.start, d.end, d), d.label);
        if (pr.label !== d.label && (classCount.get(pr.label) || 0) >= MIN_CLASS && sameKindAnswered(pr.label, d.label, shape(v))) {
          if (pr.label === NOT_PII && pr.p >= SOFTEN_P) {
            st.softened++;
            out.push({ ...d, confidence: Math.min(d.confidence || 0, SOFT_CONFIDENCE), learned: { via: 'model', label: NOT_PII, p: pr.p } });
            continue;
          }
          if (pr.label !== NOT_PII && pr.p >= RELABEL_P) {
            st.relabeled++;
            out.push({ ...d, label: pr.label, type: pr.label, source: 'learned', learned: { via: 'model', from: d.label, p: pr.p } });
            continue;
          }
        }
      }
      out.push(d);
    }
    for (const f of findRemembered(text)) {
      if (out.some((d) => d.start < f.end && d.end > f.start)) continue;
      st.added++;
      out.push({ text: text.slice(f.start, f.end), label: f.label, type: f.label, start: f.start, end: f.end,
        confidence: 0.95, source: f.team ? 'team' : 'learned', rule: f.team ? 'team-value' : 'learned-value',
        learned: { via: f.team ? 'team' : 'memory', added: true } });
    }
    return { detections: withoutOverlaps(out), stats: st };
  }

  function summary() {
    let notPii = 0;
    let relabels = 0;
    let pii = 0;
    for (const r of mem.values()) {
      if (r.l === NOT_PII) notPii++;
      else if (r.f && r.f !== r.l) relabels++;
      else pii++;
    }
    return {
      remembered: mem.size, notPii, relabels, pii, examples: examples.length,
      generalising: modelReady(), needed: Math.max(0, MIN_EXAMPLES - examples.length), accuracy: stats.seen >= 5 ? stats.hit / stats.seen : null, answers: stats.seen,
      storage: backend, team: { ...teamInfo },
    };
  }

  /** The dataset for the reviewer to keep or inspect: hashes, labels and counts only, no text. */
  function exportData() {
    return {
      kind: 'pii-review-assistant-learning', version: 1, exportedAt: new Date().toISOString(), summary: summary(),
      note: 'Values are stored as hashes; no document text is included.',
      values: [...mem].map(([k, r]) => ({ hash: k, label: r.l, detectedAs: r.f || null, times: r.n, shape: r.s, words: r.w, at: new Date(r.t).toISOString() })),
    };
  }

  P.learning = {
    NOT_PII,
    CLASSES,
    load,
    record,
    forget,
    reset,
    lookup,
    isNotPii,
    keyOf,
    apply,
    summary,
    exportData,
    setTeam,
    businessNames,
    onChange(fn) { listeners.add(fn); },
    /** Called with every answer remembered: {value, label, from, fieldKey, at} (team sync filters it). */
    onRecord(fn) { recordListeners.add(fn); },
    get version() { return version; },
    // exposed for tests
    _: { normalize, shape, features, predict, fieldKey, withoutOverlaps },
  };
})(globalThis);
