// Email Address: personal and official addresses alike.
//   - free mail providers (gmail, yahoo, outlook, rediff …) and personal work addresses: high confidence
//   - role mailboxes (sales@, info@, support@, hr@ …): slightly lower, still PII of the company
// Dummy domains (example.com, *.test …) are placeholder data and never flagged.
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const U = P.util;

  // local-part @ domain labels . TLD(2-24 letters). Lookarounds stop us from
  // starting mid-word or ending inside a longer domain.
  const EMAIL = /(?<![\w.%+-])[A-Za-z0-9][A-Za-z0-9._%+-]{0,63}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,62})(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}(?![\w-]|\.[A-Za-z0-9])/gd;

  const FREE_MAIL = /^(?:gmail|googlemail|yahoo|ymail|rocketmail|outlook|hotmail|live|msn|icloud|me|mac|aol|proton|protonmail|pm|rediffmail|rediff|zoho|zohomail|gmx|mail|yandex|tutanota|fastmail|inbox|hey)\.[a-z.]{2,}$/i;
  const ROLE = /^(?:info|sales|support|help|helpdesk|contact|contactus|enquiry|enquiries|inquiry|hr|careers|jobs|recruitment|admin|office|team|hello|billing|accounts|finance|marketing|press|media|legal|compliance|security|noreply|no-reply|donotreply|service|services|customercare|care|feedback|orders|booking|bookings|reservations|partners|vendor|vendors|procurement|ops|operations|it|tech|webmaster|postmaster|abuse|privacy|grievance|nodal|escalation|cs|crm|official)(?:[._-][a-z0-9]+)*$/i;

  const LABEL = 'Email Address';

  /** Confidence and rule name for an address. */
  function classify(email) {
    const [local, domain] = email.split('@');
    if (ROLE.test(local)) return [0.92, 'email-role'];
    if (FREE_MAIL.test(domain)) return [0.95, 'email-personal'];
    return [0.9, 'email-work'];
  }

  function detect(text) {
    const out = [];
    EMAIL.lastIndex = 0;
    let m;
    while ((m = EMAIL.exec(text)) !== null) {
      const v = m[0];
      if (/\.\./.test(v) || U.isDummyDomain(v.split('@')[1])) continue;
      // "https://key@o0.ingest.sentry.io/0", "postgres://user:pass@host": the part of a link before "@" is not an e-mail.
      if (U.insideUrl(text, m.index)) continue;
      // "git@github.com:acme/payments.git": a repository address (URL/Link), not an e-mail.
      if (/^(?:git|hg|svn)@/i.test(v) && /^:[\w.~-]/.test(text.slice(m.index + v.length, m.index + v.length + 2))) continue;
      const [c, rule] = classify(v);
      out.push(U.make(text, m.index, m.index + v.length, LABEL, c, 'regex', rule));
    }
    return out;
  }

  U.register(LABEL, detect);
})(globalThis);
