// GLiNER in plain JavaScript: the tokenizer (SentencePiece Unigram, from tokenizer.json) and the
// steps around the ONNX model (prompt, word mask, spans, decoding). The ONNX runtime is passed in,
// so the same file runs in the extension's offscreen page (onnxruntime-web) and in Node tests
// (onnxruntime-node). No network, no DOM.
//
// Compared with GLiNER.js 0.0.19 (MIT, https://github.com/Ingvarstep/GLiNER.js), which this follows:
//   - one text per model call (batching padded texts corrupted its results),
//   - spans past the end of the text are masked out (it only clamped them),
//   - words are split with Unicode classes, so "João" or "राहुल" stay one word.
(function (g) {
  'use strict';

  // ------------------------------------------------------------------ tokenizer

  class UnigramTokenizer {
    /** @param json parsed tokenizer.json of a Unigram model (mDeBERTa-v3) */
    constructor(json) {
      const m = json.model;
      if (!m || m.type !== 'Unigram') throw new Error(`tokenizer: expected a Unigram model, got ${m && m.type}`);
      this.pieces = new Map();
      this.maxLen = 1;
      let minScore = 0;
      m.vocab.forEach(([piece, score], id) => {
        if (!this.pieces.has(piece)) this.pieces.set(piece, [id, score]);
        if (piece.length > this.maxLen) this.maxLen = piece.length;
        if (score < minScore) minScore = score;
      });
      this.unkId = m.unk_id;
      this.unkScore = minScore - 10;
      this.added = new Map((json.added_tokens || []).map((t) => [t.content, t.id]));
      this.clsId = this.added.get('[CLS]');
      this.sepId = this.added.get('[SEP]');
      this.cache = new Map();
    }

    // The Precompiled (SentencePiece) normaliser is close to NFKC; this matches Transformers.js.
    static normalize(s) {
      return s.normalize('NFKC').replace(/[\u0000-\u0008\u000B\u000E-\u001F\u007F\u008F\u009F]/g, '').trim().replace(/ {2,}/g, ' ');
    }

    /** Token ids of one word (no [CLS]/[SEP]). */
    encodeWord(word) {
      if (this.added.has(word)) return [this.added.get(word)];
      const hit = this.cache.get(word);
      if (hit) return hit;
      const norm = UnigramTokenizer.normalize(word);
      const ids = norm ? this.viterbi('▁' + norm.replace(/ /g, '▁')) : [];
      if (this.cache.size > 50000) this.cache.clear();
      this.cache.set(word, ids);
      return ids;
    }

    viterbi(s) {
      const n = s.length;
      const best = new Float64Array(n + 1).fill(-Infinity);
      const from = new Int32Array(n + 1).fill(-1);
      const tok = new Int32Array(n + 1).fill(-1);
      best[0] = 0;
      for (let i = 0; i < n; i++) {
        if (best[i] === -Infinity) continue;
        let matched = false;
        const max = Math.min(this.maxLen, n - i);
        for (let len = 1; len <= max; len++) {
          const p = this.pieces.get(s.slice(i, i + len));
          if (!p) continue;
          matched = true;
          const sc = best[i] + p[1];
          if (sc > best[i + len]) { best[i + len] = sc; from[i + len] = i; tok[i + len] = p[0]; }
        }
        if (!matched) { // unknown character (a whole code point)
          const len = s.codePointAt(i) > 0xffff ? 2 : 1;
          const sc = best[i] + this.unkScore;
          if (sc > best[i + len]) { best[i + len] = sc; from[i + len] = i; tok[i + len] = this.unkId; }
        }
      }
      const ids = [];
      for (let i = n; i > 0; i = from[i]) {
        if (from[i] < 0) return [this.unkId];
        ids.push(tok[i]);
      }
      ids.reverse();
      // Consecutive unknown pieces count as one, as in the reference tokenizer.
      return ids.filter((id, k) => !(id === this.unkId && ids[k - 1] === this.unkId));
    }
  }

  // ------------------------------------------------------------------ GLiNER

  // GLiNER's word splitter, with Unicode letters, marks and digits instead of ASCII \w.
  const WORD = /[\p{L}\p{M}\p{N}_]+(?:[-_][\p{L}\p{M}\p{N}_]+)*|\S/gu;

  function splitWords(text) {
    const words = [];
    WORD.lastIndex = 0;
    let m;
    while ((m = WORD.exec(text)) !== null) words.push({ w: m[0], start: m.index, end: m.index + m[0].length });
    return words;
  }

  const sigmoid = (x) => 1 / (1 + Math.exp(-x));

  class Gliner {
    /**
     * @param ort     an onnxruntime module (onnxruntime-web or onnxruntime-node)
     * @param session an ort.InferenceSession for the GLiNER span model
     * @param tokenizer a UnigramTokenizer
     * @param config  {maxWidth: 12, maxWords: 200}
     */
    constructor(ort, session, tokenizer, config) {
      this.ort = ort;
      this.session = session;
      this.tok = tokenizer;
      this.maxWidth = (config && config.maxWidth) || 12;
      this.maxWords = (config && config.maxWords) || 200;
    }

    /** Entities in one short text (≤ maxWords words): [{label, start, end, score}] (character offsets). */
    async predict(text, labels, threshold) {
      const words = splitWords(text);
      if (!words.length) return [];
      if (words.length > this.maxWords) throw new Error(`text has ${words.length} words; split it into windows of ${this.maxWords}`);
      const { Tensor } = this.ort;
      const big = (arr) => BigInt64Array.from(arr, (x) => BigInt(x));

      // [CLS] <<ENT>> label … <<SEP>> word1 word2 … [SEP]; the word mask numbers the first piece of each text word.
      const ids = [this.tok.clsId];
      const wmask = [0];
      for (const label of labels) {
        for (const w of ['<<ENT>>', ...label.split(' ')]) for (const t of this.tok.encodeWord(w)) { ids.push(t); wmask.push(0); }
      }
      for (const t of this.tok.encodeWord('<<SEP>>')) { ids.push(t); wmask.push(0); }
      words.forEach((w, k) => {
        this.tok.encodeWord(w.w).forEach((t, j) => { ids.push(t); wmask.push(j === 0 ? k + 1 : 0); });
      });
      ids.push(this.tok.sepId);
      wmask.push(0);

      const n = words.length;
      const W = this.maxWidth;
      const spanIdx = new Array(n * W * 2).fill(0);
      const spanMask = new Uint8Array(n * W);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < W; j++) {
          const k = i * W + j;
          if (i + j < n) { spanIdx[2 * k] = i; spanIdx[2 * k + 1] = i + j; spanMask[k] = 1; }
        }
      }
      const feeds = {
        input_ids: new Tensor('int64', big(ids), [1, ids.length]),
        attention_mask: new Tensor('int64', big(ids.map(() => 1)), [1, ids.length]),
        words_mask: new Tensor('int64', big(wmask), [1, ids.length]),
        text_lengths: new Tensor('int64', big([n]), [1, 1]),
        span_idx: new Tensor('int64', big(spanIdx), [1, n * W, 2]),
        span_mask: new Tensor('bool', spanMask, [1, n * W]),
      };
      const out = await this.session.run(feeds);
      const logits = out.logits;
      const [, L, , C] = logits.dims; // [1, words, maxWidth, classes]
      const data = logits.data;

      const cands = [];
      for (let i = 0; i < Math.min(L, n); i++) {
        for (let j = 0; j < W && i + j < n; j++) {
          for (let c = 0; c < C && c < labels.length; c++) {
            const s = sigmoid(data[((i * W) + j) * C + c]);
            if (s >= threshold) cands.push({ i, e: i + j, c, s });
          }
        }
      }
      // Flat NER: the highest-scoring spans first, no overlaps.
      cands.sort((a, b) => b.s - a.s);
      const taken = [];
      const result = [];
      for (const k of cands) {
        if (taken.some(([a, b]) => k.i <= b && k.e >= a)) continue;
        taken.push([k.i, k.e]);
        result.push({ label: labels[k.c], start: words[k.i].start, end: words[k.e].end, score: k.s });
      }
      return result.sort((a, b) => a.start - b.start);
    }
  }

  /** Windows of whole lines, each at most maxWords words: [{start, text}]. */
  function windows(text, maxWords) {
    const out = [];
    let start = 0;
    let count = 0;
    let pos = 0;
    const push = (end) => { if (/\S/.test(text.slice(start, end))) out.push({ start, text: text.slice(start, end) }); };
    for (const line of text.split('\n')) {
      const n = splitWords(line).length;
      if (count && count + n > maxWords) { push(pos - 1); start = pos; count = 0; }
      if (n > maxWords) {
        // A very long line: cut it at word boundaries.
        const ws = splitWords(line);
        for (let k = 0; k < ws.length; k += maxWords) {
          const a = pos + ws[k].start;
          const b = pos + ws[Math.min(k + maxWords, ws.length) - 1].end;
          out.push({ start: a, text: text.slice(a, b) });
        }
        start = pos + line.length + 1;
        count = 0;
      } else {
        count += n;
      }
      pos += line.length + 1;
    }
    push(text.length);
    return out;
  }

  /**
   * The lines worth showing the model, packed into windows: lines with at least two letters in a row,
   * each distinct line once (logs and tables repeat the same line many times).
   * Returns {windows: [{text, lines: [{at, len, key}]}], occurrences: Map(key -> [line starts]), words, skipped}.
   * `at` is the line's offset inside the window text; results are copied to every occurrence.
   */
  function planLines(text, maxWords) {
    const occurrences = new Map();
    const unique = [];
    let pos = 0;
    let total = 0;
    let skipped = 0;
    for (const line of text.split('\n')) {
      const key = line.trim();
      if (key && /\p{L}{2}/u.test(key)) {
        const lead = line.length - line.trimStart().length;
        if (!occurrences.has(key)) { occurrences.set(key, []); unique.push(key); }
        occurrences.get(key).push(pos + lead);
      } else if (key) {
        skipped++;
      }
      pos += line.length + 1;
    }
    const wins = [];
    let cur = null;
    for (const key of unique) {
      const n = splitWords(key).length;
      total += n;
      if (n > maxWords) { // a very long line: its own windows, cut at word boundaries
        const ws = splitWords(key);
        for (let k = 0; k < ws.length; k += maxWords) {
          const a = ws[k].start;
          const b = ws[Math.min(k + maxWords, ws.length) - 1].end;
          wins.push({ text: key.slice(a, b), lines: [{ at: 0, len: b - a, key, offset: a }], words: Math.min(maxWords, ws.length - k) });
        }
        continue;
      }
      if (!cur || cur.words + n > maxWords) { cur = { text: '', lines: [], words: 0 }; wins.push(cur); }
      if (cur.text) cur.text += '\n';
      cur.lines.push({ at: cur.text.length, len: key.length, key, offset: 0 });
      cur.text += key;
      cur.words += n;
    }
    return { windows: wins, occurrences, words: total, skipped };
  }

  const api = { UnigramTokenizer, Gliner, splitWords, windows, planLines };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else g.PIIRA_ML = api;
})(globalThis);
