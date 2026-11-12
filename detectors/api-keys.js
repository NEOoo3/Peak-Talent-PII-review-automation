// Keys, tokens and secrets (Credentials on the 13-label site, a label per type on the Golden site). The most specific type wins:
// a vendor prefix first ("sk-ant-" is an Anthropic key, not an OpenAI one), then a
// value assigned to a key-like field name (Generic API Key).
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const U = P.util;

  // api_key=…  secret: …  access token - …  client_secret="…"  (a value of 8+ characters)
  // A prefix joined by "_" is allowed: STRIPE_SECRET_KEY=…, GITHUB_TOKEN=… (environment files).
  const KEY_VALUE = new RegExp(
    String.raw`(?<![A-Za-z0-9])(api[_ \t-]?key|api[_ \t-]?secret|app[_ \t-]?secret|signing[_ \t-]?(?:key|secret)|secret(?:[_ \t-]?key)?|client[_ \t-]?secret|(?:(?:access|auth|refresh|bearer|session|oauth|fcm|id)[_ \t-]?)?token|private[_ \t-]?key|access[_ \t-]?key(?:[_ \t-]?id)?|signature)\b["']?[ \t]*(?:is[ \t]*:?|[:=]|-(?=[ \t]))[ \t]*["']?([^\s,;"']{8,})`,
    'gid'
  );
  // A hex key or token (SHA-style, 32-128 hex digits) named as a key, secret, token, salt, HMAC or signature:
  // "hmac_key = 9f86d0…", "SHA_KEY: 2c26b4…", "session token 5d4140…". A file checksum or a commit id is not a
  // secret ("sha256: …", "commit 3f7868…", "checksum = …", lockfile hashes): those names are not accepted.
  const HEX_KEY = new RegExp(
    String.raw`(?<![A-Za-z0-9])(?!public)((?:[A-Za-z0-9]+[_ \t-]?)?(?:key|secret|token|hmac|salt|signature))\b["']?[ \t]*(?:is[ \t]*:?|[:=]|-(?=[ \t]))?[ \t]*["']?([0-9a-fA-F]{32,128})(?![0-9A-Za-z])`,
    'gid'
  );
  const BEARER = /\bBearer[ \t]+([A-Za-z0-9._~+\/-]{16,}=*)/gd;
  // aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY (40 characters)
  const AWS_SECRET = /\b(?:aws[_ \t-]?)?secret[_ \t-]?access[_ \t-]?key\b["']?[ \t]*[:=][ \t]*["']?([A-Za-z0-9\/+]{40})(?![A-Za-z0-9\/+])/gid;

  // [regex, type, rule] — vendor formats. Order does not matter: the overlap rules pick
  // the longest match, then the most specific type (core/labels.js SPECIFICITY).
  const KNOWN_KEYS = [
    [/\bsk-ant-[A-Za-z0-9_-]{20,}/gd, 'Anthropic API Key', 'key-anthropic'],
    [/\bsk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/gd, 'OpenAI API Key', 'key-openai'],
    // The PII type list: sk_live_, sk_test_, rk_live_, rk_test_. A publishable key (pk_) is public, not a secret.
    [/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/gd, 'Stripe Key', 'key-stripe'],
    [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gd, 'AWS Access Key ID', 'key-aws'],
    [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/gd, 'GitHub Token', 'key-github'],
    [/\bgithub_pat_[A-Za-z0-9_]{22,}\b/gd, 'GitHub Token', 'key-github-pat'],
    [/\bgl(?:pat|rt|ptt|dt|cbt|soat)-[A-Za-z0-9_-]{20,}/gd, 'GitLab Token', 'key-gitlab'],
    [/\bAIza[0-9A-Za-z_-]{35}\b/gd, 'Google API Key', 'key-google'],
    [/\bxox[abpres]-[A-Za-z0-9-]{10,}/gd, 'Slack Token', 'key-slack'],
    [/\bSG\.[A-Za-z0-9_-]{16,32}\.[A-Za-z0-9_-]{16,64}/gd, 'SendGrid Key', 'key-sendgrid'],
    [/\bnpm_[A-Za-z0-9]{36}\b/gd, 'npm Token', 'key-npm'],
    [/\bpypi-[A-Za-z0-9_-]{50,}/gd, 'PyPI Token', 'key-pypi'],
    [/\bsntry[su]_[A-Za-z0-9+\/=_-]{20,}/gd, 'Sentry Token', 'key-sentry'],
    [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/gd, 'JWT Token', 'key-jwt'],
    [/-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----[\s\S]+?-----END (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/gd, 'Private Key Block', 'key-private'],
    // Other vendor marks seen in the team's data (Razorpay, Google OAuth, Shopify, Brevo, Hugging Face, Docker).
    [/\b(?:rzp_(?:live|test)_[A-Za-z0-9]{14,}|GOCSPX-[A-Za-z0-9_-]{20,}|shp(?:at|ss|ca|pa)_[a-fA-F0-9]{32}|xkeysib-[a-f0-9]{64}-[A-Za-z0-9]{16}|hf_[A-Za-z0-9]{30,}|dckr_pat_[A-Za-z0-9_-]{20,})/gd, 'Generic API Key', 'key-vendor'],
  ];

  // The value of a key-like field: 20+ characters with a digit, or 8+ with a digit,
  // mixed case or a symbol. Plain words ("token: expired") are left to a human.
  function genericScore(v) {
    if (/^(?:true|false|null|none|undefined|redacted|xxx+|\*+)$/i.test(v)) return null;
    if (v.length >= 20 && /\d/.test(v)) return 0.9;
    if (/\d/.test(v) || (/[A-Z]/.test(v) && /[a-z]/.test(v)) || /[^A-Za-z]/.test(v)) return 0.85;
    return 0.55;
  }

  function detect(text) {
    const out = [
      ...U.collect(text, KEY_VALUE, 'Generic API Key', (v, m, s, e) => (U.codeValue(text, s, e, m[1]) || U.insideUrl(text, m.index) ? null : genericScore(v)),
        'regex', { group: 2, trim: true, rule: 'key-value' }),
      ...U.collect(text, HEX_KEY, 'Generic API Key', (v) => (/\d/.test(v) && /[a-f]/i.test(v) ? 0.9 : null),
        'regex', { group: 2, rule: 'key-hex' }),
      ...U.collect(text, BEARER, 'Bearer Token', 0.95, 'regex', { group: 1, rule: 'key-bearer' }),
      ...U.collect(text, AWS_SECRET, 'AWS Secret Access Key', 0.95, 'regex', { group: 1, rule: 'key-aws-secret' }),
    ];
    const vendor = [];
    for (const [re, type, rule] of KNOWN_KEYS) vendor.push(...U.collect(text, re, type, 0.95, 'regex', { rule }));
    // Only whole vendor keys count as "complete on one line"; a generic "API_KEY=" match of the first
    // line's half must not stop the wrapped key from being joined.
    return out.concat(vendor, wrapped(text, vendor));
  }

  // A key wrapped onto the next line (PDF text, narrow panels): "SG.4LAf…Fawiqw" / "G87y…giz4".
  // Joins the word ending one line with the word starting the next, one line break at a time,
  // and keeps a vendor match only if it runs across that break and was not found whole.
  const VENDOR_START = /^(?:SG\.|sk-|[sr]k_|AKIA|ASIA|gh[pousr]_|github_pat_|gl(?:pat|rt|ptt|dt|cbt|soat)-|AIza|xox[abpres]-|npm_|pypi-|sntry|eyJ|-----BEGIN|rzp_|GOCSPX-|shp|xkeysib-|hf_|dckr_)/;

  function wrapped(text, found) {
    const extra = [];
    const re = /[A-Za-z0-9_.\-]\r?\n(?=[A-Za-z0-9_.\-])/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const brk = m.index + 1;               // first char of the line break
      const next = brk + m[0].length - 1;    // first char of the next line
      // The word before the break (at most 200 characters back) must start like a vendor key.
      let a = brk;
      while (a > 0 && brk - a < 200 && !/[\s=:"'(]/.test(text[a - 1])) a--;
      if (!VENDOR_START.test(text.slice(a, brk))) continue;
      const tail = /^[^\s]{0,200}/.exec(text.slice(next, next + 200))[0];
      const joined = text.slice(a, brk) + tail;
      const cut = brk - a;                   // offset of the join in `joined`
      for (const [kre, type, rule] of KNOWN_KEYS) {
        for (const d of U.collect(joined, kre, type, 0.93, 'regex', { rule: `${rule}-wrapped` })) {
          if (!(d.start < cut && d.end > cut)) continue;
          const start = a + d.start;
          const end = next + (d.end - cut);
          // Complete on its own line: the next line is something else ("…giz4" / "MAIL_FROM=…").
          if (found.some((f) => f.start === start || (f.start <= start && f.end >= end))) continue;
          extra.push(U.make(text, start, end, type, 0.93, 'regex', `${rule}-wrapped`));
        }
      }
    }
    return extra;
  }

  U.register('Generic API Key', detect);
})(globalThis);
