// The review site's labels, the PII types that fold into them, colours, and the
// tie-break order used when two detections cover the same text.
//
//  - A LABEL is what the reviewer puts on the right document (the site has 13).
//    Comparison with the right side, highlights and the panel's sections use labels.
//  - A TYPE is what a detector finds ("Indian GSTIN", "Stripe Key"…). Every type
//    belongs to one label; the panel shows the type next to the label.
// Colours here must match highlight.css.
(function (g) {
  'use strict';
  const P = g.PIIRA;

  // group: PI = PII – Personal, BI = PII – Business, CRED = PII – Credentials (highest risk).
  // "Overscrubbed" is a review label, not an entity.
  P.LABELS = [
    { name: 'Person Name', slug: 'person-name', color: '#43a047', group: 'PI' },
    { name: 'Person Username', slug: 'person-username', color: '#fb8c00', group: 'PI' },
    { name: 'Email Address', slug: 'email-address', color: '#1e88e5', group: 'PI' },
    { name: 'Contact Number', slug: 'contact-number', color: '#00897b', group: 'PI' },
    { name: 'Address', slug: 'address', color: '#8e24aa', group: 'PI' },
    { name: 'Date', slug: 'date', color: '#f9a825', group: 'PI' },
    { name: 'URL/Link', slug: 'url-link', color: '#0097a7', group: 'PI' },
    { name: 'Vehicle Number Plate', slug: 'vehicle-number-plate', color: '#7cb342', group: 'PI' },
    { name: 'Business Name', slug: 'business-name', color: '#3949ab', group: 'BI' },
    { name: 'Account Number', slug: 'account-number', color: '#e53935', group: 'CRED' },
    { name: 'Credentials', slug: 'credentials', color: '#ad1457', group: 'CRED' },
    { name: 'IP Address', slug: 'ip-address', color: '#6d4c41', group: 'CRED' },
    { name: 'Overscrubbed', slug: 'overscrubbed', color: '#757575', group: null },
  ];
  P.GROUP_NAMES = { PI: 'PII – Personal', BI: 'PII – Business', CRED: 'PII – Credentials' };
  P.GROUP_SHORT = { PI: 'Personal PII', BI: 'Business PII', CRED: 'a Credential' };

  // Every PII type from the team's list, and the site label it is labeled as.
  // scope 'out': the team's scope sheet says it is NOT PII (dates, postal codes). Their
  // detectors exist but are only reported when P.SETTINGS.reportOutOfScope is on.
  const T = (label, names, scope) => names.map((name) => ({ name, label, scope: scope || 'in' }));
  P.TYPES = [
    ...T('Person Name', ['Person Name']),
    ...T('Person Username', ['Person Username', 'GitHub Username']),
    ...T('Email Address', ['Email Address']),
    ...T('Contact Number', ['Contact Number', 'Indian Mobile Number', 'International Phone Number']),
    ...T('Address', ['Address', 'GPS Coordinates']),
    ...T('Address', ['Postal Code', 'Brazilian CEP', 'Indonesian Postal Code'], 'out'),
    // A plain date is out of scope; a date of birth is PII (PII/BII Annotation Guide: "Person DOB").
    ...T('Date', ['Date'], 'out'),
    ...T('Date', ['Date of Birth']),
    ...T('URL/Link', ['URL/Link']),
    ...T('Vehicle Number Plate', ['Vehicle Number Plate', 'Indian Vehicle Number Plate']),
    ...T('Business Name', ['Business Name']),
    ...T('Account Number', ['Account Number', 'Bank Account Number', 'IBAN', 'US Bank Account/Routing Number',
      'Payment Card Number', 'Indian UPI ID', 'Indian IFSC Code', 'Crypto Wallet Address']),
    ...T('IP Address', ['Public IPv4 Address', 'Private IP Address', 'IPv6 Address', 'MAC Address']),
    ...T('Credentials', [
      // government and tax IDs
      'Passport Number', 'Driver Licence Number', 'IMEI Number',
      'Indian Aadhaar Number', 'Indian PAN (Individual)', 'Indian PAN (Business)', 'Indian GSTIN', 'Indian TAN',
      'Indian CIN', 'Indian UAN', 'Indian Voter ID',
      'US Social Security Number', 'US Passport Number', 'US Employer Identification Number', 'US Driver Licence Number',
      'Brazilian CPF', 'Brazilian CNPJ', 'Brazilian RG', 'Brazilian CNH', 'Brazilian PIS/PASEP', 'Brazilian Voter Registration',
      'Indonesian NIK', 'Indonesian Family Card (KK)', 'Indonesian NPWP', 'Indonesian BPJS Number',
      'Indonesian Civil Servant Number (NIP)', 'Indonesian Passport Number', 'Indonesian Driving Licence (SIM)',
      // keys, tokens and passwords
      'Anthropic API Key', 'OpenAI API Key', 'Stripe Key', 'AWS Access Key ID', 'AWS Secret Access Key', 'Google API Key',
      'Slack Token', 'GitHub Token', 'GitLab Token', 'SendGrid Key', 'npm Token', 'PyPI Token', 'Sentry Token',
      'JWT Token', 'Bearer Token', 'Private Key Block', 'Connection URL with Credentials', 'Generic API Key', 'Password',
      // cloud and payment references (PII/BII Annotation Guide, "PII Credentials")
      'SSH Key', 'Cloud Account ID', 'VPC ID', 'Card ID', 'Invocation ID', 'Transaction ID',
    ]),
  ];

  // When two detections cover exactly the same length of text, the type that
  // appears earlier in this list wins (more specific first). Types not listed come last.
  P.SPECIFICITY = [
    'Private Key Block', 'Connection URL with Credentials', 'Anthropic API Key', 'OpenAI API Key', 'Stripe Key',
    'AWS Access Key ID', 'Google API Key', 'Slack Token', 'GitHub Token', 'GitLab Token', 'SendGrid Key', 'npm Token',
    'PyPI Token', 'Sentry Token', 'JWT Token', 'AWS Secret Access Key', 'Bearer Token',
    'SSH Key', 'Card ID', 'VPC ID', 'Cloud Account ID', 'Invocation ID', 'Transaction ID',
    'Email Address', 'Indian UPI ID', 'URL/Link', 'Crypto Wallet Address',
    'Indian GSTIN', 'Indian CIN', 'Brazilian CNPJ', 'Brazilian CPF', 'Brazilian PIS/PASEP', 'Indonesian NPWP',
    'Indonesian Civil Servant Number (NIP)', 'Indonesian Family Card (KK)', 'Indonesian NIK', 'Indonesian BPJS Number',
    'Indonesian Driving Licence (SIM)', 'Indonesian Passport Number', 'Brazilian CNH', 'Brazilian Voter Registration',
    'Brazilian RG', 'US Social Security Number', 'US Employer Identification Number', 'US Passport Number',
    'US Driver Licence Number', 'US Bank Account/Routing Number', 'Indian UAN', 'IMEI Number',
    'IBAN', 'Bank Account Number', 'Payment Card Number', 'Indian IFSC Code', 'Indian PAN (Business)',
    'Indian PAN (Individual)', 'Indian TAN', 'Indian Aadhaar Number', 'Passport Number', 'Driver Licence Number',
    'Indian Voter ID', 'Indian Vehicle Number Plate', 'Vehicle Number Plate', 'Account Number', 'Generic API Key', 'Password',
    'MAC Address', 'IPv6 Address', 'Private IP Address', 'Public IPv4 Address', 'GPS Coordinates',
    'Indian Mobile Number', 'International Phone Number', 'Contact Number', 'GitHub Username', 'Person Username',
    'Date of Birth', 'Date', 'Address', 'Postal Code', 'Brazilian CEP', 'Indonesian Postal Code', 'Business Name', 'Person Name',
  ];

  // Key used in the panel's show/hide set for the RIGHT-side overscrub marks.
  P.RIGHT_OVERSCRUB_KEY = 'Possible overscrub (right)';
  // Key for the marks on names from the business names list (not PII).
  P.KNOWN_NAMES_KEY = 'Known names (not PII)';

  // Project rules.
  P.SETTINGS = {
    // Dates (not dates of birth) and postal codes are out of scope: not reported, and
    // labeling them on the right is reported as a possible overscrub. Turn on to report them.
    reportOutOfScope: false,
    // A trailing PIN code belongs to the multi-line address block it ends (a shipping label's
    // "Kanpur Nagar, Uttar Pradesh - 208011"). Inline addresses and PIN codes on their own still leave it out.
    addressIncludesPin: true,
  };

  // Department / team names. They name a part of an organisation, never a person or a company,
  // so they are never PII ("Field Services", "People Ops"), in any column or sentence.
  P.DEPARTMENTS = new Set(('support|customer support|customer success|customer service|logistics|procurement|purchasing|finance|' +
    'accounts|accounting|accounts payable|accounts receivable|people ops|people operations|people|hr|human resources|talent|' +
    'recruiting|recruitment|field services|field service|field operations|compliance|operations|ops|legal|sales|marketing|' +
    'engineering|it|it services|information technology|admin|administration|facilities|security|information security|' +
    'quality|quality assurance|qa|research|r&d|research and development|product|design|data|analytics|risk|audit|internal audit|' +
    'treasury|payroll|strategy|partnerships|growth|infrastructure|devops|platform|shared services|professional services|' +
    'managed services|technical services|business development|supply chain|warehouse|dispatch|billing|collections|' +
    'customer care|helpdesk|service desk|training|communications|public relations|pr|executive|management').split('|'));
  // Words of invoice, form and table headings ("Goods and Services", "Mode/Terms of Payment",
  // "Delivery Note", "Godown Address"). A phrase made only of these is a heading, never a name or address.
  P.DOC_WORDS = new Set(('goods services service products product items item terms conditions payment payments delivery ' +
    'dispatch shipping shipment note notes mode reference references ref invoice invoices bill billing dated date description ' +
    'quantity qty rate rates amount amounts total totals subtotal tax taxes taxable gst cgst sgst igst hsn sac discount disc ' +
    'charges charge freight order orders purchase sales sale buyer buyers seller sellers consignee consignor supplier suppliers ' +
    'vendor details particulars remarks other others destination dispatched through declaration signature authorised authorized ' +
    'signatory godown warehouse unit units per no number summary balance due price prices value values net gross').split(' '));
  /** Is every word of `text` heading vocabulary ("Goods and Services")? Joiners (and, of, &, /) are ignored. */
  P.isDocPhrase = (text) => {
    const words = String(text || '').toLowerCase().split(/[^a-z]+/).filter((w) => w && !/^(?:and|of|the|for|to|&)$/.test(w));
    return words.length > 0 && words.every((w) => P.DOC_WORDS.has(w));
  };

  /** Is `text` a department / team name ("Field Services", "PEOPLE OPS")? */
  P.isDepartment = (text) => P.DEPARTMENTS.has(String(text || '').toLowerCase().replace(/[\s_]+/g, ' ').replace(/\s+(?:dept|department|team)\.?$/, '').trim());

  // Detections below this confidence are reported as NEEDS REVIEW.
  P.REVIEW_THRESHOLD = 0.7;

  // ---------- Label sets
  // "standard": the site's 13 labels above; every type folds into one of them.
  // "golden":   the Golden project. Next to the 13, the site has a label for every type of the PII type
  //             list, named exactly like the type here, so each value is labeled with its own type
  //             ("Indian Aadhaar Number", not "Credentials"). Colours are the site's own (its label legend).
  const GOLDEN = [
    ['Anthropic API Key', '#20a164'], ['AWS Access Key ID', '#fa8c16'], ['AWS Secret Access Key', '#722ed1'],
    ['Bank Account Number', '#faad14'], ['Bearer Token', '#ff936f'], ['Brazilian CEP', '#13c2c2'], ['Brazilian CNH', '#eb2f96'],
    ['Brazilian CNPJ', '#a0d911'], ['Brazilian CPF', '#a0d911'], ['Brazilian PIS/PASEP', '#2f54eb'], ['Brazilian RG', '#20a164'],
    ['Brazilian Voter Registration', '#eb2f96'], ['Connection URL with Credentials', '#2f54eb'], ['Crypto Wallet Address', '#a0d911'],
    ['Date of Birth', '#2f54eb'], ['Driver Licence Number', '#1677ff'], ['Generic API Key', '#f5222d'], ['GitHub Token', '#13c2c2'],
    ['GitHub Username', '#1677ff'], ['GitLab Token', '#f5222d'], ['Google API Key', '#f5222d'], ['GPS Coordinates', '#20a164'],
    ['IBAN', '#13c2c2'], ['IMEI Number', '#eb2f96'], ['Indian Aadhaar Number', '#722ed1'], ['Indian CIN', '#722ed1'],
    ['Indian GSTIN', '#2f54eb'], ['Indian IFSC Code', '#a0d911'], ['Indian Mobile Number', '#fa8c16'], ['Indian PAN (Business)', '#20a164'],
    ['Indian PAN (Individual)', '#ff936f'], ['Indian TAN', '#13c2c2'], ['Indian UAN', '#a0d911'], ['Indian UPI ID', '#f5222d'],
    ['Indian Vehicle Number Plate', '#eb2f96'], ['US Social Security Number', '#fa8c16'], ['US Passport Number', '#eb2f96'],
    ['US Employer Identification Number', '#1677ff'], ['US Driver Licence Number', '#ff936f'], ['US Bank Account/Routing Number', '#a0d911'],
    ['Stripe Key', '#fa8c16'], ['Slack Token', '#faad14'], ['Sentry Token', '#20a164'], ['SendGrid Key', '#faad14'], ['PyPI Token', '#1677ff'],
    ['Public IPv4 Address', '#eb2f96'], ['Private Key Block', '#13c2c2'], ['Private IP Address', '#1677ff'], ['Postal Code', '#f5222d'],
    ['Payment Card Number', '#fa8c16'], ['Password', '#ff936f'], ['Passport Number', '#ff936f'], ['OpenAI API Key', '#fa8c16'],
    ['npm Token', '#2f54eb'], ['MAC Address', '#fa8c16'], ['JWT Token', '#ff936f'], ['IPv6 Address', '#faad14'],
    ['International Phone Number', '#faad14'], ['Indonesian Postal Code', '#20a164'], ['Indonesian Passport Number', '#faad14'],
    ['Indonesian NPWP', '#722ed1'], ['Indonesian NIK', '#722ed1'], ['Indonesian Family Card (KK)', '#2f54eb'],
    ['Indonesian Driving Licence (SIM)', '#722ed1'], ['Indonesian Civil Servant Number (NIP)', '#13c2c2'],
    ['Indonesian BPJS Number', '#f5222d'], ['Indian Voter ID', '#1677ff'],
  ];
  // The 13 labels, in the Golden site's colours.
  const GOLDEN_BASE_COLORS = {
    'Account Number': '#722ed1', Address: '#f5222d', 'Business Name': '#13c2c2', 'Contact Number': '#fa8c16', Credentials: '#ff936f',
    Date: '#eb2f96', 'Email Address': '#20a164', 'IP Address': '#a3fff7', Overscrubbed: '#ffe3e3', 'Person Name': '#1677ff',
    'URL/Link': '#faad14', 'Person Username': '#2f54eb', 'Vehicle Number Plate': '#a0d911',
  };
  // Types with no label of their own, per the PII type list: a phone number other than an Indian
  // mobile is "phone_international"; a bank account other than an IBAN or US number is "bank_account".
  // The guide's credential types with no Golden label take the nearest one: a card reference ("card_1NqX…") is a
  // Payment Card Number, an SSH public key a Generic API Key. VPC, cloud account, invocation and transaction IDs
  // have no nearer label than Credentials.
  const GOLDEN_FALLBACK = { 'Contact Number': 'International Phone Number', 'Account Number': 'Bank Account Number',
    'Card ID': 'Payment Card Number', 'SSH Key': 'Generic API Key' };
  // The PII type list's own names ("pan_business", "titulo_eleitor"…), for sites that label with them.
  P.TYPE_KEYS = {
    full_name: 'Person Name', dob: 'Date of Birth', address: 'Address', indian_mobile: 'Indian Mobile Number', email: 'Email Address',
    postal_code: 'Postal Code', phone_international: 'International Phone Number', kodepos: 'Indonesian Postal Code', cep: 'Brazilian CEP',
    company_name: 'Business Name', tan: 'Indian TAN', gstin: 'Indian GSTIN', cnpj: 'Brazilian CNPJ', ein: 'US Employer Identification Number',
    pan_business: 'Indian PAN (Business)', npwp: 'Indonesian NPWP', cin: 'Indian CIN', bank_account: 'Bank Account Number', iban: 'IBAN',
    ifsc: 'Indian IFSC Code', credit_card: 'Payment Card Number', crypto_wallet: 'Crypto Wallet Address',
    us_bank_number: 'US Bank Account/Routing Number', upi_id: 'Indian UPI ID', github_login: 'GitHub Username', url: 'URL/Link',
    internal_ip: 'Private IP Address', imei: 'IMEI Number', gps_coordinates: 'GPS Coordinates', ipv4: 'Public IPv4 Address',
    ipv6: 'IPv6 Address', mac_address: 'MAC Address', uan: 'Indian UAN', in_voter_id: 'Indian Voter ID', pan_number: 'Indian PAN (Individual)',
    aadhaar: 'Indian Aadhaar Number', in_vehicle_registration: 'Indian Vehicle Number Plate', us_driver_license: 'US Driver Licence Number',
    ssn: 'US Social Security Number', us_passport: 'US Passport Number', cpf: 'Brazilian CPF', titulo_eleitor: 'Brazilian Voter Registration',
    rg: 'Brazilian RG', pis_pasep: 'Brazilian PIS/PASEP', cnh: 'Brazilian CNH', nik: 'Indonesian NIK', bpjs: 'Indonesian BPJS Number',
    kartu_keluarga: 'Indonesian Family Card (KK)', sim_id: 'Indonesian Driving Licence (SIM)', nip_asn: 'Indonesian Civil Servant Number (NIP)',
    id_passport: 'Indonesian Passport Number', driver_license: 'Driver Licence Number', passport_number: 'Passport Number',
    bearer_token: 'Bearer Token', stripe_key: 'Stripe Key', generic_api_key: 'Generic API Key', anthropic_api_key: 'Anthropic API Key',
    aws_secret_key: 'AWS Secret Access Key', sendgrid_key: 'SendGrid Key', npm_token: 'npm Token', password: 'Password',
    google_api_key: 'Google API Key', slack_token: 'Slack Token', dsn_with_credentials: 'Connection URL with Credentials',
    jwt_token: 'JWT Token', aws_access_key: 'AWS Access Key ID', github_token: 'GitHub Token', gitlab_token: 'GitLab Token',
    pypi_token: 'PyPI Token', sentry_token: 'Sentry Token', openai_api_key: 'OpenAI API Key', private_key_block: 'Private Key Block',
  };

  const slugOf = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const typeByName = new Map(P.TYPES.map((t) => [t.name, t]));
  for (const l of P.LABELS) {
    l.base = l.name;
    l.colors = { standard: l.color, golden: GOLDEN_BASE_COLORS[l.name] || l.color };
  }
  const baseByName = new Map(P.LABELS.map((l) => [l.name, l]));
  for (const [name, color] of GOLDEN) {
    const base = (typeByName.get(name) || {}).label || 'Credentials';
    const b = baseByName.get(base);
    P.LABELS.push({ name, slug: slugOf(name), color: b.color, group: b.group, golden: true, base, colors: { standard: b.color, golden: color } });
  }
  const goldenNames = new Set(GOLDEN.map(([n]) => n));

  let labelSet = 'standard';
  P.SETTINGS.labelSet = labelSet;
  /** 'standard' (13 labels) or 'golden' (a label per type). */
  P.labelSet = () => labelSet;
  /** Switch label sets. Returns true when it changed (the caller re-analyses). */
  P.setLabelSet = (set) => {
    const next = set === 'golden' ? 'golden' : 'standard';
    if (next === labelSet) return false;
    labelSet = next;
    for (const l of P.LABELS) l.color = l.colors[labelSet] || l.colors.standard;
    P.SETTINGS.labelSet = labelSet;
    P.SETTINGS.labelMode = labelSet === 'golden' ? 'types' : 'broad';
    // The PII type list: pincode, state, city and country are not PII, so an address stops before the PIN.
    P.SETTINGS.addressIncludesPin = labelSet !== 'golden';
    return true;
  };
  // The 2.7.0 names for the same thing (its detectors and compare.js use them): 'types' mode is the Golden set.
  P.SETTINGS.labelMode = 'broad';
  P.setLabelMode = (mode) => P.setLabelSet(mode === 'types' ? 'golden' : 'standard');
  /** The labels of the current set, in display order. */
  P.activeLabels = () => (labelSet === 'golden' ? P.LABELS : P.LABELS.filter((l) => !l.golden));
  /** Names of the labels that exist only on the Golden site (used to recognise it). */
  P.GOLDEN_ONLY = goldenNames;

  const byName = new Map(P.LABELS.map((l) => [l.name, l]));
  const rank = new Map(P.SPECIFICITY.map((n, i) => [n, i]));
  P.labelGroup = (name) => (byName.get(name) || {}).group || null;
  P.labelInfo = (name) => byName.get(name) || { name, slug: 'unknown', color: '#9e9e9e' };
  /** The 13-label family of a label ("Indian Aadhaar Number" -> "Credentials"); rules written per family use it. */
  P.baseLabel = (name) => (byName.get(name) || {}).base || (typeByName.get(name) || {}).label || name;
  P.broadLabel = P.baseLabel;
  /** A colour dark enough to read as text or an underline (some Golden colours are pastel). */
  P.labelInk = (name) => {
    const c = P.labelInfo(name).color;
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
    if (!m) return c;
    const [r, gg, b] = m.slice(1).map((x) => parseInt(x, 16));
    if (0.2126 * r + 0.7152 * gg + 0.0722 * b < 190) return c;
    const dark = (x) => Math.round(x * 0.55).toString(16).padStart(2, '0');
    return `#${dark(r)}${dark(gg)}${dark(b)}`;
  };
  P.typeInfo = (name) => typeByName.get(name) || null;
  /** The site label a type is labeled as (a label maps to itself). */
  P.labelOfType = (name) => {
    if (labelSet === 'golden') {
      if (goldenNames.has(name)) return name;
      if (GOLDEN_FALLBACK[name]) return GOLDEN_FALLBACK[name];
    }
    return (typeByName.get(name) || {}).label || name;
  };
  /** Is this type reported with the current settings? Unknown names are. */
  P.typeReported = (name) => {
    const t = typeByName.get(name);
    return !t || t.scope === 'in' || Boolean(P.SETTINGS.reportOutOfScope);
  };
  /** "Credentials (Indian GSTIN)" for a detection or finding with a type, else its label. */
  P.describe = (d) => {
    const base = d.type && d.type !== d.label ? `${d.label} (${d.type})` : d.label;
    // On-device model: say where a suggestion came from.
    if (d.source === 'model') return `${base} [model, ${Math.round(((d.model && d.model.score) || 0) * 100)}%]`;
    if (d.model && !d.model.agrees) return `${base} [model suggests ${d.model.label}, ${Math.round(d.model.score * 100)}%]`;
    // Information only: many private people share a famous name.
    if (d.kb && d.kb.publicFigure) return `${base} [also a public figure]`;
    return base;
  };
  P.specificityRank = (name) => (rank.has(name) ? rank.get(name) : P.SPECIFICITY.length);
})(globalThis);
