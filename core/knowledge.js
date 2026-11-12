// Offline knowledge base (data/kb/, built by `npm run build-kb` from Wikidata and the Tranco top-sites
// list). Read-only lookups, nothing is ever sent anywhere. Used conservatively:
//   - a well-known company (Wikipedia in WELL_KNOWN+ languages) is a public name, like the business names
//     list: not PII, and labeling it is over-scrubbing. Multi-word names are also found in running text;
//     one-word names ("Target", "Shell") only confirm a value already detected as a Business Name.
//   - any company in the base confirms a Business Name (higher confidence).
//   - a public figure only adds a note to a Person Name ("also a public figure"): many private people
//     share famous names, so it never changes the label.
//   - a popular website's homepage is not a URL/Link; any longer path still is.
// Without the files (not built) every lookup returns null and nothing changes.
(function (g) {
  'use strict';
  const P = g.PIIRA;

  const WELL_KNOWN = 25;        // Wikipedia languages for a "well-known" company
  const WELL_KNOWN_SINGLE = 40; // ... for a one-word name
  const POPULAR_RANK = 100000;  // top sites whose homepage is public (the whole downloaded list)

  let companies = new Map(); // key -> {name, links, qid}
  let people = new Map();
  let domains = new Map();   // domain -> rank
  let meta = null;
  let version = '';

  /** "Infosys limited" -> "infosys", "Larsen and Toubro Ltd." -> "larsen & toubro". */
  function key(text) {
    let t = String(text || '').toLowerCase().normalize('NFKC').replace(/[’']/g, "'").replace(/\s+/g, ' ').trim()
      .replace(/[.,;:]+$/, '');
    for (let i = 0; i < 3; i++) {
      const u = t.replace(/\s+(?:pvt\.?\s*ltd|private\s+limited|ltd|limited|inc|incorporated|llp|llc|corp|corporation|plc|co|group|technologies|s\.?a\.?|ag|gmbh)\.?$/i, '').trim();
      if (u === t || !u) break;
      t = u;
    }
    return t.replace(/\s+and\s+/g, ' & ');
  }

  function setData({ companies: c, people: p, domains: d, meta: m }) {
    companies = new Map();
    for (const [name, links, qid] of c || []) {
      const k = key(name);
      // Headings and departments are never companies, also with an ending: "Shipping Company", "Field Services".
      const core = name.replace(/\s+(?:company|companies|services?|corporation|group|ltd|limited|inc)\.?$/i, '');
      if (!k || P.isDocPhrase(name) || P.isDocPhrase(core) || P.isDepartment(name) || P.isDepartment(core)) continue;
      const cur = companies.get(k);
      if (!cur || links > cur.links) companies.set(k, { name, links, qid });
    }
    people = new Map();
    for (const [name, links, qid] of p || []) {
      const k = name.toLowerCase().replace(/\s+/g, ' ').trim();
      const cur = people.get(k);
      if (!cur || links > cur.links) people.set(k, { name, links, qid });
    }
    domains = new Map((d || []).map((x, i) => [x, i + 1]));
    meta = m || null;
    version = meta ? `${meta.built}:${companies.size}:${people.size}:${domains.size}` : '';
    return { companies: companies.size, people: people.size, domains: domains.size };
  }

  /** Load data/kb/ from the extension (or the page folder on test.html). Missing files: an empty base. */
  async function load() {
    const url = (f) => (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL ? chrome.runtime.getURL(`data/kb/${f}`) : `data/kb/${f}`);
    try {
      const get = async (f) => { const r = await fetch(url(f)); if (!r.ok) throw new Error(`${f}: ${r.status}`); return r.json(); };
      const [m, c, p, d] = await Promise.all(['meta.json', 'companies.json', 'people.json', 'domains.json'].map(get));
      return setData({ companies: c, people: p, domains: d, meta: m });
    } catch (err) {
      return null; // not built: nothing changes
    }
  }

  /** The company named `text`, or null. */
  function company(text) {
    return companies.get(key(text)) || null;
  }

  /** A company famous enough to be a public name (not PII), or null. */
  function wellKnownCompany(text) {
    const c = company(text);
    if (!c) return null;
    const single = !/\s/.test(key(text));
    return c.links >= (single ? WELL_KNOWN_SINGLE : WELL_KNOWN) ? c : null;
  }

  /** The public figure with exactly this full name (two words or more), or null. */
  function publicFigure(text) {
    const k = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
    return k.includes(' ') ? people.get(k) || null : null;
  }

  /** Rank of a popular website (1 = most visited) or null; "www." and subdomains of a listed site count. */
  function siteRank(host) {
    let h = String(host || '').toLowerCase().replace(/^www\./, '');
    while (h.includes('.')) {
      if (domains.has(h)) return domains.get(h);
      h = h.slice(h.indexOf('.') + 1);
    }
    return null;
  }
  const popularSite = (host) => { const r = siteRank(host); return r != null && r <= POPULAR_RANK; };

  // Runs of capitalised words (2 to 6): the only places a multi-word company name can be.
  const RUN = /(?<![\p{L}\p{N}])(?:[\p{Lu}][\p{L}\p{N}&'’.-]*)(?:[ ]+(?:(?:and|of|&|the|for|de|du)[ ]+)?[\p{Lu}][\p{L}\p{N}&'’.-]*){1,5}/gu;

  /** Well-known multi-word company names in a text: [{start, end, text, name, category}]. */
  function findCompanies(text) {
    if (!companies.size) return [];
    const out = [];
    RUN.lastIndex = 0;
    let m;
    while ((m = RUN.exec(text)) !== null) {
      // Longest well-known name inside the run, from its first word.
      const words = [...m[0].matchAll(/\S+/g)];
      for (let a = 0; a < words.length - 1; a++) {
        let hit = null;
        for (let b = words.length - 1; b > a; b--) {
          const s = m.index + words[a].index;
          const e = m.index + words[b].index + words[b][0].length;
          const c = wellKnownCompany(text.slice(s, e).replace(/[.,]+$/, ''));
          if (c && /\s/.test(key(c.name))) { hit = { start: s, end: e - (/[.,]$/.test(text.slice(s, e)) ? 1 : 0), c }; break; }
        }
        if (hit) {
          out.push({ start: hit.start, end: hit.end, text: text.slice(hit.start, hit.end), name: hit.c.name,
            category: `well-known company (Wikipedia in ${hit.c.links} languages)` });
          break;
        }
      }
    }
    return out;
  }

  P.kb = {
    load, setData, key, company, wellKnownCompany, publicFigure, siteRank, popularSite, findCompanies,
    get ready() { return companies.size > 0 || domains.size > 0; },
    get meta() { return meta; },
    get version() { return version; },
  };
})(globalThis);
