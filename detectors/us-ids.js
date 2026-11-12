// US IDs (labeled Credentials, or Account Number for bank numbers):
//   - US Social Security Number: ###-##-#### (never 000/666/9xx, 00, 0000); 9 plain digits only after an SSN keyword.
//   - US Employer Identification Number: ##-####### after an EIN / FEIN / employer ID keyword.
//   - US Driver Licence Number: a value after a driver's licence keyword with a US state or "USA"
//     nearby. Without that, it is reported as Driver Licence Number (another country).
//   - US Bank Account/Routing Number: a 9-digit routing (ABA) number with a valid checksum after a
//     routing keyword, and an account number in a document that has a routing number or US bank words.
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const U = P.util;

  const SSN = /(?<![\w-])(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?![\w-])/gd;
  const SSN_KW = /\b(?:ssn|ss#|social[ \t]+security(?:[ \t]+(?:no|number|#))?)\b/i;
  const SSN_PLAIN = U.keyed(String.raw`ssn|social[ \t]+security`, String.raw`(?!000|666|9\d\d)\d{3}[ ]?(?!00)\d{2}[ ]?(?!0000)\d{4}`);

  // ITIN: 9XX-[50-65|70-88|90-92|94-99]-XXXX. The platform has no ITIN type: it is labeled
  // US Social Security Number (same shape, an individual's taxpayer number; docs/GUIDE.md).
  const ITIN = /(?<![\w-])9\d{2}([- ])(?:5\d|6[0-5]|7\d|8[0-8]|9[0-2]|9[4-9])\1\d{4}(?![\w-])/gd;
  const ITIN_KW = /\b(?:itin|individual[ \t]+taxpayer|taxpayer[ \t]+id(?:entification)?)\b/i;
  const ITIN_PLAIN = U.keyed(String.raw`itin|individual[ \t]+taxpayer[ \t]+identification(?:[ \t]+number)?`,
    String.raw`9\d{2}[ -]?(?:5\d|6[0-5]|7\d|8[0-8]|9[0-2]|9[4-9])[ -]?\d{4}(?!\d)`);

  const EIN = U.keyed(String.raw`ein|fein|employer[ \t]+identification(?:[ \t]+number)?|employer[ \t]+id|federal[ \t]+tax[ \t]+id(?:entification)?(?:[ \t]+number)?`,
    String.raw`\d{2}-\d{7}(?!\d)`);

  const US_CONTEXT = /\b(?:usa|u\.s\.a?\.?|united[ \t]+states|dmv|alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new[ \t]+hampshire|new[ \t]+jersey|new[ \t]+mexico|new[ \t]+york|north[ \t]+carolina|north[ \t]+dakota|ohio|oklahoma|oregon|pennsylvania|rhode[ \t]+island|south[ \t]+carolina|south[ \t]+dakota|tennessee|texas|utah|vermont|virginia|washington|west[ \t]+virginia|wisconsin|wyoming)\b/i;
  // "Driver's License No: D1234567", "DL #: 123-456-789"
  const DL = U.keyed(String.raw`driver['’]?s?[ \t]+licen[cs]e|driving[ \t]+licen[cs]e|dln?|d\.l\.`,
    String.raw`[A-Z0-9](?:[A-Z0-9 -]{3,17})[A-Z0-9](?![\w-])`);
  const INDIAN_DL = /^[A-Z]{2}[ -]?\d{2}/i;
  const INDIAN_PLATE_FROM = /^DL[ -]?\d{1,2}[A-Z]?[ -]?[A-Z]{1,3}[ -]?\d{4}(?![\w])/;

  const ROUTING = U.keyed(String.raw`routing(?:[ \t]+transit)?|aba(?:[ \t]+routing)?|rtn|bank[ \t]+routing`, String.raw`\d{9}(?!\d)`);
  const US_ACCOUNT = U.keyed(String.raw`(?:checking|savings|bank)?[ \t]*(?:account|acct)`, String.raw`\d{4,17}(?!\d)`);
  const US_BANK_KW = /\b(?:routing|aba|checking[ \t]+account|ach|wire[ \t]+transfer|usd)\b/i;
  function abaValid(d) {
    const n = d.split('').map(Number);
    return (3 * (n[0] + n[3] + n[6]) + 7 * (n[1] + n[4] + n[7]) + (n[2] + n[5] + n[8])) % 10 === 0 && d !== '000000000';
  }

  function detect(text) {
    const hasRouting = US_BANK_KW.test(text);
    const out = [
      ...U.collect(text, SSN, 'US Social Security Number', (v, m, s, e) => (U.near(text, s, e, SSN_KW, 40, 0) ? 0.97 : 0.72),
        'regex', { rule: 'ssn' }),
      ...U.collect(text, SSN_PLAIN, 'US Social Security Number', (v) => (U.digitCount(v) === 9 ? 0.92 : null),
        'regex', { group: 1, rule: 'ssn-keyword' }),
      ...U.collect(text, ITIN, 'US Social Security Number', (v, m, s, e) => (U.near(text, s, e, ITIN_KW, 40, 0) ? 0.97 : 0.85),
        'regex', { rule: 'us-itin' }),
      ...U.collect(text, ITIN_PLAIN, 'US Social Security Number', 0.95, 'regex', { group: 1, rule: 'us-itin-keyword' }),
      ...U.collect(text, EIN, 'US Employer Identification Number', 0.95, 'regex', { group: 1, rule: 'ein-keyword' }),
      ...U.collect(text, ROUTING, 'US Bank Account/Routing Number', (v) => (abaValid(v) ? 0.95 : 0.7), 'regex', { group: 1, rule: 'us-routing' }),
    ];
    if (hasRouting) {
      out.push(...U.collect(text, US_ACCOUNT, 'US Bank Account/Routing Number', (v) => (v.length >= 6 ? 0.9 : null),
        'regex', { group: 1, rule: 'us-account' }));
    }
    // "DL 49 KL 4247" is a Delhi number plate, not the keyword "DL" and a licence number.
    const dlScore = (v, m) => {
      if (INDIAN_PLATE_FROM.test(text.slice(m.index, m.index + 20))) return null;
      return /\d/.test(v) && U.digitCount(v) >= 4 ? 0.9 : null;
    };
    for (const d of U.collect(text, DL, 'US Driver Licence Number', dlScore,
      'regex', { group: 1, trim: true, rule: 'us-dl-keyword' })) {
      if (INDIAN_DL.test(d.text)) continue; // the Indian format is driving-license.js
      if (!U.near(text, d.start, d.end, US_CONTEXT, 120, 80)) {
        d.label = 'Driver Licence Number'; d.confidence = 0.8; d.rule = 'dl-keyword-other';
      }
      out.push(d);
    }
    return out;
  }

  U.register('US Social Security Number', detect);
})(globalThis);
