// Structure of a document: which text is a column header / JSON key / field label, and which
// value belongs to which field. Detectors read values on the same line as their keyword, so in a
// CSV or JSON file the header ("us_bank_number", "nomor_kk", "पासपोर्ट") is too far from the value.
// This gives every value its field name back.
//
//   parse(text) -> {
//     format: 'csv' | 'json' | null,
//     keys:  [{start, end}]                  header cells, JSON keys and recognised "Key:" labels: never PII
//     cells: [{start, end, key, type, nonPii, source}]   values with the field they belong to
//   }
//   type:   the PII type the field name stands for (core/pii-keys.js), or null
//   nonPii: the field's values are never PII (Department, Status, record_id…)
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const K = () => P.piiKeys;

  const DELIMS = [',', '\t', '|', ';'];
  const HEADER_CELL = /^[\p{L}_][\p{L}\p{M}\p{N} _.\-()#\/]{0,60}$/u;

  function lines(text) {
    const out = [];
    let pos = 0;
    for (const raw of text.split('\n')) {
      out.push({ start: pos, end: pos + raw.replace(/\r$/, '').length, text: raw.replace(/\r$/, '') });
      pos += raw.length + 1;
    }
    return out;
  }

  /**
   * The records of a delimited text with cell offsets. Quoted cells may hold the delimiter, doubled
   * quotes and line breaks ("Gift wrap\nplease" in a Notes column). Blank lines are skipped.
   */
  function records(text, delim) {
    const out = [];
    let row = [];
    let i = 0;
    const n = text.length;
    let guard = 0;
    while (i <= n && guard++ < n + 10) {
      let a;
      let b;
      let j = i;
      while (j < n && (text[j] === ' ' || text[j] === '\t') && text[j] !== delim) j++;
      if (text[j] === '"') {
        let k = j + 1;
        while (k < n && !(text[k] === '"' && text[k + 1] !== '"')) k += text[k] === '"' ? 2 : 1;
        a = j + 1;
        b = Math.min(k, n);
        i = k + 1;
        while (i < n && text[i] !== delim && text[i] !== '\n') i++; // anything after the closing quote
      } else {
        a = i;
        while (i < n && text[i] !== delim && text[i] !== '\n') i++;
        b = i;
      }
      while (a < b && /\s/.test(text[a])) a++;
      while (b > a && /\s/.test(text[b - 1])) b--;
      row.push({ start: a, end: b, text: text.slice(a, b) });
      if (i >= n || text[i] === '\n') {
        if (row.some((c) => c.text)) out.push(row);
        row = [];
        if (i >= n) break;
      }
      i++;
    }
    return out;
  }

  // Pipe tables (markdown, spreadsheets shown as text): "| R000003 | Support | A6286257 |". The empty
  // cells before the first and after the last "|" and "|---|---|" separator rows are not data.
  function pipeRecords(text) {
    return records(text, '|').map((r) => {
      let a = 0;
      let b = r.length;
      if (b > 1 && !r[0].text) a++;
      if (b - a > 1 && !r[b - 1].text) b--;
      return r.slice(a, b);
    }).filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c.text) || !c.text));
  }

  // A column of record ids ("R000003", "R000004"…): same letters, rising numbers. Never PII.
  function isIdColumn(values) {
    const m = values.map((v) => /^([A-Za-z]{0,4})[-_]?(\d{2,})$/.exec(v));
    if (m.length < 2 || m.some((x) => !x) || new Set(m.map((x) => x[1])).size !== 1) return false;
    const n = m.map((x) => Number(x[2]));
    return n.every((x, i) => !i || x > n[i - 1]);
  }

  // A pipe table without a header row: the columns have no names; record-id columns are not PII,
  // and the file's type (a by-pii-type task) can still find its column by the values' shape.
  function headerless(recs) {
    const width = recs[0].length;
    if (width < 2) return null;
    const rows = recs.filter((r) => r.length === width);
    if (rows.length < Math.max(3, Math.ceil(recs.length * 0.8))) return null;
    const ids = Array.from({ length: width }, (_, i) => isIdColumn(rows.map((r) => r[i].text)));
    const cells = [];
    for (const r of rows) {
      r.forEach((c, i) => {
        if (c.end > c.start) cells.push({ start: c.start, end: c.end, key: `column ${i + 1}`, type: null, nonPii: ids[i], source: 'column' });
      });
    }
    return { format: 'csv', keys: [], cells };
  }

  function parseCsv(text) {
    if (text.split('\n').filter((l) => l.trim()).length < 3) return null; // a header and at least two rows
    for (const delim of DELIMS) {
      if (!text.slice(0, text.indexOf('\n') >>> 0).includes(delim)) continue;
      const recs = delim === '|' ? pipeRecords(text) : records(text, delim);
      if (recs.length < 3) continue;
      const head = recs[0];
      // A header names columns; a cell with 3+ digits in a row ("R000003", "A6286257") is data.
      if (head.length < 2 || !head.every((c) => HEADER_CELL.test(c.text) && c.text.split(' ').length <= 5) ||
        (delim === '|' && head.some((c) => /\d{3}/.test(c.text)))) {
        const t = delim === '|' && headerless(recs);
        if (t) return t;
        continue;
      }
      const rows = recs.slice(1);
      const fit = rows.filter((r) => r.length === head.length).length;
      if (fit < Math.max(2, Math.ceil(rows.length * 0.8))) continue;
      const cols = head.map((h) => ({ name: h.text, type: K().typeOfKey(h.text), nonPii: K().nonPiiKey(h.text) }));
      const cells = [];
      for (const r of rows) {
        if (r.length !== head.length) continue;
        r.forEach((c, i) => {
          if (c.end > c.start) cells.push({ start: c.start, end: c.end, key: cols[i].name, type: cols[i].type, nonPii: cols[i].nonPii, source: 'column' });
        });
      }
      return { format: 'csv', keys: head.map((h) => ({ start: h.start, end: h.end })), cells };
    }
    return null;
  }

  // "key": "value"  ·  "key": 123  ·  'key': 'value'
  const JSON_PAIR = /(["'])((?:(?!\1)[^\\\n]|\\.){1,80})\1\s*:\s*(?:(["'])((?:(?!\3)[^\\\n]|\\.)*)\3|(-?\d[\d.eE+-]*|true|false|null))/gd;

  function parseJson(text) {
    const t = text.trim();
    if (!/^[\[{]/.test(t)) return null;
    const keys = [];
    const cells = [];
    JSON_PAIR.lastIndex = 0;
    let m;
    while ((m = JSON_PAIR.exec(text)) !== null) {
      const name = m[2];
      keys.push({ start: m.indices[0][0], end: m.indices[2][1] + 1 });
      const v = m.indices[4] || m.indices[5];
      if (!v || v[1] <= v[0]) continue;
      cells.push({ start: v[0], end: v[1], key: name, type: K().typeOfKey(name), nonPii: K().nonPiiKey(name), source: 'json-key' });
    }
    return keys.length >= 2 ? { format: 'json', keys, cells } : null;
  }

  // "Key: value" fields, several per line allowed ("Vehicle No: DL 49 KL 4247 Status: closed").
  // The key is up to four words before the colon. Only field names this table knows count,
  // so "Ravi: see you at 5" in a chat is not taken for a field.
  // Key words are capped at 60 characters: an open run re-read a long link from every letter (the page froze).
  const FIELD = /(?<![\p{L}\p{N}_])((?:[\p{L}][\p{L}\p{M}\p{N}_'’\/.()-]{0,60})(?:[ ][\p{L}][\p{L}\p{M}\p{N}_'’\/.()-]{0,60}){0,3})[ \t]*[:=][ \t]*(?=\S)(?!\/\/)/gdu;

  function parseFields(text) {
    const keys = [];
    const cells = [];
    for (const line of lines(text)) {
      if (!/[:=]/.test(line.text)) continue;
      const marks = [];
      FIELD.lastIndex = 0;
      let m;
      while ((m = FIELD.exec(line.text)) !== null) {
        // A colon inside a link or a quoted value is not a new field: "URL: \"mysql://user:pass@host\"".
        const before = line.text.slice(0, m.index);
        if (/[a-z][a-z0-9+.-]*:\/\/\S*$/i.test(before) || (before.split('"').length - 1) % 2 === 1) continue;
        // The type comes from the longest known key ending at the colon ("US passport" is a US passport);
        // the label itself is the shortest ending with that type, so "Ravi Kumar Phone:" keeps the name out.
        const words = m[1].split(' ');
        const at = (k) => words.slice(0, k).join(' ').length + (k ? 1 : 0);
        let best = null;
        for (let k = 0; k < words.length && !best; k++) {
          const name = words.slice(k).join(' ');
          const type = K().typeOfKey(name);
          if (type) best = { name, type, nonPii: false, from: at(k) };
        }
        if (best) {
          for (let k = words.length - 1; k >= 0; k--) {
            const name = words.slice(k).join(' ');
            if (K().typeOfKey(name) === best.type) { best = { ...best, name, from: at(k) }; break; }
          }
        } else {
          for (let k = words.length - 1; k >= 0 && !best; k--) {
            const name = words.slice(k).join(' ');
            if (K().nonPiiKey(name)) best = { name, type: null, nonPii: true, from: at(k) };
          }
        }
        marks.push({ m, best, valueStart: m.index + m[0].length });
      }
      // A field name never starts inside a URL: in "DATABASE_URL=postgres://admin:pass@db:5432/app"
      // "admin:" is the URL's user, and the field's value is the whole URL.
      const urls = [...line.text.matchAll(/[a-z][a-z0-9+.-]*:\/\/\S+/gi)].map((u) => [u.index, u.index + u[0].length]);
      if (urls.length) {
        for (let i = marks.length - 1; i >= 0; i--) {
          if (urls.some(([s, e]) => marks[i].m.index > s && marks[i].m.index < e)) marks.splice(i, 1);
        }
      }
      for (let i = 0; i < marks.length; i++) {
        const { m, best, valueStart } = marks[i];
        if (!best) continue;
        const keyStart = line.start + m.indices[1][0] + best.from;
        keys.push({ start: keyStart, end: line.start + m.indices[1][1] });
        let end = i + 1 < marks.length ? marks[i + 1].m.index : line.text.length;
        while (end > valueStart && /[\s,;]/.test(line.text[end - 1])) end--;
        // The value's words stop where the next field's words start ("DL 49 KL 4247 Status: closed").
        if (i + 1 < marks.length && marks[i + 1].best) {
          const next = marks[i + 1];
          end = Math.min(end, next.m.indices[1][0] + next.best.from);
          while (end > valueStart && /[\s,;]/.test(line.text[end - 1])) end--;
        }
        // A field that is never PII ("Amount", "Status") ends with its sentence: "Amount: Rs. 1,45,000. Transferred to
        // … account 5020…" — the next sentence is not part of the amount (and may hold PII).
        if (best.nonPii) {
          const re = /[.!?](?=[ \t]+\p{Lu}\p{Ll})/gu;
          re.lastIndex = valueStart;
          let s2;
          while ((s2 = re.exec(line.text)) !== null && s2.index < end) {
            if (/(?:^|[^\p{L}])(?:Rs|No|Mr|Mrs|Ms|Dr|Prof|Smt|Shri|St|Inc|Ltd|Co|Jr|Sr|vs|etc|Pvt|\p{L})$/u.test(line.text.slice(Math.max(valueStart, s2.index - 6), s2.index))) continue;
            end = s2.index;
            break;
          }
        }
        if (end <= valueStart) continue;
        let a = valueStart;
        let b = end;
        if (/["']/.test(line.text[a]) && line.text[b - 1] === line.text[a]) { a++; b--; }
        while (b > a && /[.,;:!?)\]}'"]/.test(line.text[b - 1])) b--; // "Account No: 5010… ." ends before the full stop
        cells.push({ start: line.start + a, end: line.start + b, key: best.name, type: best.type, nonPii: best.nonPii, source: 'field' });
      }
    }
    return { format: null, keys, cells };
  }

  const cache = { text: null, result: null };

  function parse(text) {
    if (cache.text === text) return cache.result;
    const result = parseJson(text) || parseCsv(text) || parseFields(text);
    result.cells.sort((a, b) => a.start - b.start);
    result.keys.sort((a, b) => a.start - b.start);
    cache.text = text;
    cache.result = result;
    return result;
  }

  // Cells and keys are in text order and do not overlap, so a binary search finds them.
  const firstEndingAfter = (list, pos) => P.util.lowerBound(list, pos + 1, (c) => c.end);

  /** The cell at [start, end) (the one containing it), or null. */
  function cellAt(structure, start, end) {
    if (!structure) return null;
    const c = structure.cells[firstEndingAfter(structure.cells, start)];
    return c && c.start <= start && c.end >= end ? c : null;
  }

  /** Does [start, end) touch a header cell, JSON key or field label? */
  function inKey(structure, start, end) {
    if (!structure) return false;
    const k = structure.keys[firstEndingAfter(structure.keys, start)];
    return Boolean(k && k.start < end);
  }

  /** The first key starting inside (start, end), or null. */
  function keyInside(structure, start, end) {
    if (!structure) return null;
    for (let i = firstEndingAfter(structure.keys, start); i < structure.keys.length && structure.keys[i].start < end; i++) {
      if (structure.keys[i].start > start) return structure.keys[i];
    }
    return null;
  }

  P.structured = { parse, cellAt, inKey, keyInside };
})(globalThis);
