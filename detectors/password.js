// Password (guide: "Passwords, PINs, OTPs, security answers").
// Only the secret value is labeled, not the keyword in front of it.
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const U = P.util;
  const LABEL = 'Password';

  // keyword  (is | : | = | -)  value.  "pin code" / "pincode" are postal codes, so they are excluded.
  // A prefix joined by "_" is allowed: DB_PASSWORD=…, MYSQL_PWD=… (environment files).
  const KEY_VALUE = new RegExp(
    String.raw`(?<![A-Za-z0-9])(pass(?:word|wd|code|phrase)?|pwd|m?pin(?![ \t]*code)|otp|security[ \t]+(?:answer|question[ \t]+answer)|secret[ \t]+answer|memorable[ \t]+(?:word|answer)|mother'?s[ \t]+maiden[ \t]+name)\b["']?[ \t]*(?:is[ \t]*:?|[:=]|-(?=[ \t]))[ \t]*["']?([^\s,;"']{3,})`,
    'gid'
  );

  // "Your OTP is 482913", "verification code for login: 7731"
  const OTP = /\b(?:OTP|one[ \t-]time[ \t]+(?:password|passcode|pin)|verification[ \t]+code|security[ \t]+code)\b[^\d\n]{0,30}?(?<!\d)(\d{4,8})(?!\d)/gid;

  function score(v, m, s, e, text) {
    const kw = m[1].toLowerCase();
    if (U.codeValue(text, s, e, kw)) return null; // "password = os.getenv(…)", "password=password"
    if (U.insideUrl(text, m.index)) return null;   // "…/j/123?pwd=abc": part of the meeting link (URL/Link)
    if (/^(?:m?pin|otp)$/.test(kw)) {
      if (!/^\d{3,8}$/.test(v)) return /\d/.test(v) ? 0.6 : null;
      if (kw.endsWith('pin') && /^[1-9]\d{5}$/.test(v)) {
        // A 6-digit "PIN" next to an address is the postal PIN code; elsewhere it may be either.
        return /\b(?:address|addr|road|rd|street|nagar|layout|colony|city|district|state|flat|floor|cross|sector|village|post|taluk)\b/i
          .test(text.slice(Math.max(0, s - 160), s)) ? null : 0.6;
      }
      return 0.9;
    }
    if (/answer|maiden|memorable/.test(kw)) return 0.85;
    // Looks like a real secret if it has a digit, symbol or mixed case.
    if (/\d|[^A-Za-z]/.test(v) || (/[a-z]/.test(v) && /[A-Z]/.test(v))) return 0.9;
    return 0.6; // "The password is strong" — plain word, let a human decide.
  }

  function detect(text) {
    return [
      // A password may end in "!", "#" or "$": only a sentence's full stop or a closing bracket is trimmed.
      ...U.collect(text, KEY_VALUE, LABEL, (v, m, s, e) => {
        let end = e;
        while (end > s && /[.)\]]/.test(text[end - 1])) end--;
        const c = score(text.slice(s, end), m, s, end, text);
        return c == null ? null : { start: s, end, confidence: c };
      }, 'regex', { group: 2, rule: 'password-key-value' }),
      ...U.collect(text, OTP, LABEL, 0.9, 'regex', { group: 1, rule: 'password-otp' }),
    ];
  }

  U.register(LABEL, detect);
})(globalThis);
