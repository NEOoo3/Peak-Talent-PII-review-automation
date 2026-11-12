// Account Number types: IBAN (mod-97 checksum), Bank Account Number (after an account /
// bank keyword) and Account Number (masked numbers such as XXXX1234). Payment cards are
// card-number.js; US account and routing numbers are us-ids.js.
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const U = P.util;

  const BANK_KW = /\b(?:a\/c|acct|account|bank|savings|current|ifsc|branch|sb|ca|beneficiary|neft|rtgs|imps)\b/i;
  const CARD_KW = /\b(?:card|debit|credit|visa|mastercard|rupay|amex)\b/i;
  const PHONE_KW = /\b(?:phone|ph|mobile|mob|tel|contact|cell|whatsapp|call)\b/i;
  const OTHER_ID_KW = /\b(?:aadhaa?r|uid|uan|pan|voter|epic|licen[cs]e|aws|cloud|account[ \t]*id|routing|aba)\b/i;

  // GB82 WEST 1234 5698 7654 32 · DE89370400440532013000
  const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/gd;

  // XXXX1234 · xx-xx-5566 (a masked card is a card, see card-number.js)
  // Groups of mask characters split only at a space or dash, so a long run of "*" or "x" cannot backtrack.
  const MASKED = /(?<![\w*•])[Xx*•]{2,}(?:[ -][Xx*•]{2,})*[ -]?\d{3,6}(?!\w)/gd;

  // "A/c No: 001234567890", "Bank account number - 50100234567890" (not "Account ID")
  const KEYWORD = /\b(?:a\/c|acct|(?:bank|savings|current|salary|sb)?[ \t]*account(?![ \t]*id\b))\b\.?[ \t]*(?:no\.?|number|num|#)?[ \t]*[:#-]?[ \t]*([0-9][0-9 -]{7,22}[0-9])(?![\d])/gid;

  // Plain 9–18 digit numbers, only accepted next to a bank word.
  const NARRATION_ACCT = /\b(?:NEFT|IMPS|RTGS|TRF|INB|MMT)\b[^\n,]{0,60}?[-\/](\d{9,18})(?=[-\/,\s]|$)/gd;
  const BARE = /(?<![\w.\/-])\d{9,18}(?![\w.\/-])/gd;

  function detect(text) {
    return [
      ...U.collect(text, IBAN, 'IBAN', (v, m, s, e) => {
        let end = e; // the regex may run into the next word; shorten until the checksum passes
        while (end - s >= 15) {
          if (U.ibanValid(text.slice(s, end))) return { start: s, end, confidence: 0.95 };
          const cut = text.slice(s, end).search(/ ?[A-Z0-9]{1,4}$/);
          if (cut <= 0) break;
          end = s + cut;
        }
        return null;
      }, 'regex', { rule: 'account-iban' }),

      ...U.collect(text, MASKED, 'Account Number', (v, m, s, e) => {
        if (U.near(text, s, e, PHONE_KW, 30, 0) || U.near(text, s, e, CARD_KW, 30, 0)) return null;
        return U.near(text, s, e, BANK_KW, 40, 0) ? 0.9 : 0.7;
      }, 'regex', { rule: 'account-masked' }),

      ...U.collect(text, KEYWORD, 'Bank Account Number', (v, m, s, e) => {
        const n = U.digitCount(v);
        if (n < 8 || n > 18 || U.near(text, s, e, CARD_KW, 25, 0)) return null;
        return 0.92;
      }, 'regex', { group: 1, rule: 'account-keyword' }),

      // A bank statement narration names the other account: "IMPS/ANJALI MEHRA/60123456789", "NEFT-50100234567890-…".
      ...U.collect(text, NARRATION_ACCT, 'Bank Account Number', 0.85, 'regex', { group: 1, rule: 'account-narration' }),
      ...U.collect(text, BARE, 'Bank Account Number', (v, m, s, e) => {
        if (v.length === 10 && /^[6-9]/.test(v)) return null; // Indian mobile number
        if (/^[ \t]+[+-]\d{4}\b/.test(text.slice(e, e + 8))) return null; // git / Unix timestamp "1772449980 +0530"
        if (U.near(text, s, e, OTHER_ID_KW, 30, 0)) return null; // Aadhaar, cloud account id …
        return U.near(text, s, e, BANK_KW, 40, 0) ? 0.65 : null;
      }, 'regex', { rule: 'account-bare-digits' }),
    ];
  }

  U.register('Bank Account Number', detect);
})(globalThis);
