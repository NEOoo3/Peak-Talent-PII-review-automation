// Links in the two documents: finding them, telling a real link from a file name, and checking the right
// side's replacements. A host is a link when its ending is on the Public Suffix List (core/psl.js):
// "acme.com" and "example.co.in" are links, "app.tsx" and "config.json" are file names. Offline only:
// a suffix list proves the ending exists, never that the site does (looking it up would leak the domain).
(function (g) {
  'use strict';
  const P = g.PIIRA;

  // A scheme or "www." alone, or a lone suffix (".com", "in"): not a value. A short word is a suffix
  // only when the Public Suffix List has it, so names like "Meera" or "Sam" still count as values.
  const SCHEME_RE = /^(?:https?:?\/*|ftp:?\/*|www\.?)$/i;
  const SUFFIX_RE = /^\.?([a-z]{2,6})$/i;
  const suffixSeen = new Map();   // word -> listed suffix? (a task asks about the same words thousands of times)
  const PROTOCOL_OR_TLD_RE = {
    test(s) {
      s = String(s || '');
      if (SCHEME_RE.test(s)) return true;
      const m = SUFFIX_RE.exec(s);
      if (!m) return false;
      if (!P.psl) return true;
      const w = m[1].toLowerCase();
      let known = suffixSeen.get(w);
      if (known === undefined) {
        known = P.psl.knownSuffix(w);
        if (suffixSeen.size > 5000) suffixSeen.clear();
        suffixSeen.set(w, known);
      }
      return known;
    },
  };
  // A link with a scheme or www., or a bare host (its ending is checked against the suffix list).
  const URL_EXTRACT_RE = /\b(?:https?:\/\/|ftp:\/\/|www\.)[^\s"'<>`]+|\b[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z][a-z0-9-]{1,62}(?:\/[^\s"'<>`]*)?/gi;
  // A piece of text that looks like part of a link (used to spot partly scrubbed links).
  const URL_LIKE_PIECE_RE = /(?:https?:\/\/|ftp:\/\/|www\.|\.(?:com|net|org|io|in|co|edu|gov|ai|dev|app|me|uk|us|xyz|info|biz|tech|online|site|cloud|link|i)\b)/i;
  // Made-up words the scrubbing tool writes into links ("…ironcorecas…") and "[REDACTED": a scrubbed link.
  const OVERSCRUB_TOKEN_RE = /(?:ironcorecas|synengale|kepunedelt|jadifyced|solerawren|sarolyarona|delttechcas|wreniaopt|kepixver|arcifypol|astovaecl|synenvex|deltenver|ionexhale|helgennex|kryentvolt|rhoivnevune|ralosona|stixmag|\[REDACTED)/i;

  // Trailing punctuation off; a "}" closing a "{" in the link stays ("…?entry.1={id}").
  const cleanUrlStr = (u) => {
    let s = String(u || '').replace(/[.,;!?)"'\]}>\\]+$/, '');
    const extra = String(u || '').slice(s.length);
    for (let i = 0, open = (s.match(/\{/g) || []).length - (s.match(/\}/g) || []).length; i < extra.length && extra[i] === '}' && open > 0; i++, open--) s += '}';
    return s.trim();
  };

  /** A well-formed link: its host ends in a real public suffix with a name in front of it (acme.com, not .com). */
  function validUrl(u) {
    const host = P.psl.hostOf(String(u || ''));
    const p = host && P.psl.parse(host);
    return Boolean(p && p.known && p.registrable);
  }

  /** Every link in the text: [{start, end, clean}]. */
  function findUrlSpans(text) {
    if (!text) return [];
    const spans = [];
    URL_EXTRACT_RE.lastIndex = 0;
    let m;
    while ((m = URL_EXTRACT_RE.exec(text)) !== null) {
      const clean = cleanUrlStr(m[0]);
      if (!clean || PROTOCOL_OR_TLD_RE.test(clean)) continue;
      // Without a scheme or www., only a host on the suffix list counts (not file names such as app.tsx).
      if (!/^(?:https?:\/\/|ftp:\/\/|www\.)/i.test(clean) && !validUrl(clean)) continue;
      spans.push({ start: m.index, end: m.index + clean.length, clean });
    }
    return spans;
  }

  /** A notice listing malformed or partly scrubbed links on either side, or [] when there are none. */
  function validateOffline(leftText, rightText, detections) {
    const issues = [];
    const seen = new Set();

    const checkUrl = (rawUrl, side) => {
      const clean = cleanUrlStr(rawUrl);
      const key = `${side}:${clean}`;
      if (!clean || PROTOCOL_OR_TLD_RE.test(clean) || seen.has(key)) return;
      seen.add(key);

      const reasons = [];
      if (/\s/.test(clean)) reasons.push('contains whitespace');
      if (OVERSCRUB_TOKEN_RE.test(clean)) reasons.push('partially scrubbed URL');
      if (!validUrl(clean) && reasons.length === 0) reasons.push('the host does not end in a real domain suffix');

      if (reasons.length > 0) {
        issues.push(`[${side}] "${clean.slice(0, 65)}${clean.length > 65 ? '…' : ''}" — ${reasons.join(', ')}`);
      }
    };

    (detections || []).forEach((d) => {
      if (d.label === 'URL/Link' && leftText) checkUrl(leftText.slice(d.start, d.end), 'Left');
    });
    for (const s of findUrlSpans(leftText)) checkUrl(s.clean, 'Left');
    for (const s of findUrlSpans(rightText)) checkUrl(s.clean, 'Right');

    if (!issues.length) return [];
    return [{
      key: 'url-validation',
      title: `URL Format Validator: ${issues.length} potential issue${issues.length > 1 ? 's' : ''} found (offline check).`,
      details: issues.slice(0, 12),
    }];
  }

  P.urlRules = { PROTOCOL_OR_TLD_RE, URL_LIKE_PIECE_RE, OVERSCRUB_TOKEN_RE, cleanUrlStr, validUrl, findUrlSpans, validateOffline };
})(globalThis);
