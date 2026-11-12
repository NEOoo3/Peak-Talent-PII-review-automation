// Indian PAN, 10 characters (ABCDE1234F). The 4th letter is the holder type:
// P = an individual -> Indian PAN (Individual); C, H, F, A, T, B, L, J, G -> Indian PAN (Business).
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const U = P.util;
  const PAN = /\b([A-Z]{3})([A-Z])([A-Z])(\d{4})([A-Z])\b/gd;
  const PAN_KW = /\b(?:pan|permanent[ \t]+account[ \t]+number|income[ \t]+tax)\b/i;
  // 4th letter: C company, H HUF, F firm, A AOP, T trust, B BOI, L local authority, J AJP, G government.
  const BUSINESS = /[CHFATBLJG]/;
  U.register('Indian PAN (Individual)', (text) => {
    const out = U.collect(text, PAN, 'Indian PAN (Individual)', (v, m, s, e) => {
      if (m[2] !== 'P' && !BUSINESS.test(m[2])) return U.near(text, s, e, PAN_KW, 30, 0) ? 0.7 : null; // not a real holder type
      return U.near(text, s, e, PAN_KW, 30, 0) ? 0.95 : 0.88;
    }, 'regex', { rule: 'pan' });
    for (const d of out) if (BUSINESS.test(d.text[3])) { d.label = 'Indian PAN (Business)'; d.rule = 'pan-business'; }
    return out;
  });
})(globalThis);
