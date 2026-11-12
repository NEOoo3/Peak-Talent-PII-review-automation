// ============================================================================
//  selectors.js — EVERYTHING that depends on the Peak Talent page lives here.
//  When the site changes, update this file only. No other file needs editing.
//
//  You usually do NOT need to edit this on peaktalent.ai: if these selectors
//  don't match, the extension auto-detects the two documents, and reviewers
//  can fix it with "Set up manually" in the panel (saved per browser).
//  The selectors below match test.html. Put real Peak Talent selectors here
//  only if you want to ship a fixed setup to everyone.
//
//  Each selector entry is a LIST. They are tried in order and the first one
//  that matches an element on the page wins, so you can keep an old selector
//  as a fallback while the site migrates.
// ============================================================================
(function (g) {
  'use strict';
  g.PIIRA = g.PIIRA || {};

  g.PIIRA.SELECTORS = {
    // LEFT panel: the original, unredacted base document.
    leftDocument: ['[data-testid="left-document"]', '#left-doc'],

    // RIGHT panel: the same document after the PII review.
    rightDocument: ['[data-testid="right-document"]', '#right-doc'],

    // Labeled PII spans inside the RIGHT panel.
    rightLabelSpan: ['[data-pii-label]', '.pii-label'],

    // Where the label name is stored on a labeled span. Tried in order;
    // the first value that is a known label name (or alias) is used.
    labelNameAttributes: ['data-pii-label', 'data-label', 'data-entity', 'data-tag', 'aria-label', 'title'],

    // If the label name is encoded in a class instead, e.g. class="tag-person-name",
    // list the class prefix here ("tag-").
    labelClassPrefixes: ['pii-label--'],

    // If the label name is shown as text in a small child element (a "badge"),
    // e.g. <span>Ravi <sup class="tag">Person Name</sup></span>, put the child's
    // selector here (relative to the span), e.g. ':scope > sup.tag'.
    labelNameFromChild: '',

    // Elements whose text must NOT be read as document text, e.g. a small
    // badge showing the label name or a "×" remove button inside a span.
    ignoreInText: ['.pii-label-badge', '.pii-label-remove', '.doc-title'],

    // Some reviewed documents replace PII with placeholder text such as
    // [PERSON_NAME] instead of keeping the original words. This pattern finds
    // those placeholders even when they are not wrapped in a labeled span.
    // Group 1 must capture the label name. Set to '' to disable.
    placeholderPattern: '\\[([A-Z][A-Z0-9 _/]*[A-Z0-9])\\]',

    // Maps the names the site uses to the extension's label names.
    // Keys are compared lower-case with spaces/punctuation removed, so
    // "PERSON_NAME", "person-name" and "Person Name" all become "personname".
    labelAliases: {
      // The site's 13 labels (and spellings of them)
      personname: 'Person Name', name: 'Person Name', person: 'Person Name', fullname: 'Person Name', alias: 'Person Name',
      personusername: 'Person Username', username: 'Person Username', handle: 'Person Username', githubusername: 'Person Username',
      emailaddress: 'Email Address', email: 'Email Address', emailid: 'Email Address',
      contactnumber: 'Contact Number', contact: 'Contact Number', phone: 'Contact Number', phoneno: 'Contact Number',
      phonenumber: 'Contact Number', mobile: 'Contact Number', mobilenumber: 'Contact Number',
      address: 'Address', addr: 'Address', homeaddress: 'Address', officeaddress: 'Address', gpscoordinates: 'Address',
      date: 'Date', dob: 'Date', dateofbirth: 'Date',
      urllink: 'URL/Link', url: 'URL/Link', link: 'URL/Link', weblink: 'URL/Link', website: 'URL/Link',
      vehiclenumberplate: 'Vehicle Number Plate', vehiclenumber: 'Vehicle Number Plate', numberplate: 'Vehicle Number Plate',
      licenseplate: 'Vehicle Number Plate', licenceplate: 'Vehicle Number Plate', vehicleregistration: 'Vehicle Number Plate',
      businessname: 'Business Name', business: 'Business Name', company: 'Business Name', companyname: 'Business Name',
      organization: 'Business Name', organisation: 'Business Name', org: 'Business Name',
      accountnumber: 'Account Number', accountno: 'Account Number', bankaccount: 'Account Number', account: 'Account Number',
      credentials: 'Credentials', credential: 'Credentials', password: 'Credentials', apikey: 'Credentials', token: 'Credentials',
      secret: 'Credentials', governmentid: 'Credentials', idnumber: 'Credentials',
      ipaddress: 'IP Address', ip: 'IP Address', macaddress: 'IP Address', ipmacaddress: 'IP Address',
      overscrubbed: 'Overscrubbed', overscrub: 'Overscrubbed',
      // Names from the older annotation guide, still recognised
      personemail: 'Email Address', businessemail: 'Email Address', personalemail: 'Email Address', companyemail: 'Email Address',
      officialemail: 'Email Address',
      personphoneno: 'Contact Number', personphone: 'Contact Number', businessphoneno: 'Contact Number', businessphone: 'Contact Number',
      officephone: 'Contact Number',
      persondob: 'Date',
      businessusername: 'Person Username', companyusername: 'Person Username',
      personaddress: 'Address', businessaddress: 'Address', companyaddress: 'Address',
      ifsccode: 'Account Number', ifsc: 'Account Number', upiid: 'Account Number', upi: 'Account Number', vpa: 'Account Number',
      creditdebitcardno: 'Account Number', cardnumber: 'Account Number', creditcard: 'Account Number', debitcard: 'Account Number',
      pancardnumber: 'Credentials', pancard: 'Credentials', pan: 'Credentials', panno: 'Credentials',
      apiprivatekeys: 'Credentials', apikeys: 'Credentials', privatekey: 'Credentials', pin: 'Credentials', otp: 'Credentials',
      aadharcardno: 'Credentials', aadhaar: 'Credentials', aadhar: 'Credentials', aadhaarnumber: 'Credentials',
      drivinglicenseno: 'Credentials', drivinglicence: 'Credentials', drivinglicense: 'Credentials', dl: 'Credentials',
      voterid: 'Credentials', epic: 'Credentials', passport: 'Credentials', passportnumber: 'Credentials',
      transactionid: 'Credentials', invocationid: 'Credentials', shasshhashkey: 'Credentials', hash: 'Credentials',
      vpcid: 'Credentials', cardid: 'Credentials', accountid: 'Credentials',
    },

    // The site's label popup, found by its visible text (lower case), used when the agent labels the right
    // document: select text -> "Label selection" -> "Choose a label" -> label -> "Annotate matching entries"
    // left UNticked -> Apply. Change these if the site renames them.
    autoLabel: {
      popupTitle: 'label selection',
      chooseLabel: 'choose a label',
      matching: 'annotate matching entries',
      apply: 'apply',
      cancel: 'cancel',
      waitPopupMs: 4000,
      waitResultMs: 6000,
    },

    // How long to wait for the panels to appear before showing the
    // "Couldn't find the document panels" message.
    waitForTaskMs: 8000,

    // Wait this long after the page stops changing before re-analysing.
    debounceMs: 600,
  };
})(globalThis);
