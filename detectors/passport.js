// Passport numbers, only after a passport keyword (the shapes alone, like A1234567, are
// too common). The country words near it decide the type:
//   - US Passport Number: 9 digits, or a letter + 8 digits, with US / United States nearby
//   - Indonesian Passport Number: "paspor", or Indonesia / RI nearby
//   - Passport Number: any other country (Indian: a letter + 7 digits)
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const U = P.util;

  const PASSPORT = U.keyed(String.raw`passport|paspor(?:[ \t]+RI)?|passeport|pasaporte|passaporte`, String.raw`[A-Z]{1,2}[ -]?\d{6,8}|\d{9}`);
  const US = /\b(?:usa|u\.s\.a?\.?|us|united[ \t]+states|american)(?![\w])/i;
  const ID = /\b(?:paspor|indonesia|indonesian|republik[ \t]+indonesia|ri|wni)(?![\w])/i;

  function detect(text) {
    const out = U.collect(text, PASSPORT, 'Passport Number', 0.95, 'regex', { group: 1, rule: 'passport-keyword' });
    for (const d of out) {
      const v = d.text.replace(/[ -]/g, '');
      const before = text.slice(Math.max(0, d.start - 60), d.start);
      if (ID.test(before)) { d.label = 'Indonesian Passport Number'; d.rule = 'passport-indonesia'; }
      else if (US.test(before) && /^(?:\d{9}|[A-Z]\d{8})$/i.test(v)) { d.label = 'US Passport Number'; d.rule = 'passport-us'; }
    }
    return out;
  }

  U.register('Passport Number', detect);
})(globalThis);
