// Indian IFSC Code (bank branch, 11 characters), e.g. SBIN0001234.
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const U = P.util;
  // 4 letters (bank) + 0 + 6 letters/digits (branch)
  const IFSC = /\b[A-Z]{4}0[A-Z0-9]{6}\b/gd;
  U.register('Indian IFSC Code', (text) => U.collect(text, IFSC, 'Indian IFSC Code',
    (v) => (/\d/.test(v.slice(5)) || /ifsc/i.test(text) ? 0.95 : 0.75), 'regex', { rule: 'ifsc' }));
})(globalThis);
