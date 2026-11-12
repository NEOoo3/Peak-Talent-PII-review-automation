// Brazilian IDs (labeled Credentials). Formatted numbers with valid check digits are
// reported on their own; bare digit runs only after their field name, because CPF, CNH
// and PIS are all 11 digits.
//   - Brazilian CPF: ###.###.###-## (2 check digits)
//   - Brazilian CNPJ: ##.###.###/####-## (2 check digits)
//   - Brazilian PIS/PASEP: ###.#####.##-# (1 check digit); also NIT / NIS
//   - Brazilian RG: after RG / Registro Geral / Identidade, e.g. 12.345.678-9
//   - Brazilian CNH: 11 digits after CNH / Carteira de Habilitação
//   - Brazilian Voter Registration (Título de Eleitor): 12 digits after its field name
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const U = P.util;

  const repeated = (d) => /^(\d)\1+$/.test(d);

  function cpfValid(d) {
    if (d.length !== 11 || repeated(d)) return false;
    return U.mod11(d, [10, 9, 8, 7, 6, 5, 4, 3, 2]) === +d[9] && U.mod11(d, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) === +d[10];
  }
  function cnpjValid(d) {
    if (d.length !== 14 || repeated(d)) return false;
    return U.mod11(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === +d[12] && U.mod11(d, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === +d[13];
  }
  function pisValid(d) {
    return d.length === 11 && !repeated(d) && U.mod11(d, [3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === +d[10];
  }

  const CPF = /(?<![\w.\/-])\d{3}\.\d{3}\.\d{3}-\d{2}(?![\w.\/-])/gd;
  const CPF_KW = U.keyed(String.raw`cpf(?:\/mf)?|cadastro[ \t]+de[ \t]+pessoas?[ \t]+f[ií]sicas?`, String.raw`\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)`);
  const CNPJ = /(?<![\w.\/-])\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}(?![\w.\/-])/gd;
  const CNPJ_KW = U.keyed(String.raw`cnpj(?:\/mf)?`, String.raw`\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?!\d)`);
  const PIS = /(?<![\w.\/-])\d{3}\.\d{5}\.\d{2}-\d(?![\w.\/-])/gd;
  const PIS_KW = U.keyed(String.raw`pis(?:[ \t]*\/[ \t]*pasep)?|pasep|nit|nis`, String.raw`\d{3}\.?\d{5}\.?\d{2}-?\d(?!\d)`);
  const RG = U.keyed(String.raw`rg|r\.g\.|registro[ \t]+geral|c[ée]dula[ \t]+de[ \t]+identidade|carteira[ \t]+de[ \t]+identidade|identidade`,
    String.raw`\d{1,2}\.?\d{3}\.?\d{3}-?[\dXx](?![\w])`);
  const CNH = U.keyed(String.raw`cnh|carteira[ \t]+(?:nacional[ \t]+)?de[ \t]+habilita[çc][ãa]o|registro[ \t]+(?:da[ \t]+)?cnh`, String.raw`\d{11}(?!\d)`);
  const TITULO = U.keyed(String.raw`t[íi]tulo(?:[ \t]+de)?[ \t]+eleitor(?:al)?|inscri[çc][ãa]o[ \t]+eleitoral|voter[ \t]+registration`,
    String.raw`\d{4}[ .]?\d{4}[ .]?\d{4}(?!\d)`);

  function detect(text) {
    const digits = (v) => U.onlyDigits(v);
    return [
      ...U.collect(text, CPF, 'Brazilian CPF', (v, m, s, e) => (cpfValid(digits(v)) ? 0.97 : U.near(text, s, e, /\bcpf\b/i, 25, 0) ? 0.85 : 0.6),
        'regex', { rule: 'cpf' }),
      ...U.collect(text, CPF_KW, 'Brazilian CPF', (v) => (cpfValid(digits(v)) ? 0.97 : repeated(digits(v)) ? null : 0.85), 'regex', { group: 1, rule: 'cpf-keyword' }),
      ...U.collect(text, CNPJ, 'Brazilian CNPJ', (v) => (cnpjValid(digits(v)) ? 0.97 : 0.75), 'regex', { rule: 'cnpj' }),
      ...U.collect(text, CNPJ_KW, 'Brazilian CNPJ', (v) => (cnpjValid(digits(v)) ? 0.97 : repeated(digits(v)) ? null : 0.85), 'regex', { group: 1, rule: 'cnpj-keyword' }),
      ...U.collect(text, PIS, 'Brazilian PIS/PASEP', (v) => (pisValid(digits(v)) ? 0.95 : 0.65), 'regex', { rule: 'pis' }),
      ...U.collect(text, PIS_KW, 'Brazilian PIS/PASEP', (v) => (pisValid(digits(v)) ? 0.95 : 0.8), 'regex', { group: 1, rule: 'pis-keyword' }),
      ...U.collect(text, RG, 'Brazilian RG', (v) => (U.digitCount(v) >= 7 ? 0.92 : null), 'regex', { group: 1, rule: 'rg-keyword' }),
      ...U.collect(text, CNH, 'Brazilian CNH', 0.95, 'regex', { group: 1, rule: 'cnh-keyword' }),
      ...U.collect(text, TITULO, 'Brazilian Voter Registration', 0.95, 'regex', { group: 1, rule: 'titulo-keyword' }),
    ];
  }

  U.register('Brazilian CPF', detect);
  P.brazil = { cpfValid, cnpjValid, pisValid };
})(globalThis);
