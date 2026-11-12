// Person Username: login IDs, handles and social media usernames. A handle given as
// GitHub's ("GitHub: ravi-k", "github.com/ravi-k") is a GitHub Username.
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const U = P.util;

  // @ravi_k, @ravi-kumar — not part of an email (no word char before "@"), must start with a letter or "_"; a hyphen
  // only between letters or digits (GitHub usernames), so "@priya-sharma" is one handle, not "@priya".
  const HANDLE = /(?<![\w.@\/])@[A-Za-z_](?:[A-Za-z0-9_.]|-(?=[A-Za-z0-9])){1,38}/gd;

  // A profile link after the key ("GitHub: github.com/ravi-k") gives the handle after the domain.
  // A hyphen separates key and value only with spaces around it: "Username - ravi", not the package "user-home".
  const KEY_VALUE = /\b(?:user[ \t]?name|user[ \t]?id|log[ \t]?in[ \t]?(?:id|name)|login|screen[ \t]?name|handle|user|twitter|instagram|github|gitlab|linkedin|telegram|skype)\b["']?(?:[ \t]*[:=]|[ \t]+[-–](?=[ \t]))[ \t]*["']?(?:(?:https?:\/\/)?(?:www\.)?[a-z]+\.(?:com|me|in|io)\/(?:in\/)?)?(@?[A-Za-z0-9_.\-]{2,40})/gid;

  const GITHUB = /github/i;
  // An answer to a question about the username: "share your username?" … "sure, it is ravi_k92" / "mine is snehaops".
  const ANSWER = /\b(?:it(?:'s|’s| is)|mine is|my (?:user ?name|user ?id|handle|login|id) is)[ \t:]+@?([a-z0-9][a-z0-9._-]{2,30}[a-z0-9])(?![\w@.-]*@)\b/gid;
  const ASKED = /\b(?:user[ \t]?name|user[ \t]?id|handle|login(?:[ \t]?id)?|screen[ \t]?name)\b/i;
  // "my github is shrutiiyer-dev", "github id: ravi-k", "GitHub handle — ravi_k"
  const GITHUB_SAID = /\b(?:my[ \t]+)?git[ \t]?hub(?:[ \t]+(?:id|handle|username|user[ \t]?name|account|profile))?[ \t]+(?:is|=|:|-|–)[ \t]+@?([A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){1,38})\b/gid;

  // "@word" in code is a keyword, never a handle: CSS and Tailwind at-rules, Sass/Less, doc-comment tags
  // (JSDoc, Javadoc, PHPDoc), decorators and annotations (Python, TypeScript/Angular/Nest, Java/Spring),
  // Razor/Blade directives.
  const CODE_WORDS = new Set((
    // CSS, PostCSS, Tailwind
    'import media font-face keyframes supports page charset namespace layer container property counter-style ' +
    'font-feature-values viewport document scope starting-style position-try tailwind apply screen variants responsive ' +
    'config plugin source utility theme custom-variant reference ' +
    // Sass / Less
    'use forward mixin include extend function return if else each for while debug warn error content at-root ' +
    // doc-comment tags
    'param params arg argument returns throws throw exception type typedef prop example see since deprecated author ' +
    'version license link callback template override private public protected readonly async module exports class ' +
    'constructor memberof description summary todo fixme inheritdoc abstract static enum interface implements extends ' +
    'file fileoverview overview ts-ignore ts-nocheck ts-expect-error ts-check jsx flow format remarks internal beta alpha ' +
    'experimental default defaultvalue event fires listens emits global name alias lends requires var const let api ' +
    'apiparam apisuccess package method field inherit category group ' +
    // decorators and annotations
    'staticmethod classmethod dataclass abstractmethod cached_property lru_cache cache wraps pytest fixture app router ' +
    'route suppresswarnings functionalinterface safevarargs nullable nonnull notnull component injectable input output ' +
    'ngmodule directive pipe hostlistener hostbinding viewchild viewchildren contentchild controller service entity ' +
    'column table id get post put delete patch body query headers injectable autowired bean configuration ' +
    'restcontroller requestmapping getmapping postmapping putmapping deletemapping value transactional test before after ' +
    'beforeeach aftereach beforeall afterall mock spy data getter setter builder slf4j jsonproperty jsonignore valid ' +
    'observable action computed state prop watch emit options ' +
    // Razor / Blade
    'elseif endif foreach endforeach forelse endforelse section endsection yield csrf auth guest endauth php endphp ' +
    'model using inject page code functions ' +
    // build and licence comments
    'license preserve cc_on noinline nosideeffects vite-ignore webpackchunkname webpackignore jsximportsource jsxfrag ' +
    'jest-environment asynciterator iterator'
  ).split(/\s+/));

  // Roles and teams, not people: "@cto", "@devops", "@security" (CODEOWNERS, chat mentions).
  const ROLES = new Set(('cto ceo cfo coo cio ciso cpo cmo vp admin admins administrator administrators team teams devops ops ' +
    'owner owners maintainer maintainers reviewer reviewers security infra backend frontend everyone channel here all core ' +
    'lead leads qa support sre platform data ml oncall on-call bot bots ci release releases legal hr finance').split(' '));

  /**
   * Is the "@word" at [s, e) code rather than a person's handle? A known keyword, or the first thing on a
   * line of code: followed by "(", on a line ending in ";" "{" or "}", or inside a "*", "//" or "#" comment.
   */
  function codeAt(text, s, e) {
    const word = (/^@([\w-]+)/.exec(text.slice(s, s + 64)) || [])[1] || '';
    if (CODE_WORDS.has(word.toLowerCase())) return true;   // the whole word: "@ts-ignore", "@font-face"
    if (/^__\w+__$/.test(word)) return true;               // /*@__PURE__*/ build annotation
    // An attribute or event binding in a template: <div @click="toggle">, @submit.prevent="save", @update:value="…".
    if (/^(?:[.:][\w.:-]*)?[ \t]*=[ \t]*["'{]/.test(text.slice(e, e + 80))) return true;
    const ls = text.lastIndexOf('\n', s - 1) + 1;
    if (/<[A-Za-z][^<>]*$/.test(text.slice(ls, s))) return true;   // inside an HTML / JSX tag
    let le = text.indexOf('\n', e);
    if (le === -1) le = text.length;
    const before = text.slice(ls, s);
    // A quoted "@word" on a line of code is a string in the program ("@children", "@license").
    const next = text[s + 1 + word.length] || '';
    if (/["'`]$/.test(before) && /["'`:]/.test(next) && /[;=(){}]/.test(text.slice(ls, le))) return true;
    if (!/^[ \t]*(?:\*|\/\/+|#)?[ \t]*$/.test(before)) return false; // not the first thing on its line
    if (/\S/.test(before)) return true;                                  // a doc / comment tag
    const after = text.slice(e, le).trimEnd();
    return /^\s*\(/.test(after) || /^[.\w]/.test(after) || /[;{}]$/.test(after) || after === '';
  }

  function detect(text) {
    const out = [
      ...U.collect(text, GITHUB_SAID, 'GitHub Username', 0.88, 'regex', { group: 1, rule: 'username-github-said' }),
      ...U.collect(text, ANSWER, 'Person Username', (v, m, s) => {
        // "it is ravi_k92" only right after the question; "my username is rahul_92" says what it is itself.
        if (!/^my /i.test(m[0]) && !ASKED.test(text.slice(Math.max(0, m.index - 160), m.index))) return null;
        if (/^(?:the|my|your|that|this|fine|ok|okay|done|same|there|correct|right|here|yes|no)$/i.test(v)) return null;
        if (/\.(?:json|ya?ml|txt|csv|js|ts|py|md|env|ini|cfg|conf|log|xml|html?|pdf|docx?|xlsx?)$/i.test(v)) return null; // a file
        if (!/[._\-\d]/.test(v) && !/^[a-z]+$/.test(v)) return null;                // "Sure" — a word, not a handle
        return /[._\-\d]/.test(v) ? 0.85 : 0.75;
      }, 'regex', { group: 1, rule: 'username-answer' }),
      // "@adobe/css-tools", "@babel/core@^7": an npm package scope, not a person's handle.
      ...U.collect(text, HANDLE, 'Person Username', (v, m, s, e) =>
        // a package scope: "@adobe/…", escaped "@babel\/…" or in a regex "@next[\\/]…"
        (/^[\w.-]{0,60}\[?\\*\//.test(text.slice(e, e + 64)) || codeAt(text, s, e) || ROLES.has(text.slice(s + 1, e).toLowerCase()) ? null : 0.85),
        'regex', { trim: true, rule: 'username-handle' }),
      ...U.collect(text, KEY_VALUE, 'Person Username', (v, m, s, e) => {
        if (text.slice(e, e + 3) === '://' || text[e] === '@' || text[e] === '/') return null; // URL or email follows
        // Code, not data: "const username = parsedURL.username", "s.username=r.username", "user: null", "getUsername()".
        if (/(?:\.|\b(?:const|let|var|this|self|def|val)\b[ \t.]*)$/.test(text.slice(Math.max(0, m.index - 12), m.index))) return null;
        if (U.codeValue(text, s, e, m[0].split(/[^A-Za-z ]/)[0]) || text[e] === '(' ||
          /^[A-Za-z_$][\w$]*\.(?:get)?(?:user[_-]?name|user|name|login|id|handle)$/i.test(v)) return null;
        return /[A-Za-z0-9]/.test(v) ? 0.9 : null;
      }, 'regex', { group: 1, trim: true, rule: 'username-key-value' }),
    ];
    for (const d of out) {
      if (d.rule === 'username-key-value' && GITHUB.test(text.slice(Math.max(0, d.start - 40), d.start))) d.label = 'GitHub Username';
    }
    return out;
  }

  U.register('Person Username', detect);
})(globalThis);
