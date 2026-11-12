// Indian Voter ID (EPIC): 3 letters + 7 digits (ABC1234567), or the old state format
// AB/12/345/678901 next to a voter / EPIC keyword.
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const U = P.util;
  const LABEL = 'Indian Voter ID';
  const EPIC = /\b[A-Z]{3}\d{7}\b/gd;
  const VOTER_KW = /\b(?:voter|epic|election|electoral)\b/i;
  const OLD_FORMAT = /\b[A-Z]{2}\/\d{2}\/\d{3}\/\d{6}\b/gd;
  U.register(LABEL, (text) => [
    ...U.collect(text, EPIC, LABEL, (v, m, s, e) => (U.near(text, s, e, VOTER_KW, 40, 0) ? 0.95 : 0.72), 'regex', { rule: 'voter-epic' }),
    ...U.collect(text, OLD_FORMAT, LABEL, (v, m, s, e) => (U.near(text, s, e, VOTER_KW, 40, 0) ? 0.92 : 0.6), 'regex', { rule: 'voter-old-format' }),
  ]);
})(globalThis);
