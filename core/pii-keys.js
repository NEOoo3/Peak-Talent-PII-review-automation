// Field names that say what a value is. One table serves two inputs:
//   - the task file name: "by-pii-type~~us_itin~~tax_ids.csv" (P.fileHint)
//   - a column header, JSON key or "Key:" label next to a value (P.structured)
// Names are compared after normalize(): lower case, every run of non-letters/digits -> "_".
//
// Mapping decisions (see docs/DETECTION-RULES.md, "Field and file-name hints"):
//   - us_itin -> US Social Security Number. The platform has no ITIN type; an ITIN has the SSN
//     shape (9XX-XX-XXXX) and identifies an individual taxpayer like an SSN does.
//   - passport_number / passport -> US Passport Number (the team's passport files are US ones).
//     A column called passport with no file hint stays the generic Passport Number.
(function (g) {
  'use strict';
  const P = g.PIIRA;

  const normalize = (s) => String(s || '').toLowerCase().normalize('NFC').replace(/[^\p{L}\p{M}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '');

  // [type, names]. More specific names first where two could match.
  const TYPE_KEYS = [
    ['US Bank Account/Routing Number', 'us_bank_number us_bank_account us_bank_account_number us_account_number routing_number routing aba aba_number aba_routing us_routing_number'],
    ['Bank Account Number', 'bank_account bank_account_number account_number account_no acct_no acct bank_acct in_bank_account bank_number nomor_rekening rekening'],
    ['IBAN', 'iban iban_code'],
    ['Payment Card Number', 'credit_card credit_card_number card_number debit_card payment_card cc_number pan_card_number'],
    ['Indian UPI ID', 'upi upi_id vpa'],
    ['Indian IFSC Code', 'ifsc ifsc_code'],
    ['Crypto Wallet Address', 'crypto crypto_wallet crypto_wallet_address crypto_address wallet wallet_address btc_address eth_address bitcoin_address ethereum_address'],
    ['US Social Security Number', 'us_ssn ssn social_security_number social_security us_itin itin itin_number taxpayer_identification_number'],
    ['US Employer Identification Number', 'us_ein ein fein employer_identification_number'],
    ['US Passport Number', 'us_passport us_passport_number'],
    ['Passport Number', 'passport_number passport passport_no in_passport indian_passport पासपोर्ट पासपोर्ट_नंबर'],
    ['Indonesian Passport Number', 'id_passport indonesian_passport paspor nomor_paspor'],
    ['US Driver Licence Number', 'us_driver_license us_driver_licence us_driving_license us_dl'],
    ['Driver Licence Number', 'driver_license driver_licence driving_license driving_licence dl_number licence_number license_number in_driving_license'],
    ['Indian Vehicle Number Plate', 'in_vehicle_registration in_vehicle_number vehicle_registration vehicle_registration_number vehicle_number vehicle_no vehicle_reg registration_plate'],
    ['Vehicle Number Plate', 'vehicle_plate number_plate license_plate licence_plate plate plate_number'],
    ['IMEI Number', 'imei imei_number'],
    ['Indian Aadhaar Number', 'in_aadhaar aadhaar aadhar aadhaar_number uidai'],
    ['Indian PAN (Business)', 'company_pan business_pan firm_pan'],
    ['Indian PAN (Individual)', 'in_pan pan pan_number permanent_account_number'],
    ['Indian GSTIN', 'in_gstin gstin gst gst_number gstin_number'],
    ['Indian TAN', 'in_tan tan tan_number'],
    ['Indian CIN', 'in_cin cin'],
    ['Indian UAN', 'in_uan uan'],
    ['Indian Voter ID', 'in_voter in_voter_id voter_id voter epic epic_number'],
    ['Brazilian CPF', 'br_cpf cpf'],
    ['Brazilian CNPJ', 'br_cnpj cnpj'],
    ['Brazilian RG', 'br_rg rg'],
    ['Brazilian CNH', 'br_cnh cnh'],
    ['Brazilian PIS/PASEP', 'br_pis pis pasep pis_pasep'],
    ['Brazilian Voter Registration', 'br_voter titulo_eleitor titulo_de_eleitor voter_registration'],
    ['Indonesian Family Card (KK)', 'kartu_keluarga kk no_kk nomor_kk nomor_kartu_keluarga family_card family_card_number id_kk'],
    ['Indonesian NIK', 'nik id_nik ktp no_ktp nomor_ktp nomor_induk_kependudukan'],
    ['Indonesian NPWP', 'npwp id_npwp'],
    ['Indonesian BPJS Number', 'bpjs bpjs_number no_bpjs'],
    ['Indonesian Civil Servant Number (NIP)', 'nip id_nip'],
    ['Indonesian Driving Licence (SIM)', 'sim id_sim nomor_sim surat_izin_mengemudi'],
    ['Anthropic API Key', 'anthropic_key anthropic_api_key'],
    ['OpenAI API Key', 'openai_key openai_api_key'],
    ['Stripe Key', 'stripe_key stripe_api_key stripe_secret_key'],
    ['AWS Access Key ID', 'aws_access_key aws_access_key_id'],
    ['AWS Secret Access Key', 'aws_secret_key aws_secret_access_key aws_secret'],
    ['Google API Key', 'google_api_key gcp_api_key'],
    ['Slack Token', 'slack_token slack_bot_token slack_key'],
    ['GitHub Token', 'github_token github_pat gh_token'],
    ['GitLab Token', 'gitlab_token gitlab_pat'],
    ['SendGrid Key', 'sendgrid_key sendgrid_api_key'],
    ['npm Token', 'npm_token'],
    ['PyPI Token', 'pypi_token'],
    ['Sentry Token', 'sentry_token sentry_auth_token'],
    ['JWT Token', 'jwt jwt_token'],
    ['Bearer Token', 'bearer_token'],
    ['Private Key Block', 'private_key ssh_private_key rsa_private_key pem_key'],
    ['Connection URL with Credentials', 'connection_string database_url db_url connection_url dsn'],
    ['SSH Key', 'ssh_key ssh_public_key public_key_openssh authorized_key'],
    ['VPC ID', 'vpc_id vpcid'],
    ['Cloud Account ID', 'aws_account_id aws_account cloud_account_id owner_account_id'],
    ['Card ID', 'card_id payment_method_id payment_method card_token'],
    ['Invocation ID', 'invocation_id execution_id function_execution_id lambda_request_id aws_request_id'],
    ['Transaction ID', 'transaction_id txn_id tx_id tx_hash txid transaction_hash transaction_ref utr utr_number'],
    ['Generic API Key', 'api_key apikey generic_api_key secret_key api_secret access_token auth_token client_secret'],
    ['Password', 'password passwd pwd pass_word'],
    ['Email Address', 'email email_address e_mail mail author_email owner_email user_email'],
    ['Indian Mobile Number', 'in_mobile in_mobile_number indian_mobile in_phone_number'],
    ['International Phone Number', 'international_phone intl_phone'],
    ['Contact Number', 'phone phone_number contact_number mobile mobile_number telephone tel contact_no'],
    ['GPS Coordinates', 'gps gps_coordinates coordinates lat_long latlng lat_lng'],
    ['Address', 'address street_address full_address shipping_address billing_address home_address alamat पता'],
    ['URL/Link', 'url link website'],
    ['MAC Address', 'mac mac_address'],
    ['IPv6 Address', 'ipv6 ipv6_address'],
    ['Public IPv4 Address', 'ip ip_address ipv4 ipv4_address'],
    ['GitHub Username', 'github_username github_user'],
    ['Person Username', 'username user_name user_handle handle'],
    ['Business Name', 'business_name company company_name organization organisation org_name employer'],
    ['Person Name', 'person person_name name full_name first_name last_name customer_name author author_name employee_name owner_name nama नाम ' +
      'nama_lengkap nama_depan nama_belakang nome nome_completo nombre nombre_completo nom_complet पूरा_नाम'],
    ['Postal Code', 'postal_code zip zip_code pincode pin_code'],
    ['Date of Birth', 'dob date_of_birth birth_date'],
  ];

  // Columns and fields whose values are never PII: departments, statuses, record keys.
  const NON_PII_KEYS = new Set(('department dept team division business_unit unit function status state_of_record priority category ' +
    'record_id row_id row_number index idx record ticket_id currency amount quantity count created_at updated_at timestamp ' +
    'is_active active enabled').split(' '));

  const SHORT_IDS = new Set('ssn itin ein cpf cnpj cnh nik kk nip npwp bpjs uan cin iban ifsc imei upi ip ipv4 ipv6 mac gstin vpa'.split(' '));

  const byKey = new Map();
  const ordered = [];
  for (const [type, names] of TYPE_KEYS) {
    for (const n of names.split(/\s+/)) {
      const k = normalize(n);
      if (!byKey.has(k)) { byKey.set(k, type); ordered.push([k, type]); }
    }
  }
  // Longest names first, so "us_bank_number" beats "bank_number" when matching a key's end.
  ordered.sort((a, b) => b[0].length - a[0].length);

  // Field names repeat on every row: remember the answer.
  const memo = new Map();
  /** The PII type a field name stands for, or null. "Support Us Bank Number" -> US Bank Account/Routing Number. */
  function typeOfKey(name) {
    if (memo.has(name)) return memo.get(name);
    const t = lookupKey(name);
    if (memo.size > 5000) memo.clear();
    memo.set(name, t);
    return t;
  }

  function lookupKey(name) {
    const k = normalize(name);
    if (!k) return null;
    if (byKey.has(k)) return byKey.get(k);
    // Trailing words "no", "number", "id", "value" do not change the type.
    const bare = k.replace(/_(?:no|nr|num|number|id|value|val)$/, '');
    if (bare !== k && byKey.has(bare)) return byKey.get(bare);
    // The name ends with a known name ("customer_us_bank_number", "primary_email").
    // Only multi-word or longer names, or an ID acronym: "file_name" is not a Person Name, "last_login"
    // not a username, but "nomor_nik" and "número_cpf" are a NIK and a CPF.
    for (const [n, type] of ordered) {
      if ((n.includes('_') || n.length >= 5 || SHORT_IDS.has(n)) && (k.endsWith('_' + n) || bare.endsWith('_' + n))) return type;
    }
    return null;
  }

  /** Is this field name one whose values are never PII (department, status, record id…)? */
  function nonPiiKey(name) {
    if (typeOfKey(name)) return false;
    const k = normalize(name);
    return NON_PII_KEYS.has(k) || NON_PII_KEYS.has(k.split('_').pop());
  }

  // Types that may stand in for each other: a hint or column of one of these
  // turns a detection of another into it ("Bank Account Number" in a us_bank_number file).
  const FAMILIES = [
    ['Passport Number', 'US Passport Number', 'Indonesian Passport Number'],
    ['Account Number', 'Bank Account Number', 'US Bank Account/Routing Number'],
    ['Driver Licence Number', 'US Driver Licence Number'],
    ['Vehicle Number Plate', 'Indian Vehicle Number Plate'],
    ['Contact Number', 'Indian Mobile Number', 'International Phone Number'],
    ['Indonesian NIK', 'Indonesian Family Card (KK)'],
    ['US Social Security Number', 'US Employer Identification Number'],
    ['Public IPv4 Address', 'Private IP Address', 'IPv6 Address', 'MAC Address'],
    ['Indian PAN (Individual)', 'Indian PAN (Business)'],
    ['Generic API Key', 'Bearer Token', 'Password', 'Anthropic API Key', 'OpenAI API Key', 'Stripe Key', 'AWS Access Key ID',
      'AWS Secret Access Key', 'Google API Key', 'Slack Token', 'GitHub Token', 'GitLab Token', 'SendGrid Key', 'npm Token',
      'PyPI Token', 'Sentry Token', 'JWT Token'],
  ];
  const familyOf = new Map();
  FAMILIES.forEach((f, i) => f.forEach((t) => familyOf.set(t, i)));
  const sameFamily = (a, b) => a === b || (familyOf.has(a) && familyOf.get(a) === familyOf.get(b));

  // Values a field or file name may claim must also be valid for the type, not just the right
  // length: the L2 shape checks (core/redaction-rules.js) are deliberately loose.
  const digitsOnly = (min, max) => (v) => /^[\d][\d .\/-]*\d$/.test(v) && v.replace(/\D/g, '').length >= min && v.replace(/\D/g, '').length <= max;
  const STRICT = {
    'US Social Security Number': (v) => /^(?!000|666)\d{3}([- ]?)(?!00)\d{2}\1(?!0000)\d{4}$/.test(v),
    'US Employer Identification Number': (v) => /^\d{2}-?\d{7}$/.test(v),
    'US Passport Number': (v) => /^(?=[A-Z0-9]{8,10}$)[A-Z]{0,3}\d{6,9}$/i.test(v),
    'Passport Number': (v) => /^[A-Z]{0,3}[ -]?\d{6,9}$/i.test(v),
    'Indonesian Passport Number': (v) => /^[A-Z]{1,2}[ -]?\d{6,7}$/i.test(v),
    'US Bank Account/Routing Number': digitsOnly(6, 17),
    'Bank Account Number': digitsOnly(8, 18),
    'Brazilian RG': (v) => /^[\dXx.\-]{7,13}$/.test(v) && v.replace(/\D/g, '').length >= 7,
    'Brazilian CNH': digitsOnly(11, 11),
    'Indonesian BPJS Number': digitsOnly(11, 13),
    'Indonesian Driving Licence (SIM)': digitsOnly(12, 14),
    'Indian Aadhaar Number': (v) => /^[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}$/.test(v),
    'AWS Secret Access Key': (v) => /^[A-Za-z0-9\/+]{40}$/.test(v) && /\d/.test(v) && /[A-Z]/.test(v) && /[a-z]/.test(v),
    'Driver Licence Number': (v) => /^[A-Z0-9][A-Z0-9 -]{4,18}[A-Z0-9]$/i.test(v) && /\d{3}/.test(v),
    'US Driver Licence Number': (v) => /^[A-Z0-9][A-Z0-9 -]{3,18}[A-Z0-9]$/i.test(v) && /\d{3}/.test(v),
    'Vehicle Number Plate': (v) => /^[A-Z0-9][A-Z0-9 -]{2,12}[A-Z0-9]$/i.test(v) && /\d/.test(v) && /[A-Z]/i.test(v),
    // Keys and tokens: their vendor format.
    'SendGrid Key': (t) => /^SG\.[\w-]{16,32}\.[\w-]{16,64}$/.test(t),
    'AWS Access Key ID': (t) => /^(?:AKIA|ASIA)[0-9A-Z]{16}$/.test(t),
    'GitHub Token': (t) => /^(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_\w{22,})$/.test(t),
    'GitLab Token': (t) => /^gl(?:pat|rt|ptt|dt|cbt|soat)-[\w-]{20,}$/.test(t),
    'Slack Token': (t) => /^xox[abpres]-[A-Za-z0-9-]{10,}$/.test(t),
    'Stripe Key': (t) => /^(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}$/.test(t),
    'npm Token': (t) => /^npm_[A-Za-z0-9]{36}$/.test(t),
    'PyPI Token': (t) => /^pypi-[\w-]{50,}$/.test(t),
    'OpenAI API Key': (t) => /^sk-(?!ant-)[\w-]{20,}$/.test(t),
    'Anthropic API Key': (t) => /^sk-ant-[\w-]{20,}$/.test(t),
    'Google API Key': (t) => /^AIza[\w-]{35}$/.test(t),
    'JWT Token': (t) => /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(t),
    'Generic API Key': (v) => /^\S{12,}$/.test(v) && /\d/.test(v) && /[A-Za-z]/.test(v),
    // The guide's cloud and payment references.
    'SSH Key': (t) => /^(?:ssh-(?:rsa|dss|ed25519)|ecdsa-sha2-nistp\d{3})\s+AAAA[A-Za-z0-9+\/]{20,}={0,3}(?:\s+\S+)?$/.test(t),
    'VPC ID': (t) => /^vpc-[0-9a-f]{8,17}$/.test(t),
    'Cloud Account ID': (t) => /^\d{12}$/.test(t),
    'Card ID': (t) => /^(?:card|pm|src|tok)_[A-Za-z0-9]{14,}$/.test(t) && /\d/.test(t),
    'Invocation ID': (t) => /^[A-Za-z0-9][\w-]{7,}$/.test(t) && /\d/.test(t),
    'Transaction ID': (t) => /^[A-Za-z0-9][\w-]{7,}$/.test(t) && /\d/.test(t),
  };

  /**
   * Does `value` have the shape of `type`? Uses the fixed-shape checks of the L2 rules
   * (core/redaction-rules.js). Types without a fixed shape need a stricter check here.
   */
  function fitsType(type, value) {
    const v = String(value || '').trim();
    if (!v || v.length > 200) return false;
    switch (type) {
      case 'Person Name': return /^\p{Lu}[\p{L}\p{M}.'’-]*(?:[ ]\p{Lu}[\p{L}\p{M}.'’-]*){0,4}$/u.test(v);
      case 'Business Name': return /^[\p{Lu}\d][\p{L}\p{M}\d&.,'’() -]{1,99}$/u.test(v) && !P.isDepartment(v);
      case 'Address': return /\d/.test(v) && /\p{L}{3,}/u.test(v) && v.split(/\s+/).length >= 3;
      // A "url" column or JSON key ("funding": {"url": …}) follows the same exceptions as the URL detector.
      case 'URL/Link': return !(P.isPublicUrl && P.isPublicUrl(v)) && P.redactionRules.sameType('URL/Link', v, type);
      default:
        if (STRICT[type] && !STRICT[type](v)) return false;
        return P.redactionRules.sameType(P.broadLabel(type), v, type);
    }
  }

  P.piiKeys = { normalize, typeOfKey, nonPiiKey, sameFamily, fitsType };

  // File-name types that differ from the same word as a column name: the team's
  // "passport_number" files are US passports (docs/DETECTION-RULES.md), a "passport" column is any passport.
  const HINT_TYPES = { passport_number: 'US Passport Number', passport: 'US Passport Number' };

  // ------------------------------------------------------------ the task file name

  /**
   * "by-pii-type~~us_bank_number~~records_0006.csv" -> {type, key, format, name}.
   * format: 'csv' | 'json' | 'txt' | 'pdf' | 'git-log' | null (from the extension or the path).
   * Returns null when the name carries no PII type.
   */
  function parse(fileName) {
    const name = String(fileName || '').trim();
    if (!name) return null;
    const parts = name.split(/~~|\//).map((p) => p.trim()).filter(Boolean);
    let type = null;
    let key = null;
    const markerAt = parts.findIndex((p) => /^by[-_]?pii[-_]?type$/i.test(p));
    const candidates = markerAt >= 0 ? parts.slice(markerAt + 1, markerAt + 2) : parts.slice(0, -1);
    for (const p of candidates) {
      const t = HINT_TYPES[normalize(p)] || byKey.get(normalize(p)) || null;
      if (t) { type = t; key = normalize(p); break; }
    }
    if (!type) return null;
    const lower = name.toLowerCase();
    const ext = (/\.([a-z0-9]{2,5})$/.exec(lower) || [])[1] || '';
    let format = null;
    if (/(?:^|~~|\/)\.git(?:~~|\/)/.test(lower) || /(?:~~|\/)logs(?:~~|\/)head$/.test(lower) || /(?:~~|\/)head$/.test(lower)) format = 'git-log';
    else if (['csv', 'tsv'].includes(ext)) format = 'csv';
    else if (['json', 'jsonl', 'ndjson'].includes(ext)) format = 'json';
    else if (ext === 'pdf') format = 'pdf';
    else if (ext) format = 'txt';
    return { type, key, format, name };
  }

  // A task file name as it appears on the page: "by-pii-type~~kartu_keluarga~~…", and any other project's
  // ("rai_codebase~~DK9__Zorvak~~app~~page.tsx-1a2b3c4d", "rai_apps~~zorvakapp~~…~~page_000123.jsonl-a1b2c3d4").
  const NAME_ON_PAGE = /by[-_]?pii[-_]?type~~[^\s"'<>]+/i;
  const ANY_NAME = /(?<![^\s"'(>—–:-])[A-Za-z0-9][\w.-]*(?:~~[^\s"'<>~]+)+/;
  const nameIn = (s) => { const m = NAME_ON_PAGE.exec(s) || ANY_NAME.exec(s); return m ? m[0] : ''; };

  /** Find the task's file name on the page (document title first, then visible text). */
  function findOnPage(doc, skip) {
    const t = doc && doc.title && nameIn(doc.title);
    if (t) return t;
    if (!doc || !doc.body || typeof doc.createTreeWalker !== 'function') return '';
    const w = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
    let seen = 0;
    for (let n = w.nextNode(); n && seen < 20000; n = w.nextNode(), seen++) {
      if (!n.data.includes('~~')) continue;
      if (skip && skip.some((el) => el && el.contains(n))) continue;
      const m = nameIn(n.data);
      if (m) return m;
    }
    return '';
  }

  P.fileHint = { parse, findOnPage };
})(globalThis);
