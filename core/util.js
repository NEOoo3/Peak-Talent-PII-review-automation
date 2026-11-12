// Small helpers shared by the detectors. Pure functions, no DOM access.
(function (g) {
  'use strict';
  const P = g.PIIRA;

  const TRAIL_PUNCT = /[.,;:!?'"\]}>»”’]/;

  const U = {
    round(n) {
      return Math.round(Math.min(0.99, Math.max(0.01, n)) * 100) / 100;
    },

    /** Build a detection object. */
    make(text, start, end, label, confidence, source, rule) {
      return { text: text.slice(start, end), label, start, end, confidence: U.round(confidence), source, rule };
    },

    /**
     * Run a regex (flags must include g and d) over text and turn matches into
     * detections. `score(value, match, start, end)` returns:
     *   - a number (confidence) to accept,
     *   - null/0 to reject,
     *   - {start, end, confidence} to accept with an adjusted span.
     * opts.group: capture group to label (default 0, the whole match)
     * opts.trim:  strip trailing punctuation such as "." or ")"
     */
    collect(text, re, label, score, source, opts) {
      opts = opts || {};
      const group = opts.group || 0;
      const out = [];
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        if (m[0].length === 0) { re.lastIndex++; continue; }
        const idx = m.indices && m.indices[group];
        if (!idx) continue;
        let s = idx[0];
        let e = idx[1];
        if (opts.trim) e = U.trimTrailing(text, s, e);
        if (e <= s) continue;
        let c = typeof score === 'function' ? score(text.slice(s, e), m, s, e) : score;
        if (c && typeof c === 'object') {
          s = c.start; e = c.end; c = c.confidence;
        }
        if (c == null || !(c > 0) || e <= s) continue;
        out.push(U.make(text, s, e, label, c, source, opts.rule || label));
      }
      return out;
    },

    /** Move `end` left past trailing punctuation and unbalanced ")" characters. */
    trimTrailing(text, s, e) {
      while (e > s) {
        const ch = text[e - 1];
        // A "}" that closes a "{" inside the value stays ("…&entry.1={id}").
        if (ch === '}' && U.count(text.slice(s, e), '{') >= U.count(text.slice(s, e), '}')) break;
        if (TRAIL_PUNCT.test(ch)) { e--; continue; }
        if (ch === ')') {
          const seg = text.slice(s, e);
          if (U.count(seg, '(') < U.count(seg, ')')) { e--; continue; }
        }
        break;
      }
      return e;
    },

    count(str, ch) {
      let n = 0;
      for (let i = 0; i < str.length; i++) if (str[i] === ch) n++;
      return n;
    },

    digitCount(s) { return (s.match(/\d/g) || []).length; },
    onlyDigits(s) { return s.replace(/\D/g, ''); },

    /** Luhn checksum used by payment cards. */
    luhn(num) {
      let sum = 0;
      let alt = false;
      for (let i = num.length - 1; i >= 0; i--) {
        let d = num.charCodeAt(i) - 48;
        if (d < 0 || d > 9) return false;
        if (alt) { d *= 2; if (d > 9) d -= 9; }
        sum += d;
        alt = !alt;
      }
      return num.length > 0 && sum % 10 === 0;
    },

    /** ISO 13616 IBAN mod-97 check. */
    ibanValid(s) {
      const v = s.replace(/\s+/g, '').toUpperCase();
      if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v)) return false;
      const r = v.slice(4) + v.slice(0, 4);
      let rem = 0;
      for (const ch of r) {
        const code = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
        for (const d of code) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97;
      }
      return rem === 1;
    },

    /** True if `re` (no g flag) matches within `before` chars before / `after` chars after the span. */
    near(text, s, e, re, before, after) {
      const ctx = text.slice(Math.max(0, s - (before || 0)), Math.min(text.length, e + (after || 0)));
      return re.test(ctx);
    },

    escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); },

    /**
     * Case-insensitive regex source for a phrase, without making the whole
     * regex case-insensitive: "Full Name" -> "[Ff][Uu][Ll][Ll][ \t]+[Nn][Aa][Mm][Ee]".
     */
    ci(phrase) {
      let out = '';
      for (const ch of phrase) {
        if (/[A-Za-z]/.test(ch)) out += `[${ch.toUpperCase()}${ch.toLowerCase()}]`;
        else if (ch === ' ') out += '[ \\t]+';
        else if (ch === "'") out += "['’]?";
        else out += U.escapeRe(ch);
      }
      return out;
    },

    /** Alternation of ci() phrases, longest first so "Full Name" beats "Name". */
    ciAny(phrases) {
      return '(?:' + [...phrases].sort((a, b) => b.length - a.length).map(U.ci).join('|') + ')';
    },

    /**
     * Dummy / reserved domains (RFC 2606/6761) such as example.com, example.org,
     * anything.example, *.test, *.invalid, *.localhost. Addresses on these are
     * placeholder data, not PII, so they are never flagged.
     */
    // Is text[pos] inside a link (a meeting link's "?pwd=abc": the value belongs to the URL)?
    insideUrl(text, pos) {
      let a = pos;
      while (a > 0 && !/\s/.test(text[a - 1]) && pos - a < 2000) a--;
      // the link may follow a key in the same word: "SENTRY_DSN=https://key@…", "url=https://…?pwd=…"
      const before = text.slice(a, pos);
      const at = before.search(/(?:[a-z][a-z0-9+.-]*:\/\/|www\.)/i);
      return at >= 0 && /[?&#;\/]/.test(before.slice(at));
    },

    // Is text[pos] on a line of code ("user.profile.id = 3", "return obj.data.com;")?
    insideCode(text, pos) {
      const ls = text.lastIndexOf('\n', pos - 1) + 1;
      let le = text.indexOf('\n', pos);
      if (le < 0) le = text.length;
      return /[;{}()=]|=>|^\s*(?:import|from|def|class|const|let|var|function|return|if|for|while)\b/.test(text.slice(ls, le));
    },

    isDummyDomain(domain) {
      const d = String(domain || '').toLowerCase().replace(/^www\./, '').replace(/[.\/]+$/, '');
      // also this computer and local networks: localhost, 127.x, 0.0.0.0, ::1, *.local, *.internal
      return /(?:^|\.)example\.[a-z.]{2,}$/.test(d) || /\.(?:example|test|invalid|localhost|local|internal)$/.test(d) ||
        d === 'localhost' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(d) || d === '0.0.0.0' || /^\[?::1\]?$/.test(d);
    },

    /** First index i in a sorted array with key(arr[i]) >= x (arr.length if none). */
    lowerBound(arr, x, key) {
      let lo = 0;
      let hi = arr.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if ((key ? key(arr[mid]) : arr[mid]) < x) lo = mid + 1; else hi = mid;
      }
      return lo;
    },

    /** Short FNV-1a hash of a string, for change detection (not security). */
    hash(str) {
      let h = 0x811c9dc5;
      for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
      return (h >>> 0).toString(36);
    },

    /**
     * Regex for a value right after a field name on the same line:
     * "<keyword> [no./number/nomor/#] [: = -] <value>". `keywords` and `value` are regex
     * sources; the value is capture group 1. Flags: g, i, d.
     */
    keyed(keywords, value) {
      return new RegExp(String.raw`(?<![\w])(?:${keywords})(?![\w])\.?(?:[ \t]*\([^)\n]{1,20}\))?[ \t]*(?:no\.?|number|num|nomor|nr\.?|n[º°o]\.?|#)?[ \t]*[:#=\-–]?[ \t]*(${value})`, 'gid');
    },

    /** Mod-11 check digit with the given weights (Brazilian IDs): 11 - (sum % 11), 10 and 11 become 0. */
    mod11(digits, weights) {
      let sum = 0;
      for (let i = 0; i < weights.length; i++) sum += (digits.charCodeAt(i) - 48) * weights[i];
      const r = 11 - (sum % 11);
      return r >= 10 ? 0 : r;
    },

    /**
     * Is a field's value [s, e) code rather than data? ("password = os.getenv(…)", "user=user",
     * "token: ${API_TOKEN}", "secret-token.txt"). `keyword` is the field name in front of it.
     */
    codeValue(text, s, e, keyword) {
      const v = text.slice(s, e).replace(/^["'`]|["'`,;)]+$/g, '');
      const kw = String(keyword || '').toLowerCase().replace(/[^a-z]/g, '');
      if (!v) return true;
      if (/[()]/.test(v) || text[e] === '(') return true;                                   // a call: os.getenv(…)
      // variables and templates: ${API_TOKEN}, $DB_PASSWORD, %(password)s, {{ password }}, <password>, process.env.X …
      if (/^(?:\$\{|%\(|\{\{|process\.env|os\.environ|os\.getenv|env\[|ENV\[|System\.getenv|config\.|settings\.|self\.|this\.)/.test(v) ||
        /^\$[A-Z_][A-Z0-9_]*$/.test(v) || /^[%!][A-Za-z_][A-Za-z0-9_]*[%!]$/.test(v) || // %APP_SECRET% (Windows), !VAR!
         /^<[^<>]+>?$/.test(v)) return true; // (the ">" may be trimmed already)
      if (/^(?:null|none|nil|undefined|true|false|nan)$/i.test(v)) return true;
      if (kw && v.toLowerCase().replace(/[^a-z]/g, '') === kw) return true;               // user=user, password=password
      if (/^(?:pass(?:word|wd)?|pwd|secret|token|user(?:name)?|login|key|apikey|api_key|changeit)$/i.test(v)) return true;
      if (/\.(?:txt|json|pem|key|env|ya?ml|cfg|conf|ini|properties|crt|cer|p12|pfx|jks|enc|gpg)$/i.test(v)) return true; // a file name
      // obj.field where obj is a settings / request object: "opts.password", "config.token", "creds.user"
      if (/^(?:args|opts|options|config|conf|cfg|settings|params|req|request|creds|credentials|secrets?|env|vars)\.[A-Za-z_$][\w$]*$/i.test(v)) return true;
      return false;
    },

    /** Register a detector. `detect(text)` must return an array of detections. */
    register(label, detect) {
      P.detectors.push({ label, detect });
    },
  };

  P.util = U;
})(globalThis);
