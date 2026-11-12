// Vehicle Number Plate types:
//   - Indian Vehicle Number Plate: state code + RTO number + series + 4 digits (MH12AB1234,
//     KA 05 MN 4321, DL-3C-AB-1234), or the Bharat series 22BH1234AA.
//   - Vehicle Number Plate: any other plate, only after a plate / registration keyword.
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const U = P.util;

  const STATES = new Set(('AN AP AR AS BR CH CG DD DL DN GA GJ HR HP JH JK KA KL LA LD MH ML MN MP MZ NL OD OR PB PY RJ SK ' +
    'TN TR TS TG UK UA UP WB').split(' '));
  const INDIAN = /\b([A-Z]{2})[ -]?(\d{1,2}[A-Z]?)[ -]?([A-Z]{1,3})[ -]?(\d{4})\b/gd;
  const BHARAT = /\b\d{2}[ -]?BH[ -]?\d{4}[ -]?[A-HJ-NP-Z]{1,2}\b/gd;
  const PLATE_KW = /\b(?:vehicle|registration|reg\.?|number[ \t]+plate|licen[cs]e[ \t]+plate|plate|rc|car|bike|scooter|truck)\b/i;
  // Vehicle words only: a bare "registration no." is often a company or student registration.
  const KEYED = U.keyed(String.raw`vehicle(?:[ \t]+(?:registration|reg\.?))?|vehicle[ \t]+registration|number[ \t]+plate|licen[cs]e[ \t]+plate|plate|rc|car[ \t]+(?:registration|reg\.?)`,
    String.raw`[A-Z0-9](?:[A-Z0-9 -]{2,9})[A-Z0-9](?![\w-])`);

  function detect(text) {
    const out = [
      ...U.collect(text, INDIAN, 'Indian Vehicle Number Plate', (v, m, s, e) => {
        if (!STATES.has(m[1])) return null;
        return U.near(text, s, e, PLATE_KW, 40, 0) ? 0.95 : 0.88;
      }, 'regex', { rule: 'plate-indian' }),
      ...U.collect(text, BHARAT, 'Indian Vehicle Number Plate', 0.92, 'regex', { rule: 'plate-bharat' }),
    ];
    for (const d of U.collect(text, KEYED, 'Vehicle Number Plate', (v) => (/\d/.test(v) && /[A-Z]/i.test(v) ? 0.88 : null),
      'regex', { group: 1, trim: true, rule: 'plate-keyword' })) {
      if (!out.some((o) => o.start < d.end && o.end > d.start)) out.push(d);
    }
    return out;
  }

  U.register('Vehicle Number Plate', detect);
})(globalThis);
