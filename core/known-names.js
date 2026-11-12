// Well-known names from data/business-names.json: top MNCs, institutes, popular
// brands and banks. Project rule: these are public names, not PII.
//   - The Business Name detector never flags them.
//   - Labeling or redacting one on the right is over-scrubbing, reported with the
//     list category it comes from ("Infosys" -> Top MNCs · Indian IT).
// Edit the JSON to change the list; nothing here needs to change.
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const U = P.util;

  const DATA_FILE = 'data/business-names.json';
  // Endings that do not change which organisation a name is.
  const SUFFIX = String.raw`(?:Pvt\.?\s*Ltd|Private\s+Limited|Ltd|Limited|Inc|Incorporated|LLP|LLC|Corp|Corporation|PLC|Co|Group|Technologies)\.?`;
  const LEGAL_END = new RegExp(String.raw`\s+${SUFFIX}$`, 'i');
  const ACRONYMS = { mncs: 'MNCs', it: 'IT', psus: 'PSUs' };

  let byKey = new Map();  // normalised name -> {name, category}
  let finder = null;      // one regex for every name, longest first
  let version = '';

  const categoryName = (path) => path.map((part) => part.split('_')
    .map((w) => ACRONYMS[w] || w.charAt(0).toUpperCase() + w.slice(1)).join(' ')).join(' · ');

  /** "Infosys Technologies Pvt Ltd" -> "infosys", "Larsen and Toubro" -> "larsen & toubro" */
  function normalize(text) {
    let t = String(text || '').replace(/[’]/g, "'").replace(/\s+/g, ' ').trim().replace(/[.,]+$/, '');
    for (let i = 0; i < 3; i++) {
      const u = t.replace(LEGAL_END, '').trim();
      if (u === t || !u) break;
      t = u;
    }
    return t.toLowerCase().replace(/\s+and\s+/g, ' & ');
  }

  function flatten(node, path, out) {
    if (Array.isArray(node)) {
      for (const name of node) if (typeof name === 'string' && name.trim()) out.push({ name: name.trim(), category: categoryName(path) });
    } else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) flatten(value, path.concat(key), out);
    }
    return out;
  }

  /** Use a parsed business-names.json. */
  function setData(json) {
    const entries = flatten(json, [], []);
    byKey = new Map(entries.map((e) => [normalize(e.name), e]));
    // Names are matched as written or in capitals ("INFOSYS"), never in lower case,
    // so ordinary words ("shell", "visa", "ola") are not taken for a name.
    const variants = [];
    for (const e of entries) {
      variants.push(e.name);
      if (e.name.toUpperCase() !== e.name) variants.push(e.name.toUpperCase());
    }
    const pattern = [...new Set(variants)].sort((a, b) => b.length - a.length)
      .map((n) => U.escapeRe(n).replace(/'/g, "['’]").replace(/ & /g, '\\s*(?:&|and)\\s*').replace(/ /g, '\\s+'))
      .join('|');
    finder = pattern ? new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${pattern})(?:\s+${SUFFIX})*(?![\p{L}\p{N}])`, 'gu') : null;
    version = U.hash(JSON.stringify(json));
    return entries.length;
  }

  /**
   * Load the list (from the extension in Chrome, from the page folder on test.html),
   * plus any names the organisation adds through policy.
   */
  async function load(extraNames = []) {
    const url = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL ? chrome.runtime.getURL(DATA_FILE) : DATA_FILE;
    try {
      const res = await fetch(url);
      const json = await res.json();
      return setData(extraNames.length ? { ...json, organisation_list: extraNames } : json);
    } catch (err) {
      console.warn('[PII Review Automation] could not load', DATA_FILE, err);
      return 0;
    }
  }

  /** {name, category} when `text` is one of the known names (with or without "Ltd", "Pvt Ltd"…), else null. */
  function lookup(text) {
    const hit = byKey.get(normalize(text));
    if (hit) return hit;
    // The offline knowledge base (core/knowledge.js): a company famous enough to be a public name.
    const kb = P.kb && P.kb.wellKnownCompany(text);
    if (kb) return { name: kb.name, category: `well-known company (Wikipedia in ${kb.links} languages)` };
    const found = findIn(text);
    return found.length === 1 && found[0].start === 0 && found[0].end === String(text).trim().length ? found[0] : null;
  }

  // "Harrison Ford", "Mr. Ravi Shell": a one-word name right after another capitalised
  // word is far more likely a person's surname than the company — unless that word
  // is an ordinary sentence opener ("Visit Google", "Joined Infosys").
  const OPENERS = new Set(('visit visited join joined contact call email ask at from with by to in for our your their the a an ' +
    'and or but try use used buy shop order employer company client vendor bank work works worked thanks thank via see').split(' '));
  function looksLikeSurname(text, start, name) {
    if (/\s/.test(name)) return false;
    const before = /(\p{Lu}\p{Ll}+)\s+$/u.exec(text.slice(Math.max(0, start - 40), start));
    return Boolean(before && !OPENERS.has(before[1].toLowerCase()));
  }

  /** Every known name in a text: [{start, end, text, name, category}], the list's and the knowledge base's. */
  function findIn(text) {
    const out = findListed(text);
    if (P.kb) for (const k of P.kb.findCompanies(text)) if (!out.some((o) => k.start < o.end && k.end > o.start)) out.push(k);
    return out.sort((a, b) => a.start - b.start);
  }

  function findListed(text) {
    if (!finder) return [];
    const out = [];
    finder.lastIndex = 0;
    let m;
    while ((m = finder.exec(text)) !== null) {
      const e = byKey.get(normalize(m[0]));
      if (!e || looksLikeSurname(text, m.index, e.name)) continue;
      out.push({ start: m.index, end: m.index + m[0].length, text: m[0], name: e.name, category: e.category });
    }
    return out;
  }

  P.knownNames = { load, setData, lookup, findIn,
    get version() { return version + (P.kb && P.kb.version ? `+kb:${P.kb.version}` : ''); }, get size() { return byKey.size; } };
})(globalThis);
