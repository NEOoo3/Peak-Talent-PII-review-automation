// Public Suffix List lookups: split a host into suffix / registrable domain /
// subdomain, offline. The list itself lives in data/psl.js (P.PSL_DATA), which
// must be loaded before the first call. Pure functions, no DOM access.
//
// Why: "is this the same site?" and "which part of this URL is the person's
// own name?" both need to know that example.co.in is one site while co.in is
// a registry, and that user.github.io belongs to the user, not to GitHub.
(function (g) {
  'use strict';
  const P = g.PIIRA || (g.PIIRA = {});

  // Built on first use: the list is ~10,000 rules and most pages never need it.
  // Each Map goes rule -> true when the rule is in the ICANN section, false when
  // it is in the private section (github.io, blogspot.com …).
  let rules = null;     // normal rules:      'co.in'        -> true
  let wildcards = null; // "*.x" rules, by x: 'ck'           -> true  (from '*.ck')
  let exceptions = null;// "!x" rules, by x:  'www.ck'       -> true  (from '!www.ck')

  function ensure() {
    if (rules) return;
    const data = P.PSL_DATA || {};
    rules = new Map(); wildcards = new Map(); exceptions = new Map();
    const add = (list, icann) => {
      for (const raw of String(list || '').split(',')) {
        const rule = raw.trim();
        if (!rule) continue;
        if (rule.startsWith('!')) exceptions.set(rule.slice(1), icann);
        else if (rule.startsWith('*.')) wildcards.set(rule.slice(2), icann);
        else rules.set(rule, icann);
      }
    };
    add(data.icann, true);
    add(data.private, false);
  }

  // ---- punycode -------------------------------------------------------------
  // The list keeps internationalised rules in Unicode (中国, 香港 …) but hosts
  // read from URLs come back as punycode (xn--fiqs8s). Decode labels before the
  // lookup so both spellings match. RFC 3492 decoder; a label that is not valid
  // punycode is left as it is.
  const BASE = 36, TMIN = 1, TMAX = 26, SKEW = 38, DAMP = 700;

  function adapt(delta, points, first) {
    delta = first ? Math.floor(delta / DAMP) : delta >> 1;
    delta += Math.floor(delta / points);
    let k = 0;
    while (delta > ((BASE - TMIN) * TMAX) >> 1) { delta = Math.floor(delta / (BASE - TMIN)); k += BASE; }
    return k + Math.floor(((BASE - TMIN + 1) * delta) / (delta + SKEW));
  }

  function decodeLabel(label) {
    if (!label.startsWith('xn--')) return label;
    const s = label.slice(4);
    const dash = s.lastIndexOf('-');
    const out = [];
    for (let j = 0; j < Math.max(dash, 0); j++) {
      const c = s.charCodeAt(j);
      if (c >= 0x80) return label;
      out.push(c);
    }
    let n = 128, i = 0, bias = 72;
    for (let idx = dash > 0 ? dash + 1 : 0; idx < s.length;) {
      const oldi = i;
      let w = 1;
      for (let k = BASE; ; k += BASE) {
        if (idx >= s.length) return label;
        const c = s.charCodeAt(idx++);
        const digit = c >= 48 && c <= 57 ? c - 22 : c >= 97 && c <= 122 ? c - 97 : -1;
        if (digit < 0) return label;
        i += digit * w;
        const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
        if (digit < t) break;
        w *= BASE - t;
        if (w > 0x7fffffff) return label;
      }
      bias = adapt(i - oldi, out.length + 1, oldi === 0);
      n += Math.floor(i / (out.length + 1));
      i %= out.length + 1;
      if (n > 0x10ffff) return label;
      out.splice(i++, 0, n);
    }
    try { return String.fromCodePoint(...out).toLowerCase(); } catch (_) { return label; }
  }

  // ---- host clean-up ---------------------------------------------------------
  const BAD_CHARS = /[\s\/\\?#@%<>"'`|^{}[\]]/;

  /** Lower-case, drop ":port" and a trailing dot. null for IPs and broken hosts. */
  function normalise(host) {
    if (typeof host !== 'string') return null;
    let h = host.trim().toLowerCase();
    if (!h || h.startsWith('[')) return null;          // [::1] — IPv6 literal
    const colon = h.indexOf(':');
    if (colon !== -1) {
      if (h.indexOf(':', colon + 1) !== -1) return null; // bare IPv6 (::1, fe80::…)
      if (!/^\d{0,5}$/.test(h.slice(colon + 1))) return null;
      h = h.slice(0, colon);
    }
    if (h.endsWith('.')) h = h.slice(0, -1);
    if (!h || h.length > 253 || BAD_CHARS.test(h)) return null;
    const labels = h.split('.');
    for (const l of labels) if (!l || l.length > 63) return null;
    // A numeric last label is never a real TLD, so this is an IPv4 address in
    // one of its spellings (1.2.3.4, 127.1, 0x7f.1 …).
    if (/^(\d+|0x[0-9a-f]*)$/.test(labels[labels.length - 1])) return null;
    return { host: h, labels };
  }

  // ---- the PSL algorithm -----------------------------------------------------
  // https://publicsuffix.org/list/ "Formal algorithm":
  //  1. an exception rule that matches wins; the suffix is that rule minus its
  //     left-most label (!www.ck → suffix ck);
  //  2. otherwise the matching rule with the most labels wins, a wildcard rule
  //     "*.x" matching any one label in place of "*";
  //  3. no rule at all → the implicit "*" rule: the last label is the suffix.
  // Returns { size: labels in the suffix, icann, known }.
  function match(labels) {
    ensure();
    const u = labels.map(decodeLabel);
    const n = u.length;
    for (let i = 0; i < n; i++) {
      const cand = u.slice(i).join('.');
      if (exceptions.has(cand)) return { size: n - i - 1, icann: exceptions.get(cand), known: true };
    }
    for (let i = 0; i < n; i++) {
      const cand = u.slice(i).join('.');
      if (rules.has(cand)) return { size: n - i, icann: rules.get(cand), known: true };
      if (i + 1 < n) {
        const parent = u.slice(i + 1).join('.');
        if (wildcards.has(parent)) return { size: n - i, icann: wildcards.get(parent), known: true };
      }
    }
    return { size: 1, icann: false, known: false };
  }

  /**
   * Split a host into its parts.
   *   parse('a.b.example.co.in') →
   *     { host: 'a.b.example.co.in', suffix: 'co.in', registrable: 'example.co.in',
   *       subdomain: 'a.b', icann: true, known: true }
   * registrable is null (and subdomain null) when the host is itself a suffix;
   * subdomain is '' when the host is exactly the registrable domain. The parts
   * keep the host's own spelling (punycode stays punycode). null for IP
   * addresses and malformed hosts.
   */
  function parse(host) {
    const norm = normalise(host);
    if (!norm) return null;
    const { labels } = norm;
    const m = match(labels);
    const size = Math.max(1, Math.min(m.size, labels.length));
    const suffix = labels.slice(-size).join('.');
    const hasReg = labels.length > size;
    return {
      host: norm.host,
      suffix,
      registrable: hasReg ? labels.slice(-(size + 1)).join('.') : null,
      subdomain: hasReg ? labels.slice(0, labels.length - size - 1).join('.') : null,
      icann: m.icann,
      known: m.known,
    };
  }

  /** True when the host ends in a listed rule, not just the implicit "*". */
  function knownSuffix(host) {
    const r = parse(host);
    return !!(r && r.known);
  }

  /**
   * The host part of a URL-ish string, with or without a scheme:
   *   'https://a.b.co.in/x' → 'a.b.co.in', 'www.x.com' → 'www.x.com',
   *   'user:pw@host:8080/p' → 'host'. null when there is no host.
   * IPv6 literals come back with their brackets; parse() rejects them.
   */
  function hostOf(url) {
    if (typeof url !== 'string') return null;
    let s = url.trim();
    const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(s);
    if (scheme) s = s.slice(scheme[0].length);
    else if (s.startsWith('//')) s = s.slice(2);
    s = s.split(/[\/?#\\]/, 1)[0];
    const at = s.lastIndexOf('@');
    if (at !== -1) s = s.slice(at + 1);
    let h;
    if (s.startsWith('[')) {
      const close = s.indexOf(']');
      if (close === -1) return null;
      h = s.slice(0, close + 1);
    } else {
      h = s.split(':', 1)[0];
    }
    h = h.toLowerCase().replace(/\.$/, '');
    return h && !/\s/.test(h) ? h : null;
  }

  P.psl = {
    parse,
    knownSuffix,
    hostOf,
    get version() { return (P.PSL_DATA && P.PSL_DATA.version) || null; },
  };
})(globalThis);
