// IMEI Number (labeled Credentials): 15 digits with a valid Luhn check digit, after an
// IMEI / device ID keyword. Without the keyword 15 digits could be a card or an order number.
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const U = P.util;

  const IMEI = U.keyed(String.raw`imei(?:[ \t]*[12])?(?:[ \t]+(?:is|was))?|imei[ \t]+no|device[ \t]+(?:id|imei)`, String.raw`\d{2}[ -]?\d{6}[ -]?\d{6}[ -]?\d(?!\d)|\d{15}(?!\d)`);

  U.register('IMEI Number', (text) => U.collect(text, IMEI, 'IMEI Number', (v) => {
    const d = U.onlyDigits(v);
    if (d.length !== 15) return null;
    return U.luhn(d) ? 0.95 : 0.75;
  }, 'regex', { group: 1, rule: 'imei-keyword' }));
})(globalThis);
