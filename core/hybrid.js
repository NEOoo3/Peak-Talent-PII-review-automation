// Merges the rule detections (core/engine.js) with the GLiNER model's entities.
//   - Rules own everything with a fixed shape: IDs, keys, accounts, numbers, emails, plates.
//     The model is only asked about names, companies, addresses and usernames.
//   - Both agree           -> the rule detection, a little more confident (model: agrees)
//   - Only the model       -> a new detection; below P.SETTINGS.model.add it is only "possible"
//   - Different label      -> the rule's label stays, the model's is attached as an alternative
//   - Never PII stays never PII: headers, field labels, Department/Status values, department names
//     and well-known names (business names list) are dropped whatever the model says.
// Pure function, unit-tested in Node.
(function (g) {
  'use strict';
  const P = g.PIIRA;

  P.MODEL_LABELS = new Set(['Person Name', 'Business Name', 'Address', 'Person Username']);

  P.SETTINGS.model = Object.assign({
    enabled: false, // switched on by policy once the model ships with the extension
    // The int8 model scores low (median 0.17 for names and companies, 2% of answers reach 0.5), so the
    // cut-offs are set from ml/eval.js --sweep on 200 tasks: recall 53% -> 76% at the same 97% precision.
    min: 0.15,      // model entities below this score are ignored
    add: 0.2,       // a model-only entity at or above this is reported; below it is "possible"
    strong: 0.4,    // a model label this sure is shown as an alternative to a different rule label
  }, P.SETTINGS.model || {});

  const overlap = (a, b) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

  // The model reads code as if it were prose; the rules know better. A suggestion is dropped when it
  // is an identifier ("os.getenv", "db_user", "a/b"), or sits right against "=", "(", "." or a quote on a
  // line of code ("user=user", "conn = connect(host"), or is a role ("CTO") or the site's panel heading.
  const CODE_LINE = /[;{}=()]|^\s*(?:#|\/\/|\*|import\s|from\s|def\s|class\s|const\s|let\s|var\s|function\s|return\s|export\s)/;
  const FILE_NAME = /^[\w.-]+\.(?:json|ya?ml|toml|xml|csv|tsv|txt|md|log|env|ini|cfg|conf|lock|js|mjs|cjs|ts|tsx|jsx|py|java|kt|go|rb|php|cs|sh|sql|html?|css|scss|pdf|docx?|xlsx?|pptx?|png|jpe?g|gif|svg|zip|gz|tar|pem|key|crt)$/i;
  const FIELD_WORDS = new Set(('name names firstname lastname fullname street city state zip zipcode postcode pincode ' +
    'country address email phone mobile field fields form company organization org username user').split(' '));
  const ANNOTATION_LINE = /^\s*@[A-Z][\w.]*(?:\(.*\))?\s*$/;
  const JOB_WORD = /^(?:senior|junior|principal|chief|head|assistant|associate|trainee|analyst|developer|consultant|specialist|architect|designer|administrator|accountant|clerk|president|vice|partner|advisor|adviser|auditor|tester|programmer|scientist|professor|lecturer|researcher|technician|operator|representative|manager|engineer|executive|officer|director|intern|lead|talent|acquisition|sales|marketing|hr|it|data|software|product|project|program|general|regional|area|team|group|business|technical|operations)$/i;
  const ROLES = /^(?:cto|ceo|cfo|coo|cio|ciso|vp|admin|team|devops|owner|maintainer|reviewer|security|everyone|lead|qa|support|sre)$/i;
  function looksLikeCode(m, text) {
    if (/[(){}=<>\\$]/.test(m.text) || ROLES.test(m.text.trim())) return true;
    // A tag name: "<Button", "</Button>", "<Card.Header" (JSX and HTML components), never a person.
    if (/<\/?\s*$/.test(text.slice(Math.max(0, m.start - 3), m.start))) return true;
    if (FILE_NAME.test(m.text.trim())) return true;
    // A form or schema word on its own ("street", "zipcode", "name"): a field, not a value.
    if (FIELD_WORDS.has(m.text.trim().toLowerCase())) return true;
    // Annotations and decorators: "@Configuration", "@Autowired", "@Input()" (not a person's "@ravi_k").
    if (text[m.start - 1] === '@' && m.label !== 'Person Username') return true; // "auth.json", "report_final.pdf": a file, not a username
    // Names, companies and addresses do not contain "_", "/" or "x.y"; usernames may ("ravi_k92", "arjun.dev").
    if (m.label !== 'Person Username' && /[_\/]|\.\w/.test(m.text)) return true;
    const ls = text.lastIndexOf('\n', m.start - 1) + 1;
    let le = text.indexOf('\n', m.end);
    if (le === -1) le = text.length;
    const line = text.slice(ls, le);
    if (P.textModel && P.textModel.isPanelChrome(line)) return true;
    if (ANNOTATION_LINE.test(line)) return true;
    // An attribute or field of an object ("form.street", "user.name") or an HTML/form attribute (name="street").
    if (/^[a-z_$]/.test(m.text) && /[\w$\]]\.$/.test(text.slice(Math.max(ls, m.start - 2), m.start))) return true;
    if (/<[a-z][^<>]*\b(?:name|id|for|type|class|key|field|placeholder|autocomplete|data-[\w-]+)\s*=\s*["']$/i.test(text.slice(ls, m.start))) return true;
    if (!CODE_LINE.test(line)) return false;
    const before = text.slice(Math.max(ls, m.start - 2), m.start);
    const after = text.slice(m.end, Math.min(le, m.end + 2));
    // Against "=", "(" or "." (an argument or attribute); quotes alone are data (JSON values are quoted).
    return /[=(.]\s*$/.test(before) || /^\s*[=(.)]/.test(after);
  }
  const letters = (s) => (String(s).match(/\p{L}/gu) || []).length;

  /** Confidence for a model-only detection, on the same scale as the rules (P.REVIEW_THRESHOLD = 0.7). */
  function confidenceOf(score, S) {
    if (score >= S.add) return Math.min(0.9, 0.72 + (score - S.add) * 0.5);
    return Math.max(0.4, 0.69 - (S.add - score));
  }

  /**
   * @param detections engine output (sorted, non-overlapping; label = site label, type = PII type)
   * @param entities   model output [{label (site label), start, end, text, score}]
   * @param text       the document
   * @param opts       {structure, settings, codeFile}
   */
  function merge(detections, entities, text, opts) {
    const S = Object.assign({}, P.SETTINGS.model, opts && opts.settings);
    const structure = (opts && opts.structure) || (P.structured ? P.structured.parse(text) : null);
    const out = detections.map((d) => ({ ...d }));
    const added = [];

    for (let m of entities) {
      if (!P.MODEL_LABELS.has(m.label) || m.score < S.min || letters(m.text) < 2 || P.engine.isEmptyValue(m.text)) continue;
      if (structure && (P.structured.inKey(structure, m.start, m.end) ||
        (P.structured.cellAt(structure, m.start, m.end) || {}).nonPii)) continue;
      // The name of a mailbox label, folder or constant ({"id":"SPAM","name":"SPAM"}), not a person or company.
      const cell = structure && P.structured.cellAt(structure, m.start, m.end);
      // "city": "Chennai" — a place column, not a person or a company.
      if (cell && (m.label === 'Person Name' || m.label === 'Business Name') &&
        /(?:^|_|\b)(?:city|town|village|state|province|country|district|location|place|region|branch|area|locality|pincode|zip|postcode|county|model|make|brand|product|item|sku|category|type|status|plan|variant|colou?r|vehicle|car|course|subject|skill|title|designation|department|dept|role)(?:$|_|\b)/i.test(cell.key)) continue;
      if (cell && P.namesAThing && P.namesAThing(structure, text, cell, text.slice(cell.start, cell.end))) continue;
      if (P.isDepartment(m.text) || P.isDocPhrase(m.text)) continue; // "Field Services", "Goods and Services"
      if (looksLikeCode(m, text)) continue;
      // A capitalised plain word ("Hrithvik:") is a name, not a username; usernames are written as typed.
      if (m.label === 'Person Username' && /^\p{Lu}\p{Ll}+$/u.test(m.text.trim())) continue;
      // "Senior Analyst", "Head - Talent Acquisition": a job title, not a person.
      if (m.label === 'Person Name' && m.text.split(/[\s-]+/).filter(Boolean).every((w) => JOB_WORD.test(w))) continue;
      // "Agent Divya", "Customer Ravi Kumar": the role is not part of the name.
      if (m.label === 'Person Name') {
        const lead = /^(?:agent|customer|client|user|mentor|team ?lead|lead|manager|officer|engineer|executive|intern|owner|reviewer|director|founder|coordinator|supervisor|teacher|student|patient|nurse|driver|employee|applicant|candidate|nominee|aunty|uncle|dear|hi|hello|thanks|cc)[ \t]+/i.exec(m.text);
        if (lead) m = { ...m, start: m.start + lead[0].length, text: m.text.slice(lead[0].length) };
        if (letters(m.text) < 2) continue;
      }
      if (m.label === 'Business Name' && P.knownNames.lookup(m.text)) continue;

      // A company in the offline knowledge base makes the model's guess surer.
      if (m.label === 'Business Name' && P.kb && P.kb.company(m.text)) m = { ...m, score: Math.max(m.score, S.add + 0.2) };
      const hits = out.filter((d) => overlap(d, m) > 0);
      if (hits.some((d) => !P.MODEL_LABELS.has(d.label))) continue; // a fixed-shape value: the rule knows
      const same = hits.filter((d) => d.label === m.label);
      if (same.length) {
        for (const d of same) {
          d.model = { label: m.label, score: m.score, agrees: true };
          d.confidence = Math.min(0.97, Math.max(d.confidence, d.confidence + 0.1 * m.score));
        }
        continue;
      }
      if (hits.length) {
        if (m.score >= S.strong) for (const d of hits) d.model = { label: m.label, score: m.score, agrees: false };
        continue;
      }
      // Code files: the model reads identifiers as names there; its guesses alone are not shown at all.
      if (opts && opts.codeFile) continue;
      if (added.some((a) => overlap(a, m) > 0)) continue;
      added.push({
        text: m.text, label: m.label, type: m.label, start: m.start, end: m.end,
        confidence: Math.round(confidenceOf(m.score, S) * 100) / 100, source: 'model', rule: `model-${m.prompt || m.label}`,
        model: { label: m.label, score: m.score, agrees: true },
      });
    }
    // Names the model found link their handles too ("Bharat Gangaiah" -> bharat.gangaiah).
    return P.engine.linkHandles(out.concat(added).sort((a, b) => a.start - b.start), text);
  }

  P.hybrid = { merge, confidenceOf };
})(globalThis);
