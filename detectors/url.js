// URL/Link: web addresses of a person or organisation (profiles, document links, internal
// tools, company sites). Skipped: dummy domains and the domains in data/whitelisted-domains.js.
// Connection URL with Credentials: a URL with a user name and password in it
// (postgres://user:pass@host/db) — labeled Credentials.
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const U = P.util;

  // https://… · ftp://… · s3://… · www.… · a common-TLD domain followed by a path (linkedin.com/in/ravi, bit.ly/3xY),
  // in any case (HTTPS://WWW.ACME.COM/ABOUT).
  const TLDS = 'com|in|org|net|io|co|ai|dev|app|me|gov|edu|info|biz|us|uk|id|br|xyz|tech|site|online|cloud|ly|gle|gl|to|tv|cc|so|page|blog|store|shop|live|ca|au|de|fr|jp|sg|ae|nz';
  // Path characters; a backslash only as JSON's escaped slash ("https:\/\/…"), never "\n" / "\t" written in JSON text.
  const PC = String.raw`(?:[^\s<>"'${'`'}\\]|\\(?![nrtu"\\]))`;
  const URL_RE = new RegExp(String.raw`(?<![\w@.\/-])(?:(?:https?|ftp|sftp|ssh|s3|gs|wss?):(?:\/\/|\\\/\\\/)${PC}+|file:\/\/\/${PC}+|www\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+${PC}*|[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:${TLDS})(?:\/|\\\/)${PC}*)`, 'gid');
  // A bare domain with no path ("priyasharma.dev") only where the text says it is a site: "Portfolio:", "Website",
  // "visit", "W:" — a word like "done.in" in a sentence is not a link.
  const BARE = new RegExp(String.raw`(?<![\w@.\/-])[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)*\.(?:${TLDS})(?:\.(?:in|uk|au|br|id|sg|nz))?(?![\w\/@-]|\.\w)`, 'gid');
  const GIT_SSH = /(?<![\w.@-])(?:git|hg)@[A-Za-z0-9.-]+\.[A-Za-z]{2,}:[\w.~-]+\/[\w.~\/-]+/gd;
  const SITE_BEFORE = /(?:web[ \t]*site|site|portfolio|blog|homepage|home[ \t]+page|domain|url|link|web|visit|w|online at|find (?:me|us) at)[ \t]*[:\-–]*[ \t]*$/i;
  // Weaker context ("is at app.acme-corp.com", "via"): only common site endings, since code reads "based on user.id".
  const WEAK_BEFORE = /(?:(?:is[ \t]+)?(?:at|on|via)|go[ \t]+to|open|login[ \t]+(?:at|to)|available[ \t]+at|hosted[ \t]+(?:at|on))[ \t]*[:\-–]*[ \t]*$/i;
  const COMMON_SITE = /\.(?:com|in|org|net|edu|gov|co\.in|co\.uk|org\.in|ac\.in|gov\.in)$/i;
  // A host with a subdomain ("app.acme-corp.com", "shop.ravitraders.in") reads as a site even without context.
  const SUBDOMAIN_HOST = /^[a-z0-9-]+\.[a-z0-9-]+\.(?:com|in|org|net|edu|gov)$/i;
  const CONN = /(?<![\w+.-])(?:[a-z][a-z0-9+.-]*:)?[a-z][a-z0-9+.-]*:\/\/[^\s:@\/"'<>]+:[^\s@\/"'<>]+@[^\s"'<>]+/gid;

  function host(url) {
    const m = url.replace(/\\\//g, '/').replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').match(/^(?:[^@\/]*@)?([^\/:?#]+)/);
    return m ? m[1].toLowerCase().replace(/^www\./, '') : '';
  }
  // Package registries: their URLs name public packages ("registry.npmjs.org/@adobe/css-tools/-/…tgz"),
  // never a person. Lock files and manifests hold thousands of them. The team's own list is
  // data/whitelisted-domains.js.
  const PACKAGE_REGISTRIES = ['registry.npmjs.org', 'registry.npmjs.com', 'registry.yarnpkg.com', 'registry.npmmirror.com',
    'npm.pkg.github.com', 'pypi.org', 'pypi.python.org', 'files.pythonhosted.org', 'rubygems.org', 'crates.io', 'static.crates.io',
    'index.crates.io', 'repo.maven.apache.org', 'repo1.maven.org', 'plugins.gradle.org', 'api.nuget.org', 'proxy.golang.org',
    'sum.golang.org', 'pkg.go.dev', 'repo.packagist.org', 'conda.anaconda.org', 'cdn.jsdelivr.net', 'unpkg.com'];

  function whitelisted(h) {
    return PACKAGE_REGISTRIES.concat(P.WHITELISTED_DOMAINS || []).some((d) => h === d || h.endsWith('.' + d));
  }

  // Open-source funding links in package files ("funding": {"url": "https://github.com/sponsors/…"}): public
  // project and maintainer pages, not personal data (team decision, 2026-10-16).
  const FUNDING = [
    /^https?:\/\/(?:www\.)?(?:github\.com\/sponsors\/|opencollective\.com\/|tidelift\.com\/funding\/|funding\.communitybridge\.org\/|patreon\.com\/|ko-fi\.com\/|buymeacoffee\.com\/|liberapay\.com\/|paypal\.me\/)/i,
    /[?&]sponsor=1(?:&|$)/i,                                   // https://github.com/vitejs/vite?sponsor=1
    /^https?:\/\/[^\/\s]+\/(?:funding|support|donate|sponsor)\/?$/i, // https://paulmillr.com/funding/
  ];

  // Internal company tools on private host names ("intranet.acme.local/hr") are links of the organisation (in scope);
  // only this computer (localhost, 127.x) and example / test domains are not.
  // A dev server ("http://api.local:8080") has a port and no path; an internal tool has a path ("…/hr/payslips").
  const dummyHost = (h, v) => {
    if (!U.isDummyDomain(h)) return false;
    const rest = v.replace(/^[a-z0-9+.-]+:\/\//i, '');
    return !(/\.(?:local|internal)$/.test(h) && !/^[^\/?#]*:\d+/.test(rest) && /^[^\/?#]+\/\S+/.test(rest));
  };

  // Dummy links, judged from the link itself — never by opening it (that would send the client's link off the laptop):
  // placeholder sites ("yourdomain.com", "your-company.in"), template text ("https://{domain}/…", "www.<company>.com",
  // "https://xxxx.com"), and endings that are not real ("www.company.comm", "site.c0m").
  const PLACEHOLDER_HOST = /(?:^|\.)(?:your|my)[-_]?(?:domain|site|website|company|business|org|app|server|host|name|url|store|shop|brand)\.[a-z.]{2,}$|(?:^|\.)(?:domain|website|sitename|placeholder|dummy|sample|fake|xyz|abc|xxx+|test)\.(?:com|org|net|in|co|co\.in|io)$/;
  const TEMPLATE = /[{}<>]|\$\{|%7B|%7D|%3C|%3E/i;
  const BAD_TLD = /\.(?:comm|coom|cmo|ocm|copm|cpm|vom|comn|con|orgg|nett|inn|c0m|0rg)$|\.[a-z]?$|\.[a-z]*\d[a-z\d]*$/;
  function isDummyUrl(v, h) {
    // Template text in the site or path makes a placeholder link; in the query only ("…/viewform?entry.1={email}")
    // it is a real page with form fields to fill, still a link of the organisation.
    if (TEMPLATE.test(v.split(/[?#]/)[0]) || /(?:^|\.)x{4,}(?:\.|$)/.test(h)) return true;
    if (/^\d+(?:\.\d+){3}$/.test(h)) return false; // an IP address host
    return PLACEHOLDER_HOST.test(h) || BAD_TLD.test(h);
  }

  // A link to an image file ("…/logo.png", "…/photo.JPG?w=200") is not tagged (team decision, 2026-11-09).
  const IMAGE_FILE = /\.(?:jpe?g|png|webp|gif|svg|tiff?|raw)$/i;

  /** Is this URL public by nature (dummy domain, package registry, funding page, team whitelist, image file)? Never PII. */
  function isPublicUrl(v) {
    if (IMAGE_FILE.test(String(v || '').replace(/\\\//g, '/').split(/[?#]/)[0])) return true;
    const h = host(String(v || ''));
    if (h && isDummyUrl(String(v), h)) return true;
    // Documentation placeholders in the user part: "https://examplePublicKey@o0.ingest.sentry.io/0".
    if (/^[a-z0-9+.-]+:\/\/[^\/@\s]*example[^\/@\s]*@/i.test(v)) return true;
    // A file on someone's computer ("file:///C:/Users/ravi.kumar/…") is a document link of that person.
    if (/^file:\/\/\//i.test(v)) return false;
    // Cloud storage ("s3://acme-backups/customers/…") names a bucket, not a host with dots.
    if (/^(?:s3|gs):\/\/[a-z0-9][a-z0-9._-]{2,}\//i.test(v)) return false;
    if (!h || !h.includes('.') || dummyHost(h, String(v)) || whitelisted(h) || FUNDING.some((re) => re.test(v))) return true;
    // A popular website's homepage (offline knowledge base); "linkedin.com/in/ravi-k" and any other path still count.
    const pathPart = String(v).replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^[^\/?#]*/, '');
    return /^\/?(?:[?#].*)?$/.test(pathPart) && Boolean(P.kb && P.kb.popularSite(h));
  }
  P.isPublicUrl = isPublicUrl;

  // A link broken across lines (PDF text, narrow panels): "…/that-goes-" + newline + "on/next-line.html".
  function joinWrapped(text, d) {
    if (!/[-\/_?&=.%]$/.test(d.text) || text[d.end] !== '\n') return d;
    const m = /^[ \t]*([A-Za-z0-9\/_\-.?=&%#~+]+)(?=[\s<>"')\]]|$)/.exec(text.slice(d.end + 1, d.end + 200));
    if (!m || !/[\/.\-]/.test(m[1]) || /^\p{Lu}/u.test(m[1])) return d;
    const end = d.end + 1 + m.index + m[0].length;
    return { ...d, end, text: text.slice(d.start, end).replace(/\n[ \t]*/, '\n') };
  }

  // An XML namespace or schema location (<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">,
  // xmlns:image="http://www.google.com/schemas/sitemap-image/1.1", xsi:schemaLocation="…") names a format, not a person
  // or an organisation's page.
  const NAMESPACE_ATTR = /\b(?:xmlns(?::[\w.-]+)?|(?:[\w-]+:)?(?:noNamespace)?schemaLocation)\s*=\s*["']([^"'<>]*)$/i;
  const inNamespace = (text, s) => NAMESPACE_ATTR.test(text.slice(Math.max(0, s - 400), s));

  function detect(text) {
    const out = U.collect(text, URL_RE, 'URL/Link', (v, m, s) => {
      const h = host(v);
      if (inNamespace(text, s)) return null;
      // A container image ("registry.acme.com/payments:1.4.2", "image: …", "FROM …") is not a web address.
      if (!/^[a-z0-9+.-]+:\/\//i.test(v) && (/:[\w.-]+$|@sha256:/.test(v) || /(?:image|FROM)[ \t]*:?[ \t]*["']?$/i.test(text.slice(Math.max(0, s - 12), s)))) return null;
      if (isPublicUrl(v)) return null;
      if (/^\d+(?:\.\d+)+$/.test(h)) return 0.85; // an IP address host
      return /^[a-z0-9]+:\/\//i.test(v) || /^www\./i.test(v) ? 0.92 : 0.85;
    }, 'regex', { trim: true, rule: 'url' }).map((d) => joinWrapped(text, d));
    // A git remote in SSH form: git@github.com:acme-corp/payments-service.git
    out.push(...U.collect(text, GIT_SSH, 'URL/Link', (v) => (isPublicUrl('https://' + v.replace(/^[^@]+@/, '').replace(':', '/')) ? null : 0.9),
      'regex', { trim: true, rule: 'url-git' }));
    out.push(...U.collect(text, BARE, 'URL/Link', (v, m, s) => {
      const before = text.slice(Math.max(0, s - 30), s);
      const ok = SITE_BEFORE.test(before) || ((WEAK_BEFORE.test(before) || SUBDOMAIN_HOST.test(v)) && COMMON_SITE.test(v));
      if (!ok || isPublicUrl(v) || U.insideCode(text, s)) return null;
      return 0.85;
    }, 'regex', { trim: true, rule: 'url-domain' }));
    out.push(...U.collect(text, CONN, 'Connection URL with Credentials', (v) => {
      const pass = v.replace(/^[^:]+:\/\/[^:]+:/, '').split('@')[0];
      return pass && !/^(?:password|pass|\*+|x+|<[^>]*>|\$\{[^}]*\})$/i.test(pass) ? 0.95 : 0.6;
    }, 'regex', { trim: true, rule: 'url-credentials' }));
    return out;
  }

  U.register('URL/Link', detect);
})(globalThis);
