// Runs every detector over a text and resolves overlapping detections.
// Detectors report a specific type ("Indian GSTIN") in `label`; once overlaps are
// resolved, each detection gets its site label ("Credentials") in `label` and
// keeps the type in `type`.
(function (g) {
  'use strict';
  const P = g.PIIRA;

  function sameSpanDedupe(list) {
    const best = new Map();
    for (const d of list) {
      const key = `${d.start}:${d.end}:${d.label}`;
      const cur = best.get(key);
      if (!cur || d.confidence > cur.confidence) best.set(key, d);
    }
    return [...best.values()];
  }

  const isPostal = (type) => type === 'Address';

  // Address spans are grown heuristically, so they may swallow a name or a
  // company at their edges ("Ravi Kumar, 12 MG Road"). Trim those edges off
  // instead of letting the longer Address win and hide the other detection.
  function trimAddressEdges(list, text) {
    const others = list.filter((d) => !isPostal(d.label) && d.confidence >= P.REVIEW_THRESHOLD)
      .sort((a, b) => a.start - b.start);
    // Longest "other" detection, so a window search can't miss one that starts earlier.
    const maxLen = others.reduce((m, o) => Math.max(m, o.end - o.start), 0);
    const out = [];
    for (const d of list) {
      if (!isPostal(d.label)) { out.push(d); continue; }
      let s = d.start;
      let e = d.end;
      const from = P.util.lowerBound(others, d.start - maxLen, (o) => o.start);
      const to = P.util.lowerBound(others, d.end, (o) => o.start);
      const near = others.slice(from, to);
      for (let pass = 0; pass < 4; pass++) {
        let changed = false;
        for (const o of near) {
          if (o.end <= s || o.start >= e) continue;
          if (o.start <= s && o.end < e) { s = o.end; changed = true; }
          else if (o.end >= e && o.start > s) { e = o.start; changed = true; }
        }
        while (s < e && /[\s,;:\-–]/.test(text[s])) s++;
        while (e > s && /[\s,;:\-–]/.test(text[e - 1])) e--;
        if (!changed) break;
      }
      if (e - s < 4) continue;
      out.push(s === d.start && e === d.end ? d : { ...d, start: s, end: e, text: text.slice(s, e) });
    }
    return out;
  }

  // Greedy: a value placed by its field first (CSV column, JSON key, "Key:" label), then
  // longer match, then more specific label, then confidence.
  function resolveOverlaps(list) {
    const sorted = list.slice().sort((a, b) =>
      (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) ||
      (b.end - b.start) - (a.end - a.start) ||
      P.specificityRank(a.label) - P.specificityRank(b.label) ||
      b.confidence - a.confidence ||
      a.start - b.start
    );
    // `kept` stays sorted by start and non-overlapping, so one binary search per
    // candidate is enough to test for an overlap.
    const kept = [];
    for (const d of sorted) {
      const i = P.util.lowerBound(kept, d.start, (k) => k.start);
      if (i < kept.length && kept[i].start < d.end) continue;      // next kept starts inside d
      if (i > 0 && kept[i - 1].end > d.start) continue;            // previous kept runs into d
      kept.splice(i, 0, d);
    }
    return kept;
  }

  function runDetector(det, text, all, ctx) {
    try {
      for (const d of det.detect(text, ctx)) {
        if (d && d.end > d.start && d.start >= 0 && d.end <= text.length) all.push(d);
      }
    } catch (err) {
      console.warn('[PII Review Automation] detector failed:', det.label, err);
    }
  }

  /**
   * Field structure decides what is never PII and where values end:
   *  - a span running into the next field's label is cut before it ("49 KL 4247 Status" + ":")
   *  - header cells, JSON keys and field labels are never PII, nor are values of a Department /
   *    Status / record id field, nor department names anywhere ("Field Services")
   *  - a value whose field or file name says which type it is (within the same family) gets that type:
   *    "Bank Account Number" in a us_bank_number file is a US Bank Account/Routing Number.
   */
  // A field or file type replaces a detected type of the same family only when it says more
  // ("US Passport Number" over "Passport Number"), never less ("Contact Number" over "Indian Mobile Number").
  const refines = (type, current) => type !== current && P.piiKeys.sameFamily(type, current) &&
    P.specificityRank(type) < P.specificityRank(current);

  function applyContext(list, text, ctx) {
    const structure = ctx && ctx.structure;
    const hint = ctx && ctx.hint;
    const K = P.piiKeys;
    const out = [];
    for (let d of list) {
      if (!d.pinned) {
        let e = d.end;
        // Cut at the first field label inside the span ("DL 49 KL 4247 Status: closed").
        const tail = /[ \t]+[\p{L}][\p{L}\p{M}\p{N}_'’.-]*[ \t]*[:=](?!\/\/)/u.exec(text.slice(d.start, Math.min(text.length, d.end + 2)));
        // "Kiran Kumar: yes" (a chat speaker): a name word before ":" is part of the name, not a field label.
        const tailWord = tail && tail[0].trim().replace(/[ \t]*[:=]$/, '');
        const nameWord = tail && d.label === 'Person Name' && P.names && P.names.kind(tailWord);
        if (tail && !nameWord && d.start + tail.index < d.end && d.start + tail.index > d.start) e = d.start + tail.index;
        // A link keeps its query ("…/j/123?pwd=abc"): "pwd=" there is not a field label of the document.
        const isLink = /^(?:URL\/Link|Connection URL with Credentials)$/.test(d.label);
        const key = isLink ? null : P.structured.keyInside(structure, d.start, e);
        if (key) e = key.start;
        while (e > d.start && /[\s,;:=]/.test(text[e - 1])) e--;
        if (e <= d.start) continue;
        if (e !== d.end) d = { ...d, end: e, text: text.slice(d.start, e) };
        if (structure) {
          if (!isLink && P.structured.inKey(structure, d.start, d.end)) continue;
          const cell = P.structured.cellAt(structure, d.start, d.end);
          if (cell && cell.nonPii) continue;
          if (cell && cell.type && refines(cell.type, d.label) && K.fitsType(cell.type, d.text)) {
            d = { ...d, label: cell.type, confidence: Math.max(d.confidence, 0.9), rule: `${d.rule}+field` };
          }
        }
        if ((d.label === 'Business Name' || d.label === 'Person Name') && P.isDepartment(d.text)) continue;
      }
      if (hint && refines(hint.type, d.label) && K.fitsType(hint.type, d.text)) {
        d = { ...d, label: hint.type, confidence: Math.max(d.confidence, 0.9), rule: `${d.rule}+file-name` };
      }
      out.push(d);
    }
    return out;
  }

  // A value placed by its field keeps the more specific type a detector found for the very same
  // text ("Phone:" says Contact Number; the number itself is an Indian Mobile Number).
  function refinePinned(list) {
    const bySpan = new Map();
    for (const d of list) if (!d.pinned) bySpan.set(`${d.start}:${d.end}`, (bySpan.get(`${d.start}:${d.end}`) || []).concat(d));
    return list.map((d) => {
      if (!d.pinned) return d;
      const better = (bySpan.get(`${d.start}:${d.end}`) || []).filter((o) => P.piiKeys.sameFamily(o.label, d.label) &&
        P.specificityRank(o.label) < P.specificityRank(d.label)).sort((a, b) => P.specificityRank(a.label) - P.specificityRank(b.label))[0];
      return better ? { ...d, label: better.label, rule: `${d.rule}+${better.rule}` } : d;
    });
  }

  // Offline knowledge base: a company in it confirms a Business Name; a public figure's name gets a note.
  function withKnowledge(list) {
    if (!P.kb || !P.kb.ready) return list;
    return list.map((d) => {
      if (d.label === 'Business Name') {
        const c = P.kb.company(d.text);
        if (c) return { ...d, confidence: Math.max(d.confidence, 0.85), kb: { company: c.name, links: c.links } };
      }
      if (d.label === 'Person Name') {
        const f = P.kb.publicFigure(d.text);
        if (f) return { ...d, kb: { publicFigure: f.name, links: f.links } };
      }
      return d;
    });
  }

  // An empty value written as a word ("name": null, "owner": "None", "N/A"): never a name, username or other PII.
  const EMPTY_VALUE = /^(?:null|none|nil|undefined|nan|n\/?a|n\.a\.?|unknown|not available|not applicable|empty|blank|tbd|tba|true|false|-+)$/i;
  const isEmptyValue = (t) => EMPTY_VALUE.test(String(t || '').trim().replace(/^["'`]|["'`]$/g, ''));

  // Never PII, whatever found it (the team's issue sheet and PII dataset sheet, 2026-10-25): a scheme on its own ("https"), an image or file
  // name read as an e-mail ("Started@2x.png"), a masked number that does not show at least its last four digits
  // ("98xxx xxx45"), a department or common word as a company or person ("Marketing"), and the number of an "…_id"
  // field read as a credential or account ("record_id": "107288512").
  const FILE_EXT = /\.(?:png|jpe?g|gif|svg|webp|bmp|ico|tiff?|pdf|m?js|tsx?|jsx|css|scss|json|html?|xml|txt|md|csv|zip|mp4|mov|mp3|wav|woff2?|ttf|eot|map)$/i;
  // Words that are never a person's name on their own: software and common words read as names (team feedback).
  const NOT_NAME_WORDS = new Set(('edge chrome firefox safari opera brave windows android linux ubuntu debian macos ios ' +
    'microsoft google apple person people type list test tests testing sample example demo default unknown none ' +
    'admin user users guest owner self node react angular vue python java kotlin swift ruby rust docker kubernetes').split(' '));
  // Sample and dummy values (team review 2026-10-25): never labeled, whatever found them.
  const DUMMY_PEOPLE = new Set(['john doe', 'jane doe', 'john q public', 'test user', 'demo user', 'sample user', 'foo bar',
    'lorem ipsum', 'dummy user', 'first last', 'firstname lastname', 'your name', 'full name']);
  const DUMMY_VALUES = new Set(['abcde1234f', 'aaaaa0000a', '22aaaaa0000a1z5', '123456789012', '1234 5678 9012',
    '4111111111111111', '4242424242424242', '5555555555554444', '4000056655665556', '5105105105105100', '378282246310005',
    '371449635398431', '6011111111111117', '3530111333300000', '123 main street', '123 main st', '1 infinite loop']);
  // Placeholder secrets: "your_api_key", "changeme", "<your-secret>", "${TOKEN}", "{{secret}}".
  const PLACEHOLDER_SECRET = /^(?:[Yy]our[_-]?[A-Za-z_-]*|YOUR[_-]?[A-Z_-]*|[Mm]y[_-]?(?:[Aa]pi[_-]?)?(?:[Kk]ey|[Ss]ecret|[Tt]oken|[Pp]assword)|[Cc]hange[_-]?[Mm]e|CHANGEME|[Pp]laceholder|[Dd]ummy|[Ee]xample|[Ss]ample|[Ss]ecret|[Pp]assword|[Pp]asswd|[Tt]oken|[Aa]pi[_-]?[Kk]ey|x{3,}|X{3,}|\*{3,}|<[^>]*>|\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$[A-Z_][A-Z0-9_]*|\{\{[^}]*\}\}|%[A-Z_]+%)$/;
  // Keys that hold an ID, not a secret ("file_key", "node_id", a Figma style "key"): their values are not Credentials
  // unless a vendor format says otherwise (sk_live_…, AIza… keep their own type).
  const ID_KEY = /(?<![\w-])["']?(?:key|file[_-]?key|node[_-]?(?:id|key)|sort[_-]?key|idempotency[_-]?key|object[_-]?key|page[_-]?key|style[_-]?key|component[_-]?(?:set[_-]?)?(?:id|key)|cache[_-]?key|partition[_-]?key|row[_-]?key)["']?[ \t]*[:=][ \t]*["']?$/i;
  // Countries are never a person or a company ("Greenland", "Solomon Islands").
  const COUNTRIES = new Set((
    'afghanistan|albania|algeria|andorra|angola|argentina|armenia|australia|austria|azerbaijan|bahamas|' +
    'bahrain|bangladesh|barbados|belarus|belgium|belize|benin|bhutan|bolivia|botswana|brazil|brunei|' +
    'bulgaria|burundi|cambodia|cameroon|canada|chad|chile|china|colombia|comoros|congo|croatia|cuba|' +
    'cyprus|czechia|denmark|djibouti|dominica|ecuador|egypt|eritrea|estonia|eswatini|ethiopia|fiji|' +
    'finland|france|gabon|gambia|georgia|germany|ghana|greece|greenland|grenada|guatemala|guinea|guyana|' +
    'haiti|honduras|hungary|iceland|india|indonesia|iran|iraq|ireland|israel|italy|jamaica|japan|jordan|' +
    'kazakhstan|kenya|kiribati|kuwait|kyrgyzstan|laos|latvia|lebanon|lesotho|liberia|libya|liechtenstein|' +
    'lithuania|luxembourg|madagascar|malawi|malaysia|maldives|mali|malta|mauritania|mauritius|mexico|' +
    'micronesia|moldova|monaco|mongolia|montenegro|montserrat|morocco|mozambique|myanmar|namibia|nauru|' +
    'nepal|netherlands|nicaragua|niger|nigeria|norway|oman|pakistan|palau|panama|paraguay|peru|' +
    'philippines|poland|portugal|qatar|romania|russia|rwanda|samoa|senegal|serbia|seychelles|singapore|' +
    'slovakia|slovenia|somalia|spain|sudan|suriname|sweden|switzerland|syria|taiwan|tajikistan|tanzania|' +
    'thailand|togo|tokelau|tonga|tunisia|turkey|turkmenistan|tuvalu|uganda|ukraine|uruguay|uzbekistan|' +
    'vanuatu|venezuela|vietnam|yemen|zambia|zimbabwe|solomon islands|marshall islands|cook islands|' +
    'cayman islands|faroe islands|new zealand|south africa|south korea|north korea|sri lanka|' +
    'saudi arabia|united states|united states of america|usa|united kingdom|uk|united arab emirates|uae|' +
    'costa rica|el salvador|sierra leone|papua new guinea|east timor|timor-leste|ivory coast|' +
    'burkina faso|central african republic|dominican republic|czech republic|puerto rico|hong kong|' +
    'vatican city|san marino|cape verde|equatorial guinea|guinea-bissau|north macedonia|' +
    'bosnia and herzegovina|trinidad and tobago|antigua and barbuda|saint lucia|south sudan'
  ).split('|'));
  function neverPii(d, text) {
    const t = String(d.text || '').trim();
    const low = t.toLowerCase();
    if (DUMMY_VALUES.has(low) || DUMMY_VALUES.has(low.replace(/[\s-]/g, ''))) return true;
    if ((d.label === 'Person Name' || d.label === 'Person Username') && DUMMY_PEOPLE.has(low.replace(/\s+/g, ' '))) return true;
    if (d.label === 'Person Username' && /^(?:test|tester|demo|sample|dummy|example|foo|bar)$/.test(low)) return true;
    if ((d.label === 'Person Name' || d.label === 'Business Name') && COUNTRIES.has(low.replace(/\s+/g, ' '))) return true;
    // Rules per 13-label family, so they hold on the Golden site too ("Generic API Key", "Indian Mobile Number").
    const base = P.baseLabel ? P.baseLabel(d.label) : d.label;
    if (base === 'Credentials' || /Password|API Key|Token/.test(d.type || '')) {
      if (PLACEHOLDER_SECRET.test(t.replace(/^["']|["']$/g, ''))) return true;
      if (/^(?:Generic API Key|Password)$/.test(d.type || '') && ID_KEY.test(text.slice(Math.max(0, d.start - 40), d.start))) return true;
    }
    if (d.label === 'Person Name') {
      // Part of a hyphenated word ("B. Self-hosted"), or only words that are not names ("Microsoft Edge", "Type List").
      if (/^-\p{Ll}/u.test(text.slice(d.end, d.end + 2))) return true;
      const words = t.toLowerCase().split(/[\s.]+/).filter((w) => w.length > 1);
      if (words.length && words.every((w) => NOT_NAME_WORDS.has(w))) return true;
    }
    if (/^(?:https?|s?ftp|www)$/i.test(t)) return true;
    // Team rules from the PII dataset sheet (2026-10-25): a private network address is out of scope (internal_ip: No),
    // and a service sender names no person (noreply@, notifications@ … "They are not PII", decision 12).
    if (d.label === 'Email Address' && /^(?:no-?reply|do-?not-?reply|notifications?|alerts?|mailer-daemon|postmaster|bounces?)(?:[+._-][^@]*)?@/i.test(t)) return true;
    if (d.label === 'Email Address' && (FILE_EXT.test(t) || /@\d+(?:\.\d+)?x\./i.test(t))) return true;
    if (base === 'Contact Number' && /[Xx*•]/.test(t) && !/\d{4}$/.test(t.replace(/[\s().-]/g, ''))) return true;
    if ((d.label === 'Business Name' || d.label === 'Person Name') && P.isDepartment && P.isDepartment(t)) return true;
    // A number under an "…_id" key is a record ID ("user_id": "12345"), except an account ID ("_account_id",
    // "accountId", AWS "…OwnerId": "905418074703") or a transaction ID, which the guide counts as credentials.
    if ((base === 'Credentials' || base === 'Account Number') && /^\d+$/.test(t)) {
      const before = text.slice(Math.max(0, d.start - 40), d.start);
      if (/(?:^|[^a-z])(?:[a-z]+[_-])?id["']?\s*[:=]\s*["']?$/i.test(before) &&
        !/(?:account|owner|transaction|txn|tx)[ _-]?id["']?\s*[:=]\s*["']?$/i.test(before)) return true;
    }
    return false;
  }

  // A private network address (10.x, 127.x, 192.168.x, 172.16-31.x, 169.254.x) is out of scope (PII dataset sheet,
  // internal_ip: No): nothing is reported at it, nor any piece of it ("24.8.17" of 10.24.8.17 read as a date).
  const PRIVATE_IP = /(?<![\d.])(?:10\.\d{1,3}|127\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01])|169\.254)\.\d{1,3}\.\d{1,3}(?![\d.]|\.\d)/g;
  function privateIps(text) {
    const out = [];
    if (!/(?:10|127|192|172|169)\./.test(text)) return out;
    PRIVATE_IP.lastIndex = 0;
    let m;
    while ((m = PRIVATE_IP.exec(text)) !== null) out.push([m.index, m.index + m[0].length]);
    return out;
  }

  function finish(all, text, ctx) {
    // A private IP address is PII in every project (PII/BII Annotation Guide, "IP/MAC Address"; the Golden list's
    // internal_ip). Only pieces of one ("24.8.17" of 10.24.8.17 read as a date) are dropped.
    const privates = privateIps(text);
    all = P.tableContext.apply(text, all).filter((d) => !isEmptyValue(d.text) &&
      !(P.isDummyPhone && P.labelOfType(d.label) === 'Contact Number' && P.isDummyPhone(d.text)));
    const reported = withKnowledge(refinePinned(applyContext(all.filter((d) => P.typeReported(d.label)), text, ctx)));
    return linkHandles(resolveOverlaps(trimAddressEdges(sameSpanDedupe(reported), text))
      .map((d) => ({ ...d, type: d.label, label: P.labelOfType(d.label) })), text)
      .filter((d) => !neverPii(d, text) &&
        !(P.baseLabel(d.label) !== 'IP Address' && privates.some(([a, b]) => d.start >= a && d.end <= b)))
      // The project's own rules (Code Base: "Dev" is not a person, dev servers are not PII).
      .filter((d) => !ctx || !ctx.project || P.projects.keep(d, ctx.project));
  }

  /**
   * A person's handle built from their name ("bharat.gangaiah", "bharat_gangaiah", "bharat-gangaiah",
   * "gangaiah.bharat") is a Person Username wherever it appears, once the name itself is in the document
   * ("Bharat Gangaiah"). A handle the model called a Person Name becomes a Person Username; e-mail
   * addresses and other fixed-shape values keep their label. Works on finished lists (site labels).
   */
  const HANDLE_LABELS = new Set(['Person Name', 'Person Username', 'GitHub Username']);
  function linkHandles(list, text) {
    const names = new Map();
    for (const d of list) {
      if (d.label !== 'Person Name') continue;
      const w = d.text.toLowerCase().split(/\s+/).filter((x) => /^\p{L}{2,}$/u.test(x));
      if (w.length >= 2 && w.length <= 3) names.set(w.join(' '), w);
    }
    if (!names.size) return list;
    const out = list.slice();
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const w of names.values()) {
      const forms = [w, [w[w.length - 1], ...w.slice(0, -1)]].map((x) => x.map(esc).join('[._-]'));
      const re = new RegExp(`(?<![\\p{L}\\p{N}._-])(?:${forms.join('|')})(?![\\p{L}\\p{N}_-]|\\.[\\p{L}\\p{N}]|@)`, 'giu');
      let m;
      while ((m = re.exec(text)) !== null) {
        const s = m.index;
        const e = s + m[0].length;
        const hits = out.filter((d) => d.start < e && d.end > s);
        if (hits.some((d) => !HANDLE_LABELS.has(d.label))) continue;   // inside an e-mail, URL…
        const handle = { text: m[0], label: 'Person Username', type: 'Person Username', start: s, end: e,
          confidence: 0.85, source: 'heuristic', rule: 'name-handle' };
        for (const d of hits) out.splice(out.indexOf(d), 1);
        out.push(hits.length === 1 && hits[0].start === s && hits[0].end === e && hits[0].label === 'Person Username'
          ? hits[0] : handle);
      }
    }
    return out.sort((a, b) => a.start - b.start);
  }

  /** Detector context: the task's file-name hint and the document's field structure. */
  const context = (text, opts) => ({ hint: (opts && opts.hint) || null, project: (opts && opts.project) || null, structure: P.structured.parse(text) });

  /**
   * The out-of-scope type (date, postal code…) found at text[start, end), or null. A little
   * text around it is read too, so "DOB: 14/08/1989" is a Date of Birth, not just a Date.
   * Used to explain why a label on the right is a possible overscrub.
   */
  function outOfScopeType(text, start, end) {
    if (!text || !(end > start)) return null;
    const from = Math.max(0, start - 50);
    const win = text.slice(from, Math.min(text.length, end + 20));
    const s = start - from;
    const e = end - from;
    let best = null;
    let bestOverlap = 0;
    for (const det of P.detectors) {
      const all = [];
      runDetector(det, win, all);
      for (const d of all) {
        const t = P.typeInfo(d.label);
        if (!t || t.scope !== 'out') continue;
        const o = Math.min(d.end, e) - Math.max(d.start, s);
        if (o > bestOverlap) { best = d; bestOverlap = o; }
      }
    }
    return best && bestOverlap * 2 >= text.slice(start, end).trim().length ? best.label : null;
  }

  /** @param opts {hint} — hint: P.fileHint.parse(task file name), or null */
  function run(text, opts) {
    if (!text) return [];
    const ctx = context(text, opts);
    const all = [];
    for (const det of P.detectors) runDetector(det, text, all, ctx);
    return finish(all, text, ctx);
  }

  const yieldNow = () => (g.scheduler && typeof g.scheduler.yield === 'function'
    ? g.scheduler.yield() : new Promise((r) => setTimeout(r, 0)));

  /**
   * Same as run(), but gives the page a chance to respond between detectors so
   * very large documents never freeze the tab. Returns null if `isCurrent()`
   * becomes false (a newer analysis started).
   */
  async function runAsync(text, isCurrent, opts) {
    if (!text) return [];
    const ctx = context(text, opts);
    const all = [];
    let t0 = Date.now();
    for (const det of P.detectors) {
      if (Date.now() - t0 > 25) {
        await yieldNow();
        if (isCurrent && !isCurrent()) return null;
        t0 = Date.now();
      }
      runDetector(det, text, all, ctx);
    }
    await yieldNow();
    if (isCurrent && !isCurrent()) return null;
    return finish(all, text, ctx);
  }

  P.engine = { run, runAsync, yieldNow, outOfScopeType, linkHandles, isEmptyValue, neverPii, privateIps, COUNTRIES };
})(globalThis);
