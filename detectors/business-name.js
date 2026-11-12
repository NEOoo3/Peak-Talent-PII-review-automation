// Business Name (heuristic): capitalised words ending in a company suffix
// (Pvt Ltd, Ltd, Inc, LLC, Corp, Technologies…), "Company: …" fields and
// "Bank of …" names. Names on the business names list (Google, Infosys, HDFC Bank…) are excluded.
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const U = P.util;
  const LABEL = 'Business Name';

  // A record id ("R000005") is never a word of a company name. Words are joined by spaces only:
  // a tab separates table cells ("Support<TAB>Us Bank Number").
  // A country or region in brackets is part of the name: "Valueleaf Services (India) Pvt. Ltd.".
  // A word is capped at 40 characters: an open run re-read the rest of a long hyphenated string from every capital.
  const WORD = "(?:(?![A-Z]{1,3}\\d{3,}(?![A-Za-z]))\\p{Lu}[\\p{L}\\p{M}\\p{N}&'’.\\-]{0,40}(?![\\p{L}\\p{M}\\p{N}&'’.\\-])|&|\\(\\p{Lu}[\\p{L}]+(?:[ ]\\p{Lu}[\\p{L}]+)?\\))";
  const JOIN = '(?:[ ]+(?:and|of|&|the|for))?[ ]+';
  const LEGAL = '(?:Pvt\\.?[ \\t]*Ltd|Private[ \\t]+Limited|Pte\\.?[ \\t]+Ltd|Ltd|Limited|Inc|Incorporated|LLC|L\\.L\\.C|LLP|Corp|Corporation|PLC|GmbH|Co)';
  const GENERIC = '(?:Technologies|Technology|Tech|Solutions|Industries|Enterprises|Group|Services|Systems|Consultants|Consulting|Labs|' +
    'Software|Infotech|Infosystems|Associates|Traders|Trading|Exports|Imports|Foundation|Trust|Hospitals?|Clinic|Bank|Insurance|Motors|' +
    'Pharma|Pharmaceuticals|Logistics|Holdings|Ventures|Capital|Finance|Agency|Studios?|Media|Networks|Electronics|Textiles|' +
    'Constructions?|Builders|Developers|Realty|Foods|Retail|Mart|Stores|Company|Electricals|Agencies|Jewellers|Jewelers|Medicals|' +
    'Hardware|Impex|Garments|Fashions|Caterers|Travels|Pharmacy|Bakery|Sweets|Restaurant|Hotels?)';

  const STRONG_ORG = /^(?:Hospitals?|Technologies|Industries|Enterprises|Pharmaceuticals|Logistics|Infotech|Infosystems|Laboratories|Labs|Motors|Textiles|Foods|Constructions?|Builders|Developers|Realty|Ventures|Holdings|Studios|Electronics|Exports|Traders)$/;
  const SUFFIXED = new RegExp(
    `(?<![\\p{L}\\p{N}&])(?:${WORD}${JOIN}){1,5}(${LEGAL}|${GENERIC})\\.?(?![\\p{L}])`,
    'gdu'
  );
  const LEGAL_RE = new RegExp(`(?<![A-Za-z])${LEGAL}\\.?(?![A-Za-z])`);
  const SUFFIX_WORD = new RegExp(`^(?:${LEGAL}|${GENERIC}|Pvt|Private|Pte)\\.?$`);

  const FIELD = new RegExp(
    `\\b${U.ciAny(['Company', 'Company Name', 'Employer', 'Organisation', 'Organization', 'Firm', 'Business', 'Business Name',
      'Merchant', 'Vendor', 'Supplier', 'Client Company', 'Insurer', 'Bank', 'Bank Name'])}[ \\t]*[:\\-–][ \\t]*(${WORD}(?:${JOIN}${WORD}){0,5})`,
    'gdu'
  );
  const BANK_OF = /\b(?:(?:State|Central|Union|Reserve|Punjab[ \t]+National)[ \t]+)?Bank[ \t]+of[ \t]+\p{Lu}[\p{L}\p{M}]+(?:[ \t]+\p{Lu}[\p{L}\p{M}]+)?/gdu;

  // "Information Technology", "Financial Services": a field of work, not a company,
  // when one of these words is all there is before the generic suffix.
  const FIELD_OF_WORK = new Set(('information computer computing financial medical health healthcare food data digital software ' +
    'business mechanical electrical electronic civil chemical biomedical industrial engineering education legal banking ' +
    'customer it cloud web mobile network security').split(' '));

  // Software products ending in a company-like word: tools on a CV, not employers.
  const PRODUCTS = /^(?:Visual|Android|Xcode|SQL|Power|Google|Microsoft|Adobe|Unity|Creative|Data|Cloud|Developer|Expo|R)\s+(?:Studio|Server|Labs?|Services|Systems|Technologies|Tech|Media)$/i;

  // Capitalised words that start a sentence rather than a company name.
  const LEAD_STOP = new Set(('the a an at in on for from with by to and of our your this that these those dear mr mrs ms dr hi hello ' +
    'employer company client vendor via per as is was we i he she they it my his her their contact call visit please').split(' '));

  const POSSESSIVE = /(?:^|[^A-Za-z])(?:our|your|their|my|his|her|its)[ \t]+$/i;

  function trimLead(text, s, e) {
    const re = /\S+/g;
    const seg = text.slice(s, e);
    let m;
    let offset = 0;
    while ((m = re.exec(seg)) !== null) {
      if (!LEAD_STOP.has(m[0].toLowerCase())) { offset = m.index; break; }
      offset = m.index + m[0].length;
    }
    return s + offset;
  }

  // "Us Bank Number:", "Logistics Account No" — a field label, not a company.
  const FIELD_LABEL_AFTER = /^[ \t]*(?:(?:Number|No\.?|Num|Account|Acct|Code|ID|Id|Details|Name|Branch|Address|Card|Key|Token|Type|Status)\b|[:=])/;

  // "Field Services", "People Ops", "Customer Support Services": a department, not a company.
  function isDepartmentName(words) {
    const t = words.join(' ');
    if (P.isDepartment(t)) return true;
    const core = words.filter((w) => !SUFFIX_WORD.test(w));
    return core.length > 0 && P.isDepartment(core.join(' ')) && !LEGAL_RE.test(t);
  }

  // Domains of e-mail addresses and links in the document ("accounts@sunrisetextiles.com" -> "sunrisetextiles").
  function documentDomains(text) {
    const set = new Set();
    for (const m of text.matchAll(/(?:@|\/\/|www\.)([a-z0-9-]+)\.[a-z.]{2,10}\b/gi)) set.add(m[1].toLowerCase().replace(/-/g, ''));
    return set;
  }

  // Two companies joined by "and" ("HDFC Bank and ICICI Bank"): two names, split after the first one's ending word.
  const PAIR = new RegExp(`^(.*?\\b(?:${LEGAL}|${GENERIC})\\.?)[ \t]+(?:and|&)[ \t]+(\\p{Lu}.*)$`, 'u');
  function splitPair(text, d) {
    const m = PAIR.exec(d.text);
    if (!m || !/\s/.test(m[1]) && !SUFFIX_WORD.test(m[1])) return [d];
    const second = d.start + d.text.length - m[2].length;
    return [{ ...d, end: d.start + m[1].length, text: m[1] }, { ...d, start: second, text: m[2] }];
  }

  const BANKS = (P.INDIAN_BANKS || []).length ? new RegExp(`(?<![\\p{L}\\p{N}&@./-])(?:${(P.INDIAN_BANKS || [])
    .slice().sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[ \\t]+')).join('|')})` +
    `(?:[ \\t]+(?:Ltd|Limited))?(?![\\p{L}\\p{N}&@-])`, 'gdu') : null;

  function detect(text) {
    const out = [];
    const domains = documentDomains(text);
    // "Sunrise Textiles" and sunrisetextiles.com in the same document: the company's own name.
    const matchesDomain = (words) => {
      const joined = words.join('').toLowerCase().replace(/[^a-z0-9]/g, '');
      const core = words.filter((w) => !LEGAL_RE.test(w)).join('').toLowerCase().replace(/[^a-z0-9]/g, '');
      return domains.has(joined) || domains.has(core);
    };
    // Indian banks (data/indian-banks.js): always a Business Name, with or without "Ltd" / "Limited".
    if (BANKS) out.push(...U.collect(text, BANKS, LABEL, 0.92, 'list', { rule: 'indian-bank' }).map((d) => ({ ...d, pinned: true })));
    out.push(...U.collect(text, SUFFIXED, LABEL, (v, m, s, e) => {
      if (FIELD_LABEL_AFTER.test(text.slice(e, e + 12))) return null;
      const start = trimLead(text, s, e);
      // "Our Premium Support Services", "your Cloud Solutions": a description, not a company's name.
      if (POSSESSIVE.test(text.slice(Math.max(0, s - 30), start))) return null;
      const kept = text.slice(start, e).split(/[ \t]+/).filter(Boolean);
      if (!kept.length || kept[0].startsWith('(')) return null;
      const nonSuffix = kept.filter((w) => !SUFFIX_WORD.test(w) && !/^(?:and|of|&|the|for)$/.test(w));
      if (!nonSuffix.length || isDepartmentName(kept)) return null;
      const legal = LEGAL_RE.test(text.slice(start, e));
      // "Goods and Services", "Shipping Company", "Billing Company": a heading of the document, not a company.
      // The words in front of the ending decide ("Bluepeak Logistics" is a company).
      if (!legal && (P.isDocPhrase(kept.join(' ')) || P.isDocPhrase(nonSuffix.join(' ')))) return null;
      if (!legal && nonSuffix.length === 1 && FIELD_OF_WORK.has(nonSuffix[0].toLowerCase())) return null;
      if (!legal && PRODUCTS.test(text.slice(start, e).trim())) return null;
      let c;
      if (legal) c = 0.9;
      else if (matchesDomain(kept)) c = 0.85;
      // "Cloudnine Hospitals", "Brightway Technologies": a made-up name before a strong organisation word.
      else if (nonSuffix.length === 1 && STRONG_ORG.test(kept[kept.length - 1]) && !(P.names && P.names.kind(nonSuffix[0])) &&
        !P.DOC_WORDS.has(nonSuffix[0].toLowerCase()) && nonSuffix[0].length >= 5) c = 0.72;
      // "Gupta Electricals", "Sharma Traders": a family name and a trade — the usual name of an Indian shop.
      else if (nonSuffix.length === 1 && P.names && ['last', 'both'].includes(P.names.kind(nonSuffix[0]))) c = 0.75;
      else c = nonSuffix.length >= 2 ? 0.75 : 0.65;
      // "Inc." keeps its dot mid-sentence, but a sentence-ending "." is dropped.
      let end = e;
      if (text[end - 1] === '.' && !/^[ \t]*[a-z,;)]/.test(text.slice(end))) end--;
      return { start, end, confidence: c };
    }, 'heuristic', { rule: 'business-suffix' }).flatMap((d) => splitPair(text, d)));

    out.push(...U.collect(text, FIELD, LABEL, (v, m, s, e) => {
      // A field value ends at its legal suffix ("… Pvt Ltd") or at the end of the sentence.
      const legal = new RegExp(`(?:^|[ \\t])${LEGAL}\\.?(?=[ \\t]|$)`).exec(v);
      const sentence = /\.[ \t]+(?=[A-Z])/.exec(v);
      let cut = v.length;
      if (legal) cut = Math.min(cut, legal.index + legal[0].length);
      if (sentence) cut = Math.min(cut, sentence.index);
      let val = v.slice(0, cut);
      const trailing = /(?:[ \t]+(?:and|of|&|the|for))+$/.exec(val);
      if (trailing) val = val.slice(0, -trailing[0].length);
      val = val.replace(/\.$/, (dot) => (/(?:Ltd|Inc|Co|Corp)\.$/.test(val) ? dot : ''));
      if (P.isDepartment(val) || P.isDocPhrase(val)) return null;
      return { start: s, end: s + val.length, confidence: 0.8 };
    }, 'heuristic', { group: 1, trim: true, rule: 'business-field' }));

    out.push(...U.collect(text, BANK_OF, LABEL, 0.85, 'heuristic', { rule: 'business-bank-of' }));
    return withoutKnownNames(text, out);
  }

  // Project rule: names on the business names list (data/business-names.json) are
  // not Business Name PII. Handles a short match inside a known name, and
  // "Google Inc. and Acme Traders" (only Acme Traders is kept).
  function withoutKnownNames(text, list) {
    const isKnown = (t) => Boolean(P.knownNames.lookup(t));
    const knownSpans = P.knownNames.findIn(text);
    const known = [];
    const kept = [];
    for (const d of list) {
      const parts = [];
      const re = /\s+(?:and|&)\s+/g;
      let last = 0;
      let m;
      while ((m = re.exec(d.text)) !== null) { parts.push([last, m.index]); last = m.index + m[0].length; }
      parts.push([last, d.text.length]);
      const knownParts = parts.filter(([a, b]) => isKnown(d.text.slice(a, b)));
      if (isKnown(d.text) || knownParts.length === parts.length) { known.push(d); continue; }
      if (!knownParts.length) { kept.push(d); continue; }
      known.push(...knownParts.map(([a, b]) => ({ start: d.start + a, end: d.start + b })));
      for (const [a, b] of parts) {
        if (knownParts.some((k) => k[0] === a)) continue;
        if (/\s/.test(d.text.slice(a, b)) || /(?:Ltd|Limited|Inc|LLC|LLP|Corp)/.test(d.text.slice(a, b))) {
          kept.push(U.make(text, d.start + a, d.start + b, LABEL, d.confidence, d.source, d.rule));
        }
      }
    }
    // Also drop a detection that sits inside a known name found in the text ("State Bank" in "State Bank of India").
    const blocked = known.concat(knownSpans);
    return kept.filter((d) => !blocked.some((k) => d.start >= k.start && d.end <= k.end) && !known.some((k) => d.start < k.end && d.end > k.start))
      .concat(clientNames(text));
  }

  // The client's own names: always a Business Name, never a Person Name. From three places —
  //   - data/client-business-names.js (the team's list),
  //   - the task title (P.TASK_CLIENT_NAMES, set per task: "DK1__TeamKiraana__website" -> Kiraana),
  //   - the document's own e-mail domains ("ravi@vogo.in" -> vogo), unless a free-mail or public provider.
  // Any spelling of a name counts (Kirana = Kiraana = Khirana = Kirrana: doubled letters and an "h" after a consonant are
  // optional), and so does a name joined to code by "_", "-" or a capital (TeamKirana, kirana-api, kirana_app). Not in a
  // path ("git@github.com:kirana/storefront", "@kirana/cli"), a link or e-mail, or a command in `code quotes`.
  // Pinned, so a "name" field ({"name": "Kirana"}) does not turn it into a Person Name.
  const VOWEL = /[aeiou]/;
  /** "Khirana", "Kiraana", "Kirrana" -> "kirana": the spelling every variant shares. */
  const canonical = (name) => String(name).toLowerCase().replace(/([bcdfgjklmnpqrstvwxz])h/g, '$1').replace(/(.)\1+/g, '$1');
  /** A pattern for every spelling of a name, letter case included ("kirana" -> [kK]{1,2}[hH]?[iI]{1,2}…). */
  function spellings(name) {
    const letters = [...canonical(name)];
    return letters.map((c, i) => {
      if (!/[a-z]/.test(c)) return c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const cls = `[${c}${c.toUpperCase()}]{1,2}`;
      // An "h" may follow a consonant inside the name (Khirana), never after its last letter ("trove" in "trovehub").
      return VOWEL.test(c) || i === letters.length - 1 ? cls : `${cls}[hH]?`;
    }).join('');
  }
  const PUBLIC_MAIL = /^(?:gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|me|mac|aol|proton|protonmail|rediffmail|rediff|zoho|zohomail|gmx|mail|yandex|tutanota|fastmail|example|test|github|gitlab|google|microsoft|amazon|amazonaws|slack|atlassian|notion|users)$/i;
  /** Company names the document's own e-mail addresses give away ("vaibhav@vogo.in" -> vogo). */
  function mailDomainNames(text) {
    const out = new Set();
    for (const m of text.matchAll(/[A-Za-z0-9._%+-]@([a-z0-9-]+)\.(?:[a-z]{2,10})(?:\.[a-z]{2})?\b/gi)) {
      const stem = m[1].toLowerCase();
      if (stem.length < 4 || /\d/.test(stem) || stem.includes('-') || PUBLIC_MAIL.test(stem)) continue;
      if (P.knownNames && P.knownNames.lookup(stem)) continue; // a public brand (Google, Razorpay) stays unlabeled
      out.add(stem);
    }
    return [...out];
  }
  // The document naming its own company, besides e-mail domains:
  //   - a full link's site:   "https://www.acme.com/careers" -> acme (core/psl.js finds the name before the suffix)
  //   - an app package id:    "com.acme.academy", "in.vogo.rider" -> acme, vogo
  //   - a copyright line:     "© 2024 Zentrix Labs", "Copyright (c) Vogo Automotive" -> Zentrix Labs, Vogo Automotive
  // Public sites and brands (business names list, knowledge base) are left out: they are not PII.
  const PACKAGE_ID = /\b(?:com|in|io|org|net|co|ai|app)\.([a-z][a-z0-9]{3,})\.[a-z][a-z0-9_.]*\b/g;
  const COPYRIGHT = /(?:©|\(c\)|copyright)\s*(?:\(c\)\s*)?(?:\d{4}(?:\s*[-–]\s*\d{2,4})?\s*,?\s*)?([A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*){0,3})/gi;
  const isPublic = (name) => (P.knownNames && P.knownNames.lookup(name)) || (P.kb && P.kb.popularSite && P.kb.popularSite(name + '.com'));
  function selfNames(text) {
    const out = new Set();
    if (P.psl && /:\/\//.test(text)) {
      for (const m of text.matchAll(/\bhttps?:\/\/[^\s"'<>`]+/gi)) {
        const host = P.psl.hostOf(m[0]);
        const p = host && P.psl.parse(host);
        if (!p || !p.known || !p.registrable || !p.icann) continue;
        const stem = p.registrable.slice(0, p.registrable.length - p.suffix.length - 1);
        if (stem.length >= 4 && !/\d|-/.test(stem) && !PUBLIC_MAIL.test(stem) && !isPublic(stem)) out.add(stem);
      }
    }
    for (const m of text.matchAll(PACKAGE_ID)) if (!PUBLIC_MAIL.test(m[1]) && !isPublic(m[1])) out.add(m[1]);
    for (const m of text.matchAll(COPYRIGHT)) {
      const name = m[1].replace(/\s+(?:all|rights|reserved)\b.*$/i, '').replace(/[.,]+$/, '').trim();
      if (name.length >= 4 && !/^(?:all|the|by|this|notice)$/i.test(name) && !isPublic(name)) out.add(name);
    }
    return [...out];
  }

  /**
   * {listed: names from the team's list, the task title and what the reviewer or the team taught (pinned),
   *  learned: names the document itself gives away (e-mail domains, links, package ids, copyright lines)}.
   */
  function clientList(text) {
    const seen = new Set();
    const keep = (n) => { const k = canonical(n); if (!n || k.length < 3 || seen.has(k)) return false; seen.add(k); return true; };
    const listed = (P.CLIENT_BUSINESS_NAMES || []).concat(P.TASK_CLIENT_NAMES || [], P.LEARNED_BUSINESS_NAMES || []).filter(keep);
    return { listed, learned: mailDomainNames(text).concat(selfNames(text)).filter(keep) };
  }

  function clientNames(text) {
    const { listed, learned } = clientList(text);
    return namesIn(text, listed, true).concat(namesIn(text, learned, false), hostClientNames(text, listed));
  }

  // Listed names are pinned (they win over a longer guess); names learned from e-mail domains are not, so a fuller
  // name ("BrightPath Consulting LLP") or a link ("www.brightpath.in") still wins.
  function namesIn(text, names, pinned) {
    if (!names.length) return [];
    const alts = names.map(spellings).sort((a, b) => b.length - a.length);
    const re = new RegExp(`(?:(?<![\\p{L}\\p{N}@./:\\\\])|(?<=\\p{Ll})(?=\\p{Lu}))(?:${alts.join('|')})(?![\\p{Ll}\\p{N}@/\\\\]|\\.[\\p{L}\\p{N}])`, 'gu');
    const out = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      const ls = text.lastIndexOf('\n', m.index - 1) + 1;
      if (((text.slice(ls, m.index).match(/`/g) || []).length % 2) === 1) continue;
      // Not inside an e-mail address or a link (they are labeled whole).
      if (/[@]\S*$|:\/\/\S*$/.test(text.slice(Math.max(ls, m.index - 200), m.index))) continue;
      const before = text[m.index - 1] || ' ';
      const d = U.make(text, m.index, m.index + m[0].length, LABEL, pinned ? 0.95 : 0.9, 'list', pinned ? 'client-business-name' : 'client-in-document');
      d.pinned = pinned;
      d.partial = /[\p{L}\p{N}_-]/u.test(before) || /[\p{L}\p{N}_-]/u.test(text[m.index + m[0].length] || ' ');
      out.push(d);
    }
    return out;
  }

  // A client's name at the start of a part of a bare host name ("troveworks" in "deltorasyn-portal.troveworks.com"): the
  // name on its own (the team's issue sheet). Not in links with a scheme, e-mails or paths.
  const BARE_HOST = /(?<![\w@\/:.-])[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)+\.[A-Za-z]{2,24}(?![\w@\/-]|\.\w|:\/\/)/g;
  function hostClientNames(text, names) {
    if (!names.length || !text.includes('.')) return [];
    const starts = names.map((n) => new RegExp(`^(?:${spellings(n)})`));
    const out = [];
    let m;
    BARE_HOST.lastIndex = 0;
    while ((m = BARE_HOST.exec(text)) !== null) {
      const host = m[0];
      for (const part of host.matchAll(/[A-Za-z0-9]+/g)) {
        let hit = null;
        for (const re of starts) { const x = re.exec(part[0]); if (x && (!hit || x[0].length > hit.length)) hit = x[0]; }
        if (!hit) continue;
        const s = m.index + part.index;
        const d = U.make(text, s, s + hit.length, LABEL, 0.93, 'list', 'client-business-name-host');
        d.pinned = true;
        d.partial = part[0].length !== hit.length;
        out.push(d);
      }
    }
    return out;
  }

  P.clientNames = { canonical, spellings };
  U.register(LABEL, detect);
})(globalThis);
