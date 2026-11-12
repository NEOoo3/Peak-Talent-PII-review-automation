// Indonesian IDs (labeled Credentials). NIK and the family card number (KK) are both
// 16 digits, so the field name in front decides; without one nothing is reported.
//   - Indonesian NIK: 16 digits after NIK / KTP (province 11-94, birth day 01-31 or 41-71, month 01-12)
//   - Indonesian Family Card (KK): 16 digits after "No. KK" / Kartu Keluarga
//   - Indonesian NPWP: ##.###.###.#-###.### (or 15/16 digits after NPWP)
//   - Indonesian BPJS Number: 11-13 digits after BPJS / KIS / JKN
//   - Indonesian Civil Servant Number (NIP): 18 digits after NIP (birth date + appointment month + gender + number)
//   - Indonesian Driving Licence (SIM): 12-14 digits after SIM / Surat Izin Mengemudi (not a SIM card)
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const U = P.util;

  const SIXTEEN = String.raw`\d{4}[ .-]?\d{4}[ .-]?\d{4}[ .-]?\d{4}(?!\d)`;
  const NIK = U.keyed(String.raw`nik|n\.i\.k\.?|ktp|e-?ktp|nomor[ \t]+induk[ \t]+kependudukan|no[ \t]+ktp`, SIXTEEN);
  const KK = U.keyed(String.raw`kk|no\.?[ \t]*kk|kartu[ \t]+keluarga|family[ \t]+card`, SIXTEEN);
  function nikStructure(d) {
    const prov = +d.slice(0, 2);
    const day = +d.slice(6, 8);
    const month = +d.slice(8, 10);
    return prov >= 11 && prov <= 94 && ((day >= 1 && day <= 31) || (day >= 41 && day <= 71)) && month >= 1 && month <= 12;
  }

  const NPWP = /(?<![\w.-])\d{2}\.\d{3}\.\d{3}\.\d-\d{3}\.\d{3}(?![\w.-])/gd;
  const NPWP_KW = U.keyed(String.raw`npwp|nomor[ \t]+pokok[ \t]+wajib[ \t]+pajak`, String.raw`\d{15,16}(?!\d)`);

  const BPJS = U.keyed(String.raw`bpjs(?:[ \t]+(?:kesehatan|ketenagakerjaan|tk))?|kis|jkn(?:-kis)?|kartu[ \t]+indonesia[ \t]+sehat`,
    String.raw`\d{11,13}(?!\d)`);

  const NIP = U.keyed(String.raw`nip|n\.i\.p\.?|nomor[ \t]+induk[ \t]+pegawai`, String.raw`\d{8}[ ]?\d{6}[ ]?\d[ ]?\d{3}(?!\d)`);
  function nipStructure(d) {
    const y = +d.slice(0, 4);
    const m = +d.slice(4, 6);
    const day = +d.slice(6, 8);
    const ay = +d.slice(8, 12);
    const am = +d.slice(12, 14);
    return y >= 1940 && y <= 2010 && m >= 1 && m <= 12 && day >= 1 && day <= 31 && ay >= 1960 && ay <= 2040 && am >= 1 && am <= 12 &&
      (d[14] === '1' || d[14] === '2');
  }

  const SIM = U.keyed(String.raw`sim(?![ \t]*card)(?:[ \t]+[abcd]\d?)?|surat[ \t]+izin[ \t]+mengemudi`, String.raw`\d{4}[ -]?\d{4}[ -]?\d{4,6}(?!\d)`);

  function detect(text) {
    const d16 = (v) => U.onlyDigits(v).length === 16;
    return [
      ...U.collect(text, NIK, 'Indonesian NIK', (v) => (d16(v) ? (nikStructure(U.onlyDigits(v)) ? 0.95 : 0.8) : null),
        'regex', { group: 1, rule: 'nik-keyword' }),
      ...U.collect(text, KK, 'Indonesian Family Card (KK)', (v) => (d16(v) ? 0.95 : null), 'regex', { group: 1, rule: 'kk-keyword' }),
      ...U.collect(text, NPWP, 'Indonesian NPWP', 0.95, 'regex', { rule: 'npwp' }),
      ...U.collect(text, NPWP_KW, 'Indonesian NPWP', 0.92, 'regex', { group: 1, rule: 'npwp-keyword' }),
      ...U.collect(text, BPJS, 'Indonesian BPJS Number', 0.92, 'regex', { group: 1, rule: 'bpjs-keyword' }),
      ...U.collect(text, NIP, 'Indonesian Civil Servant Number (NIP)', (v) => (nipStructure(U.onlyDigits(v)) ? 0.95 : 0.75),
        'regex', { group: 1, rule: 'nip-keyword' }),
      ...U.collect(text, SIM, 'Indonesian Driving Licence (SIM)', (v) => (U.digitCount(v) >= 12 && U.digitCount(v) <= 14 ? 0.9 : null),
        'regex', { group: 1, rule: 'sim-keyword' }),
    ];
  }

  U.register('Indonesian NIK', detect);
})(globalThis);
