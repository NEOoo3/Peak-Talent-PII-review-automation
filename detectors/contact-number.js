// Contact Number types:
//   - Indian Mobile Number: 10 digits starting 6-9, optionally +91 / 0 (also masked: 98xxx xxxxx)
//   - International Phone Number: a +country code other than +91
//   - Contact Number: landlines, toll-free numbers, and numbers after a phone keyword
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const U = P.util;


  // +91 98450 12345 · 098450-12345 · 9845012345 · 0091 9845012345
  const MOBILE = /(?<![\w+])(?:(?:\+|00)?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/gd;
  // 080-2345-6789 · (080) 2345 6789 · 080 4567 8900 · +91 80 2345 6789
  const LANDLINE = /(?<![\w+])(?:\+91[\s-]?\(?0?\d{2,4}\)?|\(?0\d{2,4}\)?)[\s-]\d{3,4}[\s-]?\d{4}(?!\d)/gd;
  // 1800 123 4567 · 1800-419-0000 · 1860 500 1111
  const TOLL_FREE = /(?<![\w+])18[06]0[\s-]?\d{3}[\s-]?\d{3,4}(?!\d)/gd;
  // +1 (415) 555-2671 · +44 20 7946 0958
  const INTERNATIONAL = /(?<![\w+])\+(?!91)\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}(?!\d)/gd;
  // 98xxx xxxxx · +91 98XXX XXX45
  const MASKED = /(?<![\w+])(?:\+?91[\s-]?)?[6-9][\dXx*•]{4}[\s-]?[\dXx*•]{5}(?![\w*•])/gd;
  // "Phone: …" / "Mobile No. …" followed by digits or a masked number.
  const KEYWORD = /\b(?:phone|ph|mobile|mob|tel|telephone|contact|cell|whatsapp|landline|fax|helpline)\b\.?[ \t]*(?:no\.?|number|#)?[ \t]*[:\-]?[ \t]*(\+?[\dXx*•(][\dXx*• \t().-]{6,20}[\dXx*•])/gid;

  // Dummy numbers, judged from the digits — a number cannot be checked as "working" without calling it: one digit
  // repeated (99999 99999), a long run of one digit (98000 00000), a straight run (1234567890, 9876543210). Masked
  // numbers (98xxx xxxxx) are not dummies: they hide a real one.
  const STRAIGHT = '01234567890123456789';
  function isDummyPhone(v) {
    if (/[Xx*•]/.test(v)) return false;
    let d = String(v).replace(/\D/g, '');
    if (/^\+?(?:00)?91/.test(String(v).trim()) && d.length > 10) d = d.replace(/^(?:00)?91/, '');
    d = d.replace(/^0(?=\d{10}$)/, '');
    if (d.length < 7) return false;
    if (/^(\d)\1+$/.test(d) || /(\d)\1{6,}/.test(d)) return true;
    const tail = d.slice(-10);
    return tail.length >= 9 && (STRAIGHT.includes(tail) || [...STRAIGHT].reverse().join('').includes(tail));
  }
  P.isDummyPhone = isDummyPhone;

  function detect(text) {
    const out = [];
    const add = (re, type, rule, score, group) => out.push(...U.collect(text, re, type, score, 'regex', { rule, group }));
    add(TOLL_FREE, 'Contact Number', 'phone-toll-free', 0.95);
    add(MOBILE, 'Indian Mobile Number', 'phone-mobile', (v) => { const n = U.digitCount(v); return n >= 10 && n <= 13 ? 0.95 : null; });
    add(LANDLINE, 'Contact Number', 'phone-landline', (v) => { const n = U.digitCount(v); return n >= 10 && n <= 13 ? 0.82 : null; });
    add(INTERNATIONAL, 'International Phone Number', 'phone-international', (v) => { const n = U.digitCount(v); return n >= 8 && n <= 15 ? 0.86 : null; });
    add(MASKED, 'Indian Mobile Number', 'phone-masked', (v) => (/[Xx*•]/.test(v) && U.digitCount(v) >= 2 ? 0.8 : null));
    add(KEYWORD, 'Contact Number', 'phone-keyword', (v) => {
      const real = U.digitCount(v);
      const total = (v.match(/[\dXx*•]/g) || []).length;
      if (real < 2 || total < 8 || total > 13) return null;
      return /[Xx*•]/.test(v) ? 0.85 : 0.9;
    }, 1);
    // A number after a phone keyword is still an Indian mobile or international number when it has that shape.
    for (const d of out) {
      if (d.rule !== 'phone-keyword') continue;
      if (/^\+(?!91)/.test(d.text.trim())) d.label = 'International Phone Number';
      else if (/^(?:(?:\+|00)?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}$/.test(d.text.trim())) d.label = 'Indian Mobile Number';
    }
    return out;
  }

  U.register('Contact Number', detect);
})(globalThis);
