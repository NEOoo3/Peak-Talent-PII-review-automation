// Indian UPI ID, e.g. rahul@okaxis. Unlike an email,
// the part after "@" is a bank/app handle with no ".com".
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const U = P.util;
  const LABEL = 'Indian UPI ID';
  const UPI = /(?<![\w.%+-])[A-Za-z0-9][A-Za-z0-9._-]{1,255}@([A-Za-z][A-Za-z0-9]{1,30})(?![\w@-]|\.[A-Za-z0-9])/gd;
  const HANDLES = new Set(('okaxis okhdfcbank okicici oksbi ybl ibl axl upi paytm ptyes ptaxis pthdfc ptsbi apl yapl rapl abfspay ' +
    'axisbank axisb icici hdfcbank sbi kotak kmbl barodampay aubank freecharge jupiteraxis slc yesbank yesbankltd idfcbank idfc ' +
    'indus federal fbl citi citigold hsbc pnb unionbankofindia uboi cnrb boi mahb kvb kbl jsb dbs equitas ujjivan airtel ' +
    'airtelpaymentsbank jio postbank waaxis waicici wahdfcbank wasbi amazonpay apay icicipay nsdl timecosmos fam superyes').split(' '));
  const UPI_KW = /\b(?:upi|vpa|gpay|google[ \t]?pay|phonepe|paytm|bhim)\b/i;
  U.register(LABEL, (text) => U.collect(text, UPI, LABEL, (v, m, s, e) => {
    if (HANDLES.has(m[1].toLowerCase())) return 0.95;
    return U.near(text, s, e, UPI_KW, 40, 0) ? 0.85 : null;
  }, 'regex', { rule: 'upi' }));
})(globalThis);
