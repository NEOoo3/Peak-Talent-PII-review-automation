// Address (heuristic), for homes and offices alike. Finds address "anchors"
// (Road, Street, Nagar, Layout, "5th Cross", "Sector 21", 6-digit PIN codes…),
// grows the span over address-like words and scores it by its address signals.
// The PIN code is used to find and score the address but is not part of the span:
// postal codes are out of scope (see postal-code.js).
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const U = P.util;
  const LABEL = 'Address';

  // A trailing PIN code ("…, Bengaluru 560001", "… - 560 041", "PIN: 560001") is left out of the span.
  const TRAILING_PIN = /[\s,;:–-]*(?:\(?\s*(?:pin(?:[ \t]*code)?|pincode|postal[ \t]+code)\.?[\s:.-]*)?[1-9]\d{2}[ \t]?\d{3}\)?$/i;

  // Strong keywords anchor an address on their own (when capitalised).
  const STRONG = new Set(('road rd street st nagar layout marg lane ln colony apartment apartments apts apt society chowk avenue ave ' +
    'village vill district dist taluk taluka tehsil mandal enclave residency vihar puram gali mohalla bazaar bazar highway hwy ' +
    'expressway boulevard blvd towers nivas niwas bhavan bhawan heights halli palya peth wadi').split(' '));
  // Weak keywords anchor only next to a number/letter: "5th Cross", "Sector 21", "Block C".
  const WEAK = new Set(('main cross sector block phase stage floor tower circle extension extn wing plot flat house door unit suite ' +
    'ward pocket building bldg').split(' '));
  // Lower-case words allowed inside an address.
  const LOWER_OK = new Set(['near', 'opp', 'opp.', 'opposite', 'behind', 'beside', 'off', 'next']);
  // Words that end an address (field labels, pronouns, sentence words).
  const STOP = new Set(('phone ph tel mob mobile email e-mail fax website web gst gstin pan aadhaar dob date name dear mr mrs ms smt shri ' +
    'sri dr i he she we they you our my his her their the this that please contact call visit regards thanks office home residence ' +
    'address addr located situated residing lives live at in is was and or but from to for with on of by as account card customer ' +
    'policy email username password otp ip vehicle subject note').split(' '));
  // Invoice and form headings end an address too ("…, Ashok Nagar, Delivery Note Mode/Terms of Payment").
  for (const w of ['delivery', 'payment', 'mode', 'terms', 'reference', 'references', 'invoice', 'dated', 'buyer', 'seller',
    'consignee', 'consignor', 'supplier', 'godown', 'warehouse', 'description', 'quantity', 'rate', 'amount', 'total', 'tax',
    'gstin/uin', 'dispatch', 'dispatched', 'destination', 'order', 'bill', 'ship', 'goods', 'services', 'declaration']) STOP.add(w);
  const ABBREV = new Set(['no', 'rd', 'st', 'opp', 'nr', 'apt', 'apts', 'bldg', 'ave', 'dist', 'vill', 'extn', 'h', 'flat', 'ln', 'blvd', 'hwy']);

  const CITIES = ['Bengaluru', 'Bangalore', 'Mumbai', 'Bombay', 'Delhi', 'New Delhi', 'Chennai', 'Madras', 'Kolkata', 'Calcutta',
    'Hyderabad', 'Secunderabad', 'Pune', 'Ahmedabad', 'Jaipur', 'Lucknow', 'Kochi', 'Cochin', 'Mysuru', 'Mysore', 'Noida',
    'Gurugram', 'Gurgaon', 'Ghaziabad', 'Faridabad', 'Chandigarh', 'Indore', 'Bhopal', 'Coimbatore', 'Visakhapatnam', 'Vizag',
    'Nagpur', 'Surat', 'Vadodara', 'Patna', 'Thiruvananthapuram', 'Trivandrum', 'Mangaluru', 'Mangalore', 'Hubli', 'Belagavi',
    'Madurai', 'Vijayawada', 'Bhubaneswar', 'Guwahati', 'Dehradun', 'Ranchi', 'Raipur', 'Nashik', 'Thane', 'Navi Mumbai', 'Goa', 'Panaji'];
  const STATES = ['Karnataka', 'Maharashtra', 'Tamil Nadu', 'Kerala', 'Telangana', 'Andhra Pradesh', 'Gujarat', 'Rajasthan',
    'Uttar Pradesh', 'West Bengal', 'Punjab', 'Haryana', 'Bihar', 'Odisha', 'Orissa', 'Madhya Pradesh', 'Assam', 'Jharkhand',
    'Chhattisgarh', 'Uttarakhand', 'Himachal Pradesh', 'Jammu and Kashmir', 'Tripura', 'Meghalaya', 'Manipur', 'Nagaland', 'Sikkim'];

  // Words of city and state names, for the L2 check (a kept city or state does not leak an address).
  P.addressGeo = new Set(CITIES.concat(STATES).flatMap((n) => n.toLowerCase().split(/\s+/)).filter((w) => w !== 'and'));

  const CITY_RE = new RegExp(`\\b(?:${CITIES.map(U.escapeRe).join('|')})\\b`);
  const STATE_RE = new RegExp(`\\b(?:${STATES.map(U.escapeRe).join('|')})\\b`);
  const PIN_RE = /(?<!\d)[1-9]\d{2}[ ]?\d{3}(?!\d)/;
  const ORDINAL_RE = /\b\d{1,3}(?:st|nd|rd|th)\b/i;
  const HOUSE_RE = /(?:#[ ]?\d+|\b(?:no|flat|h|house|door|plot|unit|shop|apt)\.?[ ]*(?:no\.?)?[ ]*[:#.]?[ ]*\d+[A-Z]?\b|\b\d{1,5}[A-Z]?[ ]*[\/-][ ]*\d{1,5}[A-Z]?\b|^\d{1,5}[A-Z]?\b)/i;
  const PIN_CONTEXT = /\b(?:pin|pincode|pin code|zip|postal|post)\b/i;

  const NUMERIC = /^#?\d{1,6}[A-Za-z]?(?:[\/-]\d{1,6}[A-Za-z]?)*$/;
  const ORDINAL = /^\d{1,3}(?:st|nd|rd|th)$/i;
  const CONNECTOR = /^[-–&\/]$/;

  const MAX_LEFT = 12;
  const MAX_TOKENS = 32;

  function tokenize(text) {
    const toks = [];
    // "Address:R/at" is a field label stuck to its value: split after the colon so the label ends the address.
    // A "word" longer than 200 characters (base64, a hash, minified code) is taken in one step and skipped: it is never
    // part of an address, and the patterns after it would re-read it at every character (the page froze).
    const re = /\S{201,}|[^\s:]{1,200}:(?=[^\s\/])|\S{1,200}?(?=[A-Za-z]{3,}:\S)|\S{1,200}/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const raw = m[0];
      if (raw.length > 200) continue;
      const core = raw.replace(/^[("'“‘]+/, '').replace(/[,;:.)"'”’]+$/, '');
      toks.push({ raw, core, lower: core.toLowerCase(), start: m.index, end: m.index + raw.length });
    }
    return toks;
  }

  const isUpper = (t) => /^[A-Z]/.test(t.core);
  const isNum = (t) => NUMERIC.test(t.core) || ORDINAL.test(t.core);
  const isLetterId = (t) => /^[A-Z]$/.test(t.core) || /^[IVX]{1,4}$/.test(t.core);
  const isAbbrev = (t) => ABBREV.has(t.lower) || /^(?:[A-Z]\.)+$/.test(t.raw.replace(/,$/, ''));
  const endsSentence = (t) => /\.["')]*$/.test(t.raw) && !isAbbrev(t) && !isNum(t) ? true : /[;!?]$/.test(t.raw);

  function admissible(t) {
    if (!t.core) return CONNECTOR.test(t.raw);
    if (/:$/.test(t.raw)) return false;               // "Phone:" — a field label
    if (/@|:\/\/|^www\./i.test(t.core)) return false;  // email / URL
    if (STOP.has(t.lower)) return false;
    if (CONNECTOR.test(t.core)) return true;
    if (isNum(t)) return true;
    if (/^\d+$/.test(t.core)) return false;            // long digit strings (phones, accounts)
    if (STRONG.has(t.lower) || WEAK.has(t.lower)) return true;
    if (LOWER_OK.has(t.lower)) return true;
    return isUpper(t);
  }

  function isAnchor(toks, i, text) {
    const t = toks[i];
    if (!isUpper(t) && !/^\d/.test(t.core)) return false;
    if (STRONG.has(t.lower)) return true;
    if (WEAK.has(t.lower)) {
      const prev = toks[i - 1];
      const next = toks[i + 1];
      return Boolean((prev && (isNum(prev) || ORDINAL.test(prev.core))) || (next && (isNum(next) || isLetterId(next))));
    }
    if (/^[1-9]\d{5}$/.test(t.core) || (/^[1-9]\d{2}$/.test(t.core) && toks[i + 1] && /^\d{3}$/.test(toks[i + 1].core))) {
      const ctx = text.slice(Math.max(0, t.start - 80), t.start);
      return CITY_RE.test(ctx) || STATE_RE.test(ctx) || PIN_CONTEXT.test(ctx) ||
        ctx.split(/\s+/).some((w) => STRONG.has(w.toLowerCase().replace(/[,.]/g, '')));
    }
    return false;
  }

  // May we join tokens a and b (a directly before b)?
  function canJoin(text, a, b) {
    const gap = text.slice(a.end, b.start);
    if (/\n[ \t]*\n/.test(gap)) return false;  // blank line
    if (/[;]$/.test(a.raw)) return false;
    if (endsSentence(a) && isUpper(b)) return false;
    // Only continue across a line break if both lines look like address, or the line in between
    // is a landmark that belongs to the block ("…, NEAR MOTILAL" / "NEHRU SCHOOL" / "Kanpur Nagar …").
    if (gap.includes('\n')) {
      const sa = lineHasSignal(text, a.start);
      const sb = lineHasSignal(text, b.start);
      if (sa && sb) return true;
      if (sa) return isLandmarkLine(text, b.start) && (endsWithLandmarkWord(text, a.start) || lineHasSignal(text, nextLineStart(text, b.start)));
      if (sb) return isLandmarkLine(text, a.start) && lineHasSignal(text, prevLineStart(text, a.start));
      return false;
    }
    return true;
  }

  const lineBounds = (text, pos) => {
    const ls = text.lastIndexOf('\n', pos - 1) + 1;
    let le = text.indexOf('\n', pos);
    if (le === -1) le = text.length;
    return [ls, le];
  };
  const nextLineStart = (text, pos) => { const le = lineBounds(text, pos)[1]; return le < text.length ? le + 1 : -1; };
  const prevLineStart = (text, pos) => { const ls = lineBounds(text, pos)[0]; return ls > 0 ? lineBounds(text, ls - 1)[0] : -1; };

  // A short line of capitalised words with no field label: "NEHRU SCHOOL", "Opp. City Hospital".
  function isLandmarkLine(text, pos) {
    const [ls, le] = lineBounds(text, pos);
    const line = text.slice(ls, le).trim();
    const words = line.split(/\s+/);
    if (!line || words.length > 6 || /[:@]/.test(line) || /\d{5,}/.test(line)) return false;
    return words.every((w) => /^[\p{Lu}(][\p{L}\p{M}.'’,()-]*$/u.test(w) || LOWER_OK.has(w.toLowerCase())) &&
      !words.some((w) => STOP.has(w.toLowerCase().replace(/[.,]+$/, '')));
  }
  const endsWithLandmarkWord = (text, pos) => {
    const [ls, le] = lineBounds(text, pos);
    const words = text.slice(ls, le).trim().toLowerCase().split(/\s+/);
    return words.slice(-3).some((w) => LOWER_OK.has(w.replace(/[.,]+$/, '')));
  };

  function lineHasSignal(text, pos) {
    if (pos < 0) return false;
    const ls = text.lastIndexOf('\n', pos - 1) + 1;
    let le = text.indexOf('\n', pos);
    if (le === -1) le = text.length;
    return signals(text.slice(ls, le)).count > 0;
  }

  function signals(span) {
    const words = span.split(/[\s,]+/).map((w) => w.toLowerCase().replace(/[.,;:]+$/, ''));
    const s = {
      key: words.some((w) => STRONG.has(w)) || /\b\d+(?:st|nd|rd|th)?[ ]+(?:main|cross|sector|block|phase|stage|floor)\b|\b(?:sector|block|phase|stage|floor|tower|wing|plot|flat)[ ]+(?:\d+|[A-Z])\b/i.test(span),
      house: HOUSE_RE.test(span),
      ordinal: ORDINAL_RE.test(span),
      pin: PIN_RE.test(span),
      city: CITY_RE.test(span),
      state: STATE_RE.test(span),
    };
    s.count = Object.values(s).filter(Boolean).length;
    // Several street / locality words ("St. Marks Rd, Shanthala Nagar, Ashok Nagar") are strong evidence on their own.
    s.strongWords = words.filter((w) => STRONG.has(w)).length;
    return s;
  }

  function score(sig, tokenCount) {
    let c;
    if (sig.count >= 3) c = 0.9;
    else if (sig.count === 2) c = sig.pin && (sig.key || sig.city) ? 0.85 : 0.75;
    else if (sig.key && sig.strongWords >= 2 && tokenCount >= 4) c = 0.75;
    else c = sig.key && tokenCount >= 3 ? 0.6 : 0.5;
    return c;
  }

  function detect(text) {
    const toks = tokenize(text);
    const spans = [];
    for (let i = 0; i < toks.length; i++) {
      if (!isAnchor(toks, i, text)) continue;
      let a = i;
      let b = i;
      while (a > 0 && i - a < MAX_LEFT && b - a < MAX_TOKENS && admissible(toks[a - 1]) && canJoin(text, toks[a - 1], toks[a])) a--;
      while (b < toks.length - 1 && b - a < MAX_TOKENS && admissible(toks[b + 1]) && canJoin(text, toks[b], toks[b + 1])) b++;
      // Do not start/end on connectors or lower-case words.
      while (a < b && (!toks[a].core || CONNECTOR.test(toks[a].core) || /^[a-z]/.test(toks[a].core))) a++;
      while (b > a && (!toks[b].core || CONNECTOR.test(toks[b].core) || LOWER_OK.has(toks[b].lower))) b--;
      spans.push([a, b]);
      i = Math.max(i, b);
    }

    // Merge spans that touch or overlap.
    const merged = [];
    for (const [a, b] of spans.sort((x, y) => x[0] - y[0])) {
      const last = merged[merged.length - 1];
      if (last && a <= last[1] + 1 && (a <= last[1] || canJoin(text, toks[last[1]], toks[a]))) last[1] = Math.max(last[1], b);
      else merged.push([a, b]);
    }

    const out = [];
    for (const [a, b] of merged) {
      let start = toks[a].start + (toks[a].raw.length - toks[a].raw.replace(/^[("'“‘]+/, '').length);
      let end = toks[b].end;
      const last = toks[b];
      if (isAbbrev(last) && /\.$/.test(last.raw)) {
        end = last.start + last.raw.replace(/[,;:)"'”’]+$/, '').length;
      } else {
        while (end > start && /[,;:.\-–\/&)"'”’]/.test(text[end - 1])) end--;
      }
      if (end - start < 4) continue;
      const sig = signals(text.slice(start, end));
      const tokenCount = b - a + 1;
      if (sig.count === 0 || (sig.count === 1 && !(sig.key && tokenCount >= 2))) continue;
      const c = score(sig, tokenCount);
      // A trailing PIN code is left out of an inline address, but it is the last line of a multi-line
      // address block (shipping label, letter) and stays in it (P.SETTINGS.addressIncludesPin).
      const pin = text.slice(start, end).match(TRAILING_PIN);
      const block = text.slice(start, end).includes('\n');
      if (pin && !(block && P.SETTINGS.addressIncludesPin)) end -= pin[0].length;
      // Bank statements: "ATM WDL MG ROAD BANGALORE,ATM778812,5000.00" — the address is "MG ROAD BANGALORE".
      const junk = /,[ \t]*(?:[A-Z]{2,}\d{3,}|\d+\.\d{2}\b|\d{6,}\b(?![ \t]*[A-Za-z]))/.exec(text.slice(start, end));
      if (junk) end = start + junk.index;
      const lead = /^(?:(?:ATM|WDL|POS|NEFT|IMPS|UPI|TRF|ECS|NACH|CASH)\b[ \t\/-]*)+/.exec(text.slice(start, end));
      if (lead) start += lead[0].length;
      if (end - start < 4) continue;
      // Postal codes alone are not an address: the street, building or locality must be there.
      const words = (text.slice(start, end).match(/\p{L}{3,}/gu) || []).filter((w) => !/^(?:pin|pincode|cep|zip|code|postal|kode|pos)$/i.test(w));
      if (!words.length) continue;
      out.push(U.make(text, start, end, LABEL, c, 'heuristic', `address-${sig.count}-signals`));
    }
    return out;
  }

  U.register(LABEL, detect);
})(globalThis);
