// Person Name (heuristic): names after titles (Mr/Ms/Dr/Shri/Smt…), after
// form fields ("Name:", "Account Holder:"), after salutations ("Dear …"),
// in sign-offs, after S/O-D/O-W/O, a name alone on the first line (resumes),
// plus repeats of names already found.
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const U = P.util;
  const LABEL = 'Person Name';

  // One name word: Ravi · O'Brien · Rao-Patil · McDonald · RAVI · R.
  const TOKEN = "(?:\\p{Lu}(?:\\p{Ll}[\\p{L}\\p{M}]*|[\\p{Ll}\\p{M}]+(?:\\p{Lu}[\\p{Ll}\\p{M}]+)?|['’-][\\p{L}\\p{M}]+)|\\p{Lu}{2,}(?!\\p{L})|\\p{Lu}\\.)";
  // Words of a name are joined by spaces; a tab separates table cells.
  const SEP = '(?:[ ]+|(?<=\\.)(?=\\p{Lu}))';
  const NAME = `(${TOKEN}(?:${SEP}${TOKEN}){0,3})`;
  const TOKEN_RE = new RegExp(TOKEN, 'gu');
  const DEPARTMENT_HEADS = '(?:human resources|information technology|product engineering|accounts payable|customer success|' +
    'customer service|customer support|sales|finance|accounting|accounts|marketing|engineering|operations|procurement|' +
    'legal|compliance|technology|product|design|research|development|quality assurance|quality|administration|payroll|' +
    'logistics|billing|support|hr|it)';
  const DEPARTMENT_SUFFIX = new RegExp(
    `(?:^|[\\s,;|])${DEPARTMENT_HEADS}[ \\t]+(?:department|dept\\.?|team|division|unit|office|group)[ \\t]*$`,
    'i'
  );
  const DEPARTMENT_NAMES = new Set([
    'human resources', 'information technology', 'product engineering', 'accounts payable', 'customer success',
    'customer service', 'customer support', 'sales', 'finance', 'accounting', 'accounts', 'marketing', 'engineering',
    'operations', 'procurement', 'legal', 'compliance', 'technology', 'product', 'design', 'research',
    'development', 'quality assurance', 'quality', 'administration', 'payroll', 'logistics', 'billing', 'support', 'hr', 'it',
  ]);
  function cleanDepartmentSuffix(value) {
    let end = value.length;
    const suffix = DEPARTMENT_SUFFIX.exec(value);
    if (suffix) end = suffix.index;
    while (end > 0 && /[\s,;:|–-]/.test(value[end - 1])) end--;
    const candidate = value.slice(0, end).trim();
    const normalized = candidate.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    return DEPARTMENT_NAMES.has(normalized) ? '' : candidate;
  }
  P.cleanPersonName = cleanDepartmentSuffix;

  // Capitalised words that are never part of a name; a name is cut at the first one.
  const STOP = new Set((
    'address addr phone mobile mob tel ph email e-mail date dob road rd street st nagar layout bank ltd pvt private limited inc llc llp corp ' +
    'the and of for from to at in on by with account customer number no dear sir madam team manager policy name city state india ' +
    'regards thanks thank sincerely mr mrs ms dr hi hello contact id pan aadhaar office company department ref subject re please kindly ' +
    'yours signature signed fax gst gstin invoice amount total branch ifsc website url username password pin otp apartment apartments flat ' +
    'floor cross main sector block colony lane tower phase stage user login card vehicle registration reg world all everyone there valued ' +
    'friends folks members staff support sales admin hr employee employer client applicant nominee holder father mother spouse guardian ' +
    'desk loan care helpdesk management operations accounts billing service services department branch bank head ' +
    // automation accounts in git logs and mail headers ("Build Bot <ci@…>", "GitHub Actions")
    'bot bots build ci cd jenkins dependabot renovate deploy deployer automation noreply no-reply system root git github gitlab actions pipeline ' +
    'monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december'
  ).split(/\s+/));

  const TITLES = ['Mr', 'Mrs', 'Ms', 'Miss', 'Mx', 'Dr', 'Prof', 'Shri', 'Smt', 'Sri', 'Kum', 'Kumari', 'Capt', 'Col', 'Adv', 'Er'];
  const FIELDS = [
    'Name', 'Full Name', 'Customer Name', 'Client Name', 'Applicant Name', 'Applicant', 'Account Holder Name', 'Account Holder',
    'Account Name', 'Nominee Name', 'Nominee', "Father's Name", 'Father Name', "Mother's Name", 'Mother Name', 'Spouse Name',
    'Guardian Name', 'Guardian', 'Employee Name', 'Patient Name', 'Student Name', 'Candidate Name', 'Beneficiary Name',
    'Beneficiary', 'Holder Name', 'Contact Person', 'Signed by', 'Prepared by', 'Approved by', 'Reviewed by',
    'Authorised Signatory', 'Authorized Signatory', 'First Name', 'Last Name', 'Surname',
    'Ship To', 'Shipping To', 'Deliver To', 'Delivery To', 'Bill To', 'Billing To', 'Sold To', 'Consignee', 'Recipient', 'Addressee',
    'Author', 'Committer',
  ];
  // Shipping labels and letters: the name is alone on the line under the field ("Ship To:\nKavita Kavita").
  const BLOCK_FIELDS = ['Ship To', 'Shipping To', 'Deliver To', 'Delivery To', 'Bill To', 'Billing To', 'Sold To', 'Consignee',
    'Recipient', 'Addressee', 'Shipping Address', 'Delivery Address', 'Billing Address'];
  const SALUTATIONS = ['Dear', 'Hi', 'Hello', 'Hey', 'Attn', 'Attention'];
  const SIGNOFFS = ['Regards', 'Best regards', 'Kind regards', 'Warm regards', 'Sincerely', 'Thanks', 'Thank you',
    'Best', 'Cheers', 'Yours truly', 'Yours sincerely', 'Yours faithfully'];
  const RELATIONS = ['S/O', 'D/O', 'W/O', 'C/O', 'son of', 'daughter of', 'wife of', 'husband of'];

  const RULES = [
    // Titles are matched as written ("Mr") or in capitals ("MR"), never lower-case,
    // so "I miss Delhi" is not read as a title.
    { rule: 'name-title', c: 0.85, re: new RegExp(`\\b(?:${TITLES.flatMap((t) => [t, t.toUpperCase()]).join('|')})(?:\\.[ \\t]*|[ \\t]+)${NAME}`, 'gdu') },
    { rule: 'name-field', c: 0.85, re: new RegExp(`\\b${U.ciAny(FIELDS)}[ \\t]*[:\\-–][ \\t]*${NAME}`, 'gdu'), field: true },
    { rule: 'name-relation', c: 0.85, re: new RegExp(`(?<![A-Za-z])${U.ciAny(RELATIONS)}[ \\t]*[:\\-]?[ \\t]*${NAME}`, 'gdu') },
    // "my name is Rohit Verma", Hinglish "mera naam Rohit Verma hai"
    { rule: 'name-intro', c: 0.8, re: new RegExp(`\\b${U.ciAny(['my name is', 'mera naam', 'mera name', 'myself', 'this is'])}[ \\t]*[:,-]?[ \\t]+${NAME}`, 'gdu') },
    { rule: 'name-salutation', c: 0.75, re: new RegExp(`\\b${U.ciAny(SALUTATIONS)}[ \\t]*[:,]?[ \\t]+${NAME}`, 'gdu') },
    { rule: 'name-signoff', c: 0.75, re: new RegExp(`\\b${U.ciAny(SIGNOFFS)}[ \\t]*,?[ \\t]*\\r?\\n[ \\t]*${NAME}`, 'gdu') },
    { rule: 'name-block-field', c: 0.85, re: new RegExp(`(?:\\b${U.ciAny(BLOCK_FIELDS)}[ \\t]*:?|\\bTo[ \\t]*:)[ \\t]*\\r?\\n[ \\t]*${NAME}[ \\t]*(?=\\r?\\n|$)`, 'gdu') },
    // "Hrithvik Basak <h.basak@gmail.com>": git logs, mail headers, package authors.
    { rule: 'name-email', c: 0.85, re: new RegExp(`(?<![\\w.-])${NAME}[ ]*<[^\\s<>@]+@[^\\s<>]+>`, 'gdu') },
  ];

  // "Company Name:", "File Name:" etc. are not people.
  const NON_PERSON_FIELD = /(?:company|business|firm|bank|organi[sz]ation|product|file|domain|user|place|brand|shop|store|project|branch|event|plan|scheme|course|app|device|host|server|vendor|merchant)[ \t]*$/i;

  /** Cut a captured name at the first stop word; returns new end offset or -1. */
  function trimName(text, s, e) {
    const value = text.slice(s, e);
    TOKEN_RE.lastIndex = 0;
    let m;
    let end = -1;
    let words = 0;
    while ((m = TOKEN_RE.exec(value)) !== null) {
      const word = m[0].replace(/\.$/, '').toLowerCase();
      if (STOP.has(word)) break;
      // In capitals there is no lower case to show where a name ends: "RAVI KUMAR WILL ATTEND" stops at WILL.
      if (words > 0 && /^\p{Lu}{2,}$/u.test(m[0]) && CAPS_STOP.has(word)) break;
      end = m.index + m[0].length;
      if (m[0].length > 2 || /^\p{Lu}\p{Ll}$/u.test(m[0])) words++;
    }
    if (end <= 0 || words === 0) return -1;
    return s + end;
  }

  // The first line of a resume or profile is usually the person's name: two to four
  // capitalised words and nothing else ("Ananya Rao Kulkarni"), not a title ("Key Skills").
  const HEADING_WORDS = new Set(('resume curriculum vitae cv profile summary objective skills experience education contact ' +
    'details information personal report invoice statement letter agreement form application certificate receipt notice ' +
    'minutes meeting notes policy offer document page annual monthly quarterly project proposal plan schedule key ' +
    // the annotation platform's own words ("Annotate Here", "Label Text")
    'annotate annotation here label labels task review submit upload click select text').split(' '));
  const FIRST_LINE = /^\s*(\p{Lu}[\p{Ll}\p{M}]+(?:[ \t]+(?:\p{Lu}\.|\p{Lu}[\p{Ll}\p{M}]+)){1,3})[ \t]*(?:\r?\n|$)/du;
  function firstLineName(text) {
    const m = FIRST_LINE.exec(text.slice(0, 200));
    if (!m) return [];
    const [s, e] = m.indices[1];
    const words = m[1].split(/[ \t]+/);
    if (words.some((w) => STOP.has(w.toLowerCase()) || HEADING_WORDS.has(w.toLowerCase()))) return [];
    if (P.knownNames.lookup(m[1])) return [];
    return [{ label: LABEL, start: s, end: e, text: m[1], confidence: 0.8, source: 'heuristic', rule: 'name-first-line' }];
  }

  const GREETING_LINE = new RegExp(`^(?:${U.ciAny(SIGNOFFS)}|${U.ciAny(['Good morning', 'Good afternoon', 'Good evening', 'Good day',
    'Happy birthday', 'Happy new year', 'Happy holidays', 'Have a great day', 'Have a nice day', 'Take care', 'With regards',
    'Many thanks', 'Thanks and regards', 'Sent from'])})\\b`, 'u');
  const LOOSE_RULES = new Set(['name-intro', 'name-salutation', 'name-signoff']);
  const CAPS_STOP = new Set(('will would shall should can could may might must is are was were has have had do does did be been ' +
    'attend attends attended join joins joined call called calls said says sign signs signed request requested requests ' +
    'confirm confirmed approve approved submit submitted reported paid received sent wrote not also please kindly').split(' '));

  /** Is the line around `pos` written in capitals (at least 70% of its letters, and 8 or more)? */
  function shouting(text, pos) {
    const ls = text.lastIndexOf('\n', pos - 1) + 1;
    let le = text.indexOf('\n', pos);
    if (le === -1) le = text.length;
    const letters = text.slice(ls, le).match(/\p{L}/gu) || [];
    if (letters.length < 8) return false;
    return letters.filter((c) => c === c.toUpperCase() && c !== c.toLowerCase()).length / letters.length >= 0.7;
  }

  // An e-mail display name: "Ami Babu T C" <ami.babu@valueleaf.com>, From: Ravi Kumar <ravi@x.com>.
  // Initials are allowed ("T C", "K."); team and role mailboxes ("Support Team", "HR Desk") and
  // company names are not people. Surer when the name matches the address ("ami.babu").
  const DISPLAY = /(?:^|[\s,;:(\[])(?:"([^"<>\n@]{3,60})"|((?:\p{Lu}[\p{Ll}\p{M}'’-]+|\p{Lu}\.?)(?:[ \t]+(?:\p{Lu}[\p{Ll}\p{M}'’-]+|\p{Lu}\.?)){1,5}))[ \t]*<([^<>\s@]+)@[^<>\s]+>/gdu;
  const NAME_TOKEN = /^(?:\p{Lu}[\p{Ll}\p{M}'’-]+|\p{Lu}{1,2}\.?|\p{Lu}[\p{Ll}\p{M}'’-]+(?:-\p{Lu}[\p{Ll}\p{M}'’-]+)+)$/u;
  const MAILBOX_WORDS = new Set(('support team desk care help helpdesk service services admin administrator noreply no-reply info ' +
    'notifications notification alerts billing sales hr careers jobs recruitment marketing news newsletter office accounts ' +
    'customer customers group inc ltd llc pvt limited corp company technologies solutions bank').split(' '));
  function displayNames(text) {
    const out = [];
    let m;
    DISPLAY.lastIndex = 0;
    while ((m = DISPLAY.exec(text)) !== null) {
      const g = m[1] != null ? 1 : 2;
      const [s0, e0] = m.indices[g];
      const raw = text.slice(s0, e0);
      const lead = raw.length - raw.trimStart().length;
      const name = raw.trim().replace(/,$/, '');
      const words = name.split(/[ \t]+/);
      if (words.length < 2 || words.length > 6 || !words.every((w) => NAME_TOKEN.test(w))) continue;
      if (words.filter((w) => /\p{Ll}/u.test(w)).length === 0) continue;   // "ABC" or "T C" alone
      if (words.some((w) => MAILBOX_WORDS.has(w.toLowerCase().replace(/\.$/, '')) || STOP.has(w.toLowerCase()))) continue;
      if (P.knownNames.lookup(name)) continue;
      const local = m[3].toLowerCase();
      const matchesAddress = words.some((w) => w.length >= 3 && local.includes(w.toLowerCase()));
      const s = s0 + lead;
      out.push({ label: LABEL, start: s, end: s + name.length, text: name, confidence: matchesAddress ? 0.92 : 0.82,
        source: 'heuristic', rule: 'name-email-display' });
    }
    return out;
  }

  // Names from the names list (core/names.js), with no title or field in front.
  // A run of capitalised words and initials on one line: "Suresh Patel", "K. Venkata Ramana Rao", "B Ashritha",
  // "Ami Babu T C", "Gaddam Vamshi Krishna"; "Kavya and Arjun" is two runs.
  // A word also starts right after an escaped line break in JSON text ("…\\nAmi Babu").
  const CAP_RUN = /(?:(?<![\p{L}\p{N}@._\/#-])|(?<=\\[nrt]))(?:\p{Lu}\.?[ \t]+)*\p{Lu}[\p{Ll}\p{M}'’]+(?:[ \t]+(?:\p{Lu}[\p{Ll}\p{M}'’]+|\p{Lu}\.?(?![\p{L}\p{N}])))*/gu;
  // Words around a single name that show a person is meant.
  const PERSON_BEFORE = /(?:^|[\s(,;:])(?:hi|hello|hey|dear|thanks|thank[ \t]+you|thx|cc|bcc|ping|ask|asked|tell|told|to|with|by|from|for|and|or|met|meet|meeting[ \t]+with|call|called|email|emailed|mail|contact|assigned(?:[ \t]+to)?|assignee|owner|reviewer|approved[ \t]+by|reviewed[ \t]+by|agent|customer|client|mentor|lead|manager|officer|engineer|executive|intern|candidate|applicant|employee|student|teacher|doctor|nurse|driver|per|via|spoke[ \t]+(?:to|with)|talked[ \t]+to|@)[ \t]*[,:]?[ \t]*$/i;
  const STRONG_BEFORE = /(?:^|[\s(,;:])(?:hi|hello|hey|dear|thanks|thank[ \t]+you|thx|cc|bcc|ping|@)[ \t]*[,:]?[ \t]*$/i;
  const PERSON_AFTER = /^(?:['’]s\b|[ \t]+(?:said|says|wrote|writes|will|would|is|was|has|had|and|asked|asks|approved|sent|sends|shared|joined|left|replied|mentioned|confirmed|agreed|called|added|fixed|reviewed|reported|created|updated|merged|responded|answered|resolved|escalated|called|messaged|texted|owns|needs|wants|can|could|should|did|does|thinks|told|from|to|here|there)\b|[ \t]*,[ \t]*(?:please|can|could|thanks|we|i|will|let|merged|done)\b|[ \t]*:[ \t]*\S)/iu;
  const LINE_START = /(?:^|\n)[ \t]*(?:[-*•>]\s*)?$/;
  const NOT_NAME_AFTER = /^[ \t]+(?:Ltd|Limited|Pvt|Private|Inc|LLC|LLP|Corp|Corporation|Group|Services|Solutions|Technologies|Industries|Enterprises|Labs|Bank|Hospital|University|College|School|Institute|Foundation|Trust|Road|Rd|Street|St|Nagar|Layout|Colony|Marg|Avenue|Park|Station|Airport|Temple|Mandir|Place|Chowk|Bazaar|Bazar|Market|Circle|Junction|Gate|Bridge|Hall|Stadium|Puram|Pur|Ganj|Bagh|Vihar|Enclave|Extension)\b/;
  const COMPANY_BEFORE = /(?:^|[^\p{L}])(?:PT|CV|Tbk|M\/s|Messrs)\.?[ \t]+$/u;
  const COMPANY_WORD = /(?:^|[ \t])(?:Ltd|Limited|Pvt|Private|Inc|LLC|LLP|Corp|Corporation|Company|Group|Holdings|Industries|Enterprises|Technologies|Solutions|Services|Systems|Petroleum|Motors|Steel|Power|Energy|Airlines|Airways|Bank|Finance|Capital|Insurance|Pharma|Pharmaceuticals|Foods|Textiles|Logistics|Traders|Trading|Exports|Hospital|Hospitals|Hospitality|University|College|School|Institute|Foundation|Trust|Labs|Media|Studios|Ventures|Partners|Associates|Consulting|Consultants|Electricals|Electronics|Stores|Agencies|Agency|Brothers|Bros|Sons|Jewellers|Jewelers|Medicals|Hardware|Constructions|Builders|Developers|Works|Mills|Impex|Infotech|Infra|Garments|Fashions|Caterers|Travels|Tours|Motors|Automobiles|Clinic|Dental|Pharmacy|Bakery|Sweets|Restaurant|Hotel|Hotels|Cafe)\.?(?=[ \t]|$)/u;
  // Buildings and places: "Manandi Plaza", "Mahaveer Cedar Residency", "Madhya Pradesh", "Ganga Bhavan".
  const PLACE_WORD = /(?:^|[ \t])(?:Plaza|Residency|Residence|Heights|Towers?|Complex|Apartments?|Apts|Enclave|Gardens?|Estate|Villas?|Arcade|Mall|Centre|Center|House|Bhavan|Bhawan|Niwas|Nivas|Nilayam|Sadan|Mansion|Court|Chambers|Square|Pradesh|Nagar|Puram|Pur|Pet|Halli|Palli|Wadi|Gaon|Ganj|Bagh|Vihar|Layout|Colony|Sector|Phase|Block|Road|Rd|Street|Marg|Lane|Cross|Main|Village|Post|District|Dist|Taluk|Tehsil|Mandal|City|Town|Hobli|Khurd|Kalan|Galaxy|Park|Point|Hills?|Valley|View|Woods?|Meadows?|Springs?|Greens?|Lake|Bay|Beach|Island|Fort|Airport|Station|Hospital|College|School|University|Institute|Temple|Mandir|Masjid|Church)\.?(?=[ \t,]|$)/u;
  // A line of an address: a house or flat number, a PIN code, or address words around.
  const ADDRESS_LINE = /\b(?:\d{6}|\d{1,4}\s*[\/-]\s*\d{1,4}|(?:flat|plot|house|door|h)\.?\s*(?:no\.?|number|#)?\s*\d+|floor|road|rd|street|nagar|layout|colony|sector|phase|near|opp\.?|village|post|district|pradesh|cross|main|marg)\b/i;
  const word = (w) => w.replace(/\.$/, '');
  const isInitial = (w) => /^\p{Lu}\.?$/u.test(w);
  // An unknown capitalised word that reads as English, not as a name: "Approved", "Pending", "Shipping".
  const ENGLISH_ENDING = /(?:ed|ing|ly|tion|sion|ment|ness|able|ible|ive|ous|ful|less|ism|ist|ity|ance|ence|ship|ward|wise|ical|ary|ory|ics)$/i;

  // A part of a found name that is itself a known first name or surname ("Priya" after "Priya Raman").
  const listed = (w) => !!(P.names && ['first', 'last', 'both'].includes(P.names.kind(w)));

  // Verbs and greetings written before a name: "Ping Kulkarni", "Ask Divya" (Ping is also a given name).
  const LEAD_WORDS = new Set('ping ask tell call meet email mail cc bcc thanks thank welcome congrats congratulations ask please per via met spoke contact remind invite reviewed approved assigned prepared signed owner reviewer assignee'.split(' '));

  // Pronouns and function words that some lists carry as surnames ("You", "Many").
  const FUNCTION_WORDS = new Set(('i me my mine you your yours he him his she her hers it its we us our ours they them their theirs ' +
    'this that these those there here who whom whose what which when where why how all any each every some many much more most ' +
    'few none one no yes not only also very just so such than then too only own same other another both either neither ' +
    'can will shall may might must would should could do does did done is are was were be been being have has had ' +
    'new old big great good best better well first last next per via upon about above below after before over under ' +
    'yesterday today tomorrow tonight however therefore meanwhile hence thus still yet maybe perhaps sorry okay ok hey ' +
    // roles and honorifics around a name ("Agent Divya", "Lalitha Aunty", "Divya ji")
    'agent customer client user mentor lead manager officer engineer executive intern owner reviewer director founder ' +
    'coordinator supervisor teacher student patient nurse driver guard aunty auntie uncle ji bhai bhaiya didi anna akka amma ' +
    'appa garu sahab saheb sir madam mam maam ' +
    // job titles ("Senior Analyst", "Chief Architect")
    'senior junior principal chief head assistant associate trainee analyst developer consultant specialist architect ' +
    'designer administrator accountant clerk president vice partner advisor adviser auditor tester programmer scientist ' +
    'professor lecturer researcher technician operator representative ' +
    // dates written short ("Tue Mar 14 10:12:33 2023")
    'mon tue tues wed thu thur thurs fri sat sun jan feb mar apr jun jul aug sep sept oct nov dec').split(' '));

  /** 'initial' | 'first' | 'last' | 'both' | 'ambiguous' | 'unknown' (a name-shaped word not in the list) | null (never a name) */
  function wordKind(w) {
    if (isInitial(w)) return 'initial';
    const lw = w.toLowerCase();
    if (STOP.has(lw) || HEADING_WORDS.has(lw) || LEAD_WORDS.has(lw) || FUNCTION_WORDS.has(lw) || HINGLISH.has(lw)) return null;
    const k = P.names.kind(word(w));
    if (k) return k;
    return /^\p{Lu}\p{Ll}{2,}$/u.test(w) && !ENGLISH_ENDING.test(w) ? 'unknown' : null;
  }

  function namesFromList(text) {
    if (!P.names || !P.names.size) return [];
    const out = [];
    CAP_RUN.lastIndex = 0;
    let m;
    while ((m = CAP_RUN.exec(text)) !== null) {
      const run = m[0];
      const s = m.index;
      const e = s + run.length;
      if (NOT_NAME_AFTER.test(text.slice(e, e + 16))) continue;   // "Reddy Labs", "Gandhi Nagar"
      if (COMPANY_BEFORE.test(text.slice(Math.max(0, s - 8), s))) continue; // "PT Sinar Jaya Abadi", "M/s Ravi Traders"
      if (/[ \t]/.test(run) && COMPANY_WORD.test(run)) continue;            // "Bharat Petroleum Corporation"
      if (PLACE_WORD.test(run) || PLACE_WORD.test(text.slice(e, e + 14))) continue;  // "Manandi Plaza", "Madhya Pradesh"
      const ls = text.lastIndexOf('\n', s - 1) + 1;
      let le = text.indexOf('\n', e);
      if (le < 0) le = text.length;
      // Dates ("[12/03/23, 9:16 PM]" in a chat) are not house numbers.
      const onAddressLine = ADDRESS_LINE.test(text.slice(ls, le).replace(/\b\d{1,4}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/g, ' '));
      const toks = [...run.matchAll(/\S+/g)];
      const words = toks.map((t) => t[0]);
      const kinds = words.map(wordKind);
      // Segments between words that are never part of a name ("Reviewed by K Rahul Sai": "K Rahul Sai").
      let i = 0;
      while (i < words.length) {
        if (!kinds[i]) { i++; continue; }
        let j = i;
        while (j + 1 < words.length && kinds[j + 1]) j++;
        let a = i;
        let b = j;
        // A plain "A" or "I" in front is a word of the sentence, not an initial ("A Ravi…", "I Ravi…").
        while (a <= b && kinds[a] === 'initial' && /^[AI]$/.test(words[a])) a++;
        // Trailing unknown words after the last name word that read as more than a surname are left out.
        const part = kinds.slice(a, b + 1);
        const named = part.filter((k) => k !== 'initial');
        const clear = named.filter((k) => k === 'first' || k === 'last' || k === 'both');
        const unknown = named.filter((k) => k === 'unknown').length;
        const initials = part.length - named.length;
        i = j + 1;
        if (a > b || !named.length) continue;
        const ps = s + toks[a].index;
        const pe = s + toks[b].index + words[b].length;
        const value = text.slice(ps, pe);
        if (P.knownNames.lookup(value) || (P.isDepartment && P.isDepartment(value)) ||
          NOT_NAME_AFTER.test(text.slice(pe, pe + 16))) continue; // "Gandhi Nagar", "Nehru Place"
        const before = text.slice(Math.max(0, ps - 30), ps);
        // An honorific after the name does not change the context: "Lalitha Aunty: …", "Divya ji, thanks".
        const after = text.slice(pe, pe + 40).replace(/^[ \t]+(?:aunty|auntie|uncle|ji|garu|sir|madam|mam|bhai|bhaiya|didi|anna|akka|sahab|saheb)\b/i, '');
        const personContext = PERSON_BEFORE.test(before) ||
          ((LINE_START.test(before) || /(?:[,;]|[.!?][ \t]|\][ \t]*-?[ \t]*)\s*$/.test(before)) && PERSON_AFTER.test(after));
        // On an address line only a clear full name counts ("C/O Ravi Kumar, 12 MG Road"), never unknown words.
        if (onAddressLine && (unknown || clear.length < 2)) continue;
        let c = 0;
        if (named.length >= 2 && named.length <= 4 && unknown <= 2 && clear.length >= 1) c = clear.length >= 2 ? 0.86 : 0.8;
        else if (named.length >= 2 && named.length <= 4 && unknown === named.length && initials && personContext) c = 0.75; // "K Kylash Busireddy"
        else if (named.length === 1 && initials) {                         // "B. Ashritha", "Juhi G", "V Lakshmi"
          if (clear.length) c = 0.8;
          else if (unknown && personContext) c = 0.75;
        } else if (named.length === 1) {
          if (clear.length && personContext) c = 0.78;
          else if (!clear.length && part[0] === 'ambiguous' && STRONG_BEFORE.test(before)) c = 0.75;
          else if (unknown && STRONG_BEFORE.test(before)) c = 0.72;         // "Thanks Kylash", "Hi Ashritha"
        }
        if (c) out.push({ label: LABEL, start: ps, end: pe, text: value, confidence: c, source: 'heuristic', rule: 'name-list' });
      }
    }
    return out;
  }

  // A name written all in lower case or all in capitals: "signed: ravi kumar", "from ankit sharma",
  // "Customer: PRIYA RAMAN". Only a known first name followed by a known surname (both unambiguous), never in code.
  const CASED_PAIR = /(?<![\p{L}\p{N}@._\/#$-])(\p{Ll}{3,}|\p{Lu}{3,})[ \t]+(\p{Ll}{3,}|\p{Lu}{3,})(?:[ \t]+(\p{Ll}{3,}|\p{Lu}{3,}))?(?![\p{L}\p{N}@_(\/-]|\.\p{L})/gu;
  const CODE_LINE = /[;{}=()<>]|=>|^\s*(?:#|\/\/|import\s|from\s+[\w.]+\s+import\b|def\s|class\s|const\s|let\s|var\s|function\s|return\s)/;
  // Hindi / Hinglish words that are also names somewhere ("abhi tak", "kal tak", "sab log").
  const HINGLISH = new Set(('abhi tak hai hain kya nahi nahin bhi aur par pe se ko ki ka ke mein main hum tum aap yeh woh voh kal aaj ' +
    'jaldi bahut thoda accha acha theek thik sab kuch koi kab kaise kyun kyon jab tab phir lekin agar toh wala wali wale log baad ' +
    'pehle saath liye diya kiya karo karna raha rahi rahe gaya gayi hoga hogi mera meri tera teri uska uski unka unki apna apni').split(' '));
  function casedNames(text) {
    const out = [];
    CASED_PAIR.lastIndex = 0;
    let m;
    while ((m = CASED_PAIR.exec(text)) !== null) {
      const ws = [m[1], m[2], m[3]].filter(Boolean);
      if (new Set(ws.map((w) => (/\p{Lu}/u.test(w[1]) ? 'U' : 'L'))).size > 1) { CASED_PAIR.lastIndex = m.index + m[1].length; continue; }
      const kinds = ws.map((w) => (FUNCTION_WORDS.has(w.toLowerCase()) || STOP.has(w.toLowerCase()) || HINGLISH.has(w.toLowerCase()) ? null : P.names.kind(w[0].toUpperCase() + w.slice(1).toLowerCase())));
      // first name(s), then a surname: "ravi kumar", "sai teja reddy"
      let n = kinds.length;
      while (n >= 2 && !(['last', 'both'].includes(kinds[n - 1]) && kinds.slice(0, n - 1).every((k) => k === 'first' || k === 'both'))) n--;
      if (n < 2) { CASED_PAIR.lastIndex = m.index + m[1].length; continue; }
      const ls = text.lastIndexOf('\n', m.index - 1) + 1;
      let le = text.indexOf('\n', m.index);
      if (le < 0) le = text.length;
      const line = text.slice(ls, le);
      if (CODE_LINE.test(line)) continue;
      const start = m.index;
      const end = start + text.slice(start).indexOf(ws[n - 1]) + ws[n - 1].length;
      out.push({ label: LABEL, start, end, text: text.slice(start, end), confidence: /\p{Lu}/u.test(ws[0][1]) ? 0.8 : 0.74,
        source: 'heuristic', rule: 'name-list-cased' });
      CASED_PAIR.lastIndex = end;
    }
    return out;
  }

  // Bank statement narrations: "NEFT-SURESH BABU-SALARY", "IMPS/ANJALI MEHRA/60123456789", "UPI/Ravi Kumar/…".
  const NARRATION = /\b(?:NEFT|IMPS|RTGS|UPI|NACH|ECS|TRF|INB|MMT)(?:[-\/ ]+(?:CR|DR|IN|OUT|P2P|P2A|\d{6,}))*[-\/:]+[ \t]*((?:[A-Z][A-Za-z.]*)(?:[ ][A-Z][A-Za-z.]*){1,3})(?=[ \t]*[-\/,]|[ \t]*$)/gmd;
  function narrationNames(text) {
    const out = [];
    for (const m of text.matchAll(NARRATION)) {
      const words = m[1].split(' ');
      if (!words.some((w) => P.names && ['first', 'last', 'both'].includes(P.names.kind(w.replace(/\.$/, ''))))) continue;
      if (words.some((w) => STOP.has(w.toLowerCase()) || COMPANY_WORD.test(' ' + w))) continue;
      const [s, e] = m.indices[1];
      out.push({ label: LABEL, start: s, end: e, text: m[1], confidence: 0.85, source: 'heuristic', rule: 'name-narration' });
    }
    return out;
  }

  function detect(text) {
    const out = firstLineName(text).concat(narrationNames(text), displayNames(text), namesFromList(text), casedNames(text));
    for (const r of RULES) {
      out.push(...U.collect(text, r.re, LABEL, (v, m, s, e) => {
        if (r.field && NON_PERSON_FIELD.test(text.slice(Math.max(0, m.index - 20), m.index))) return null;
        // A line written in capitals ("THIS IS AN AUTOGENERATED FILE", "HELLO WORLD") is a banner, not a
        // name, for the loose phrase rules. Fields, titles and "Ship To:" blocks ("MR. RAVI KUMAR") still count.
        if (LOOSE_RULES.has(r.rule) && shouting(text, s) && !/\p{Ll}/u.test(v)) return null;
        // "Best Regards\nKind Regards", "Thanks,\nGood Morning Team": another greeting, not a name.
        if (LOOSE_RULES.has(r.rule) && GREETING_LINE.test(text.slice(s, s + 40))) return null;
        // "Prepared by: Field Services", "Ship To: Indigo Crest Hospitality": a company or team, not a person.
        if (/[ \t]/.test(text.slice(s, e)) && COMPANY_WORD.test(text.slice(s, e))) return null;
        const cleaned = cleanDepartmentSuffix(text.slice(s, e));
        if (!cleaned) return null;
        if (TITLES.some((t) => t.toLowerCase() === cleaned.replace(/\.$/, '').toLowerCase())) return null; // "Smt" alone
        const end = trimName(text, s, s + text.slice(s, e).indexOf(cleaned) + cleaned.length);
        if (end < 0) return null;
        return { start: s, end, confidence: r.c };
      }, 'heuristic', { group: 1, rule: r.rule }));
    }
    return out.concat(propagate(text, out));
  }

  // Once "Ravi Kumar Sharma" is found, flag its other appearances too.
  function propagate(text, found) {
    const extra = [];
    const taken = found.map((d) => [d.start, d.end]);
    const fulls = new Set();
    const parts = new Set();
    for (const d of found) {
      if (d.confidence < 0.75) continue;
      const words = d.text.split(/[ \t]+/).filter((w) => w.length >= 3 && !/\.$/.test(w));
      if (words.length >= 2) fulls.add(d.text);
      for (const w of words) if (!STOP.has(w.toLowerCase())) parts.add(w);
    }
    // One pass with a combined pattern (longest names first) instead of one scan per name —
    // large documents can contain thousands of names.
    const needles = [...fulls].sort((a, b) => b.length - a.length).concat([...parts].sort((a, b) => b.length - a.length));
    if (!needles.length) return extra;
    taken.sort((a, b) => a[0] - b[0]);
    const covered = (s, e) => {
      const i = U.lowerBound(taken, s, (t) => t[0]);
      return (i < taken.length && taken[i][0] < e) || (i > 0 && taken[i - 1][1] > s);
    };
    const CHUNK = 400; // keep each alternation regex a reasonable size
    const hits = [];
    for (let c = 0; c < needles.length; c += CHUNK) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${needles.slice(c, c + CHUNK).map(U.escapeRe).join('|')})(?![\\p{L}\\p{N}])`, 'gdu');
      hits.push(...U.collect(text, re, LABEL, (v) => (fulls.has(v) ? 0.8 : listed(v) ? 0.78 : 0.65), 'heuristic', { rule: 'name-repeat' }));
    }
    hits.sort((a, b) => (b.end - b.start) - (a.end - a.start));
    for (const d of hits) {
      if (covered(d.start, d.end)) continue;
      d.rule = fulls.has(d.text) ? 'name-repeat-full' : 'name-repeat-part';
      const i = U.lowerBound(taken, d.start, (t) => t[0]);
      taken.splice(i, 0, [d.start, d.end]);
      extra.push(d);
    }
    return extra;
  }

  U.register(LABEL, detect);
})(globalThis);
