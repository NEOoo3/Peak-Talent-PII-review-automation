// Projects: Peak Talent tasks come from different projects, and each has its own rules. The project is read from the
// task name's first part ("rai_codebase~~DK9__Zorvak~~…" is Code Base, "rai_apps~~zorvakapp~~…" is All Apps); the
// reviewer can switch it in the panel (P.SETTINGS.project: 'auto' | 'apps' | 'codebase' | 'general').
//
//   Code Base: every file is read as code (not only .tsx / .py / .json): the name model's own guesses are not shown,
//              developer words ("Dev", "Admin", "Root", "Prod"…) are never people, usernames or companies, and links to
//              development servers (dev.…, staging.…, localhost) are not PII.
//   All Apps:  the default rules ("Dev" may be a person's name there).
//   Meta:      the "SX Confluence PII Review" project (task name with "confluence" / "sx_", or the page shows that name):
//              the default rules; a number replaced with another number (a changed "record_id") is Overscrubbed.
//   Golden:    the 80-label project (task name with "golden", or the page shows "Golden project"): one label per PII
//              type (Indian Aadhaar Number, Stripe Key…), whatever the label list on the page says.
// Pure functions, unit-tested in Node (tests/projects.test.js).
(function (g) {
  'use strict';
  const P = g.PIIRA;

  const PROFILES = {
    apps: { id: 'apps', name: 'All Apps' },
    codebase: { id: 'codebase', name: 'Code Base' },
    meta: { id: 'meta', name: 'Meta (SX Confluence)' },
    golden: { id: 'golden', name: 'Golden (80 labels)' },
    general: { id: 'general', name: 'General' },
  };
  // The first part of the task name, before "~~".
  const PREFIXES = [
    [/^(?:rai_)?code[_-]?base\b|^(?:rai_)?codebase/i, 'codebase'],
    [/^(?:rai_)?apps?\b/i, 'apps'],
    [/^(?:rai_)?(?:meta|sx[_-]?confluence|confluence)\b|^sx[_-]/i, 'meta'],
    [/^(?:rai_)?golden/i, 'golden'],
  ];
  // The project's name where the page shows it ("SX Confluence PII Review" is the Meta project).
  const PAGE_NAMES = [[/\bSX[\s_-]*Confluence\b|\bConfluence PII Review\b/i, 'meta'], [/\bGolden\s+(?:project|dataset|PII)\b/i, 'golden']];

  // Code and data files by extension; Peak Talent file names end in "-<hash>": "app.tsx-6150e027".
  const CODE_FILE = /\.(?:jsx?|mjs|cjs|tsx?|vue|svelte|py|java|kt|go|rb|php|cs|swift|scala|rs|c|cc|cpp|h|hpp|css|scss|sass|less|html?|xml|json|ya?ml|toml|ini|cfg|conf|env|properties|gradle|sh|bash|zsh|sql|lock|graphql|proto)(?:-[0-9a-f]{6,})?$/i;
  const isCodeFile = (name) => CODE_FILE.test(String(name || '').split('~~').pop().trim());

  /** The project the task name belongs to ('apps' | 'codebase' | 'meta' | 'general'); else what the page shows. */
  function detect(fileName, pageProject) {
    const name = String(fileName || '');
    const first = name.replace(/^.*?(?=rai_|code|apps?\b|meta\b|sx[_-]|confluence|golden)/i, '').split('~~')[0].trim();
    for (const [re, id] of PREFIXES) if (re.test(first)) return id;
    if (/confluence/i.test(name)) return 'meta';
    if (/golden/i.test(name)) return 'golden';
    return pageProject || 'general';
  }

  /** The project named on the page outside the two documents ("SX Confluence PII Review"), or null. */
  function fromPage(doc, skip) {
    if (!doc || !doc.body || typeof doc.createTreeWalker !== 'function') return null;
    for (const [re, id] of PAGE_NAMES) if (re.test(doc.title || '')) return id;
    const w = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
    let seen = 0;
    for (let n = w.nextNode(); n && seen < 5000; n = w.nextNode(), seen++) {
      if (n.data.length > 200 || (skip && skip.some((el) => el && el.contains(n)))) continue;
      for (const [re, id] of PAGE_NAMES) if (re.test(n.data)) return id;
    }
    return null;
  }

  /** The project in force: the reviewer's choice, else the one the task name (or the page) says. */
  function current(fileName, pageProject) {
    const chosen = P.SETTINGS && P.SETTINGS.project;
    return chosen && chosen !== 'auto' && PROFILES[chosen] ? chosen : detect(fileName, pageProject);
  }

  /** Read the task as code: a Code Base task (any file), or a code / data file in any project. */
  const isCode = (fileName, project) => (project || current(fileName)) === 'codebase' || isCodeFile(fileName);

  // Words developers use for roles, environments and switches: never a person, username or company in a code base.
  const DEV_WORDS = new Set(('dev devs developer developers admin admins administrator root superuser sudo user users guest ' +
    'anonymous anon owner owners test tests tester testing qa uat prod production staging stage sandbox demo local localhost ' +
    'master main default system service bot bots ops devops sre infra api app apps client server backend frontend web mobile ' +
    'debug release build ci cd null none nil undefined true false todo fixme hack temp tmp sample example foo bar baz ' +
    'maintainer maintainers contributor contributors reviewer reviewers author authors team core portal dashboard console').split(/\s+/));
  const DEV_HOST = /^(?:dev|develop|development|staging|stage|stg|qa|uat|test|testing|sandbox|local|preview|beta|demo)[.-]|[.-](?:dev|staging|stage|stg|qa|uat|test|sandbox|local|preview)\./i;
  const PEOPLE = new Set(['Person Name', 'Person Username', 'Business Name']);

  /** Is this text only developer words ("Dev", "Admin User", "dev-team")? */
  const devWords = (t) => {
    const words = String(t || '').toLowerCase().split(/[\s_.\-\/]+/).filter(Boolean);
    return words.length > 0 && words.every((w) => DEV_WORDS.has(w));
  };

  /** Detections the project's rules leave out (site labels: d.label is the site label). */
  function keep(d, project) {
    if (project !== 'codebase') return true;
    if (PEOPLE.has(d.label) && devWords(d.text.replace(/^@/, ''))) return false;
    if (d.label === 'URL/Link') {
      const host = String(d.text).replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^[^@\/]*@/, '').split(/[\/:?#]/)[0];
      if (DEV_HOST.test(host)) return false;
    }
    return true;
  }

  // The client a task belongs to, from its title: "rai_codebase~~DK1__TeamKiraana__website~~src~~App.tsx" -> Kiraana
  // (client code DK1, then the organisation; "Team" in front is dropped), "codebase~~troveworks__trove-iam-svc~~…" ->
  // troveworks. Known client codes give the client's name directly. Only for Code Base (in All Apps the part after the
  // project names the app the data came from, such as "zorvakapp", not the client).
  const CLIENT_CODES = {}; // client code -> client name, e.g. { DK1: 'Kirana' }
  const GENERIC_PART = /^(?:website|web|site|app|apps|api|backend|frontend|front|back|mobile|android|ios|infra|platform|data|shared|service|services|svc|repo|repos|monorepo|main|core|common|lib|libs|sdk|cli|admin|dashboard|portal|docs|prod|dev|staging|test|tests)$/i;
  function clientsFromTask(fileName) {
    const parts = String(fileName || '').replace(/^.*?(?=rai_|codebase|code[_-]base)/i, '').split('~~');
    if (parts.length < 2 || !/code[_-]?base/i.test(parts[0])) return [];
    const tokens = parts[1].split(/__+/).map((t) => t.trim()).filter(Boolean);
    const out = [];
    if (tokens[0] && CLIENT_CODES[tokens[0].toUpperCase()]) out.push(CLIENT_CODES[tokens[0].toUpperCase()]);
    const org = tokens.find((t, i) => !(i === 0 && /^[A-Z]{1,8}\d*$/.test(t)));
    if (org) {
      const name = org.replace(/^team(?=[A-Z_-])/i, '').replace(/^[_-]+/, '').split(/[-_]/)[0];
      if (name.length >= 4 && !GENERIC_PART.test(name)) out.push(name);
    }
    return out;
  }

  P.projects = { PROFILES, detect, fromPage, current, isCode, isCodeFile, keep, devWords, clientsFromTask };
})(globalThis);
