// Payment Card Number: card number (Luhn), CVV and expiry date.
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const U = P.util;
  const LABEL = 'Payment Card Number';

  const CARD_KW = /\b(?:card|debit|credit|visa|mastercard|master|rupay|amex|maestro|cc|dc)\b/i;
  const IMEI_KW = /\b(?:imei|device[ \t]+id)\b/i;
  const ACCOUNT_KW = /\b(?:a\/c|acct|account|iban|ifsc|savings|current)\b/i;

  // 13–19 digit cards in groups of 4 (Visa/MC/RuPay) or 4-6-5 (Amex).
  const CARD = /(?<![\w-])(?:\d{4}(?:[ -]?\d{4}){2}[ -]?\d{1,7}|\d{4}[ -]?\d{6}[ -]?\d{5})(?![\w-])/gd;
  // **** **** **** 4321 · XXXX-XXXX-XXXX-1234 · card ending XXXX1234
  const MASKED = /(?<![\w*•])(?:[Xx*•]{4}[ -]?){2,3}(?:[Xx*•]{0,4}[ -]?)?\d{4}(?!\w)/gd;
  const MASKED_SHORT = /(?<![\w*•])[Xx*•]{2,}[ -]?\d{4}(?!\w)/gd;
  // CVV: 123 · CVC 4567
  const CVV = /\b(?:cvv2?|cvc2?|cvn|card[ \t]+verification(?:[ \t]+(?:value|code))?)\b[ \t]*(?:no\.?|number|code)?[ \t]*[:\-=]?[ \t]*(\d{3,4})(?!\d)/gid;
  // Exp: 08/27 · Valid thru 08/2027 · Expiry date - 08 / 27
  const EXPIRY = /\b(?:exp(?:iry|iration)?(?:[ \t]+date)?|valid[ \t]*(?:thru|through|till|upto|up[ \t]+to)|expires?(?:[ \t]+on)?)\b\.?[ \t]*[:\-]?[ \t]*((?:0[1-9]|1[0-2])[ \t]*[\/-][ \t]*(?:\d{4}|\d{2}))(?!\d)/gid;

  function detect(text) {
    return [
      ...U.collect(text, CARD, LABEL, (v, m, s, e) => {
        const d = U.onlyDigits(v);
        if (d.length < 13 || d.length > 19 || /^(\d)\1+$/.test(d)) return null;
        const cardWord = U.near(text, s, e, CARD_KW, 40, 0);
        // Bank account numbers can pass the card checksum by chance: an "account" keyword wins,
        // and a run of digits with no spaces must be a usual card length (15/16) to count.
        if (!cardWord && U.near(text, s, e, ACCOUNT_KW, 30, 0)) return null;
        if (!cardWord && !/[ -]/.test(v) && d.length !== 16 && d.length !== 15) return null;
        // Only American Express (34/37) cards have 15 digits; a 15-digit number after IMEI is a device.
        if (!cardWord && d.length === 15 && (!/^3[47]/.test(d) || U.near(text, s, e, IMEI_KW, 40, 0))) return null;
        if (U.luhn(d)) return 0.95;
        return cardWord ? 0.7 : null;
      }, 'regex', { rule: 'card-number' }),
      ...U.collect(text, MASKED, LABEL, 0.9, 'regex', { rule: 'card-masked' }),
      ...U.collect(text, MASKED_SHORT, LABEL, (v, m, s, e) => (U.near(text, s, e, CARD_KW, 30, 0) ? 0.88 : null),
        'regex', { rule: 'card-masked-short' }),
      ...U.collect(text, CVV, LABEL, 0.9, 'regex', { group: 1, rule: 'card-cvv' }),
      ...U.collect(text, EXPIRY, LABEL, (v, m, s, e) => (U.near(text, s, e, CARD_KW, 80, 0) ? 0.88 : 0.72),
        'regex', { group: 1, rule: 'card-expiry' }),
    ];
  }

  U.register(LABEL, detect);
})(globalThis);
