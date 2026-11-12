// Indian banks: a Business Name (PII dataset sheet, decision 3 — "Indian banks are masked (HDFC Bank, SBI, ICICI Bank);
// only global banks on the list (HSBC, Citibank, Barclays) stay"). Global banks and regulators stay on the public
// names list (data/business-names.json). One name per entry; "Bank" may be written with or without "Ltd".
(function (g) {
  'use strict';
  g.PIIRA.INDIAN_BANKS = [
    'State Bank of India', 'SBI', 'Punjab National Bank', 'PNB', 'Bank of Baroda', 'Canara Bank', 'Union Bank of India',
    'Bank of India', 'Indian Bank', 'Central Bank of India', 'Indian Overseas Bank', 'UCO Bank', 'Bank of Maharashtra',
    'Punjab & Sind Bank', 'HDFC Bank', 'ICICI Bank', 'Axis Bank', 'Kotak Mahindra Bank', 'IndusInd Bank', 'Yes Bank',
    'IDFC First Bank', 'IDBI Bank', 'Federal Bank', 'Bandhan Bank', 'RBL Bank', 'South Indian Bank', 'Karur Vysya Bank',
    'City Union Bank', 'Karnataka Bank', 'Tamilnad Mercantile Bank', 'DCB Bank', 'J&K Bank', 'AU Small Finance Bank',
    'Equitas Small Finance Bank', 'Ujjivan Small Finance Bank', 'Airtel Payments Bank', 'India Post Payments Bank',
    'Paytm Payments Bank',
  ];
})(globalThis);
