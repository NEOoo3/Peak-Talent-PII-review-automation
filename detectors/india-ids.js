// Indian business and employment IDs (all labeled Credentials):
//   - Indian GSTIN: 15 characters = state code (01-38, 97, 99) + PAN + entity + "Z" + check
//     character (GSTIN checksum). The PAN inside it is not reported separately: the longer GSTIN wins.
//   - Indian TAN: 4 letters, 5 digits, 1 letter (ABCD12345E).
//   - Indian CIN: 21 characters like U12345MH2010PTC123456.
//   - Indian UAN: EPFO Universal Account Number, 12 digits — the same shape as Aadhaar, so
//     only reported next to a UAN / PF keyword.
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const U = P.util;

  const GSTIN = /\b(\d{2})[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/gd;
  const GST_KW = /\b(?:gst(?:in)?|gst[ \t]+(?:no|number|reg)|goods[ \t]+and[ \t]+services[ \t]+tax)\b/i;
  const CODE = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  function gstinValid(v) {
    let sum = 0;
    for (let i = 0; i < 14; i++) {
      const p = CODE.indexOf(v[i]) * (i % 2 ? 2 : 1);
      sum += Math.floor(p / 36) + (p % 36);
    }
    return CODE[(36 - (sum % 36)) % 36] === v[14];
  }
  const validState = (n) => (n >= 1 && n <= 38) || n === 97 || n === 99;

  const TAN = /\b[A-Z]{4}\d{5}[A-Z]\b/gd;
  const TAN_KW = /\b(?:tan|tax[ \t]+deduction[ \t]+(?:and[ \t]+collection[ \t]+)?account(?:[ \t]+number)?)\b/i;

  const CIN = /\b[LU]\d{5}[A-Z]{2}(?:19|20)\d{2}(?:PLC|PTC|GOI|SGC|FTC|GAP|GAT|NPL|OPC|ULL|ULT|FLC)\d{6}\b/gd;

  const UAN = U.keyed(String.raw`uan|universal[ \t]+account[ \t]+number|epf(?:o)?[ \t]+uan|pf[ \t]+uan`, String.raw`\d{4}[ -]?\d{4}[ -]?\d{4}|\d{12}`);

  function detect(text) {
    return [
      ...U.collect(text, GSTIN, 'Indian GSTIN', (v, m, s, e) => {
        if (!validState(+m[1])) return null;
        if (gstinValid(v)) return 0.97;
        return U.near(text, s, e, GST_KW, 30, 0) ? 0.85 : 0.65;
      }, 'regex', { rule: 'gstin' }),
      ...U.collect(text, TAN, 'Indian TAN', (v, m, s, e) => (U.near(text, s, e, TAN_KW, 30, 0) ? 0.95 : 0.65), 'regex', { rule: 'tan' }),
      ...U.collect(text, CIN, 'Indian CIN', 0.95, 'regex', { rule: 'cin' }),
      ...U.collect(text, UAN, 'Indian UAN', (v) => (U.digitCount(v) === 12 ? 0.95 : null), 'regex', { group: 1, rule: 'uan-keyword' }),
    ];
  }

  U.register('Indian GSTIN', detect);
  P.gstinValid = gstinValid;
})(globalThis);
