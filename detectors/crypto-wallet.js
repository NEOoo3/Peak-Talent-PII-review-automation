// Crypto Wallet Address (labeled Account Number).
//   - Ethereum and EVM chains: 0x + 40 hex characters (a 64-character 0x… value is a
//     transaction hash, not a wallet)
//   - Bitcoin bech32: bc1… ; other formats (Bitcoin 1…/3…, Tron T…, Solana…) only after a
//     wallet / coin keyword, since base58 strings look like many other IDs.
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const U = P.util;

  const ETH = /(?<![\w])0x[a-fA-F0-9]{40}(?![a-fA-F0-9\w])/gd;
  const BECH32 = /\b(?:bc1|ltc1)[ac-hj-np-z02-9]{25,62}\b/gd;
  const KEYED = U.keyed(String.raw`(?:(?:crypto|btc|bitcoin|eth|ethereum|usdt|usdc|trc-?20|erc-?20|tron|trx|sol|solana|ltc|litecoin|doge|dogecoin|xrp|ripple)[ \t]*)?wallet(?:[ \t]+address)?|btc[ \t]+address|bitcoin[ \t]+address|deposit[ \t]+address`,
    String.raw`[1-9A-HJ-NP-Za-km-z]{25,44}(?![\w])`);

  function detect(text) {
    return [
      ...U.collect(text, ETH, 'Crypto Wallet Address', 0.92, 'regex', { rule: 'wallet-eth' }),
      ...U.collect(text, BECH32, 'Crypto Wallet Address', 0.92, 'regex', { rule: 'wallet-bech32' }),
      ...U.collect(text, KEYED, 'Crypto Wallet Address', (v) => (/\d/.test(v) && /[A-Za-z]/.test(v) ? 0.88 : null),
        'regex', { group: 1, rule: 'wallet-keyword' }),
    ];
  }

  U.register('Crypto Wallet Address', detect);
})(globalThis);
