// Settings an administrator pushes to every installation through Chrome policy
// (chrome.storage.managed, schema in managed_schema.json). Reviewers cannot
// change them. Without a policy every setting has its default, so a personal
// install behaves exactly as before. See docs/DEPLOYMENT.md.
(function (g) {
  'use strict';
  const P = g.PIIRA;

  const DEFAULTS = Object.freeze({
    enabled: true,          // false switches the assistant off on every page
    defaultStage: 'L2',     // no longer used: one review list since beta 14
    pageSetup: null,        // company-wide page setup: {leftDocument, rightDocument, label}
    extraKnownNames: [],    // names added to data/business-names.json
    supportContact: '',     // shown in the panel footer ("Questions: …")
    model: 'user',          // on-device model: 'user' (each reviewer's option, default off), 'on', 'off'
  });

  let current = DEFAULTS;

  const isText = (v) => typeof v === 'string' && v.trim() !== '';
  const textList = (v) => (Array.isArray(v) ? v.filter(isText).map((s) => s.trim()) : []);

  /** A page setup in the same shape the click setup saves, or null when unusable. */
  function cleanSetup(v) {
    if (!v || typeof v !== 'object' || !isText(v.leftDocument) || !isText(v.rightDocument)) return null;
    const out = { leftDocument: v.leftDocument.trim(), rightDocument: v.rightDocument.trim() };
    const lab = v.label && typeof v.label === 'object' ? v.label : null;
    if (lab) {
      out.label = {
        ...(isText(lab.rightLabelSpan) ? { rightLabelSpan: lab.rightLabelSpan.trim() } : {}),
        labelNameAttributes: textList(lab.labelNameAttributes),
        labelClassPrefixes: textList(lab.labelClassPrefixes),
        ...(isText(lab.labelNameFromChild) ? { labelNameFromChild: lab.labelNameFromChild.trim() } : {}),
        ignoreInText: textList(lab.ignoreInText),
      };
    }
    return out;
  }

  /** Raw managed storage -> settings, ignoring anything of the wrong type. */
  function normalize(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    return Object.freeze({
      enabled: r.enabled !== false,
      defaultStage: r.defaultStage === 'L1' ? 'L1' : DEFAULTS.defaultStage,
      pageSetup: cleanSetup(r.pageSetup),
      extraKnownNames: textList(r.extraKnownNames),
      supportContact: isText(r.supportContact) ? r.supportContact.trim().slice(0, 200) : '',
      model: r.model === 'on' || r.model === 'off' ? r.model : 'user',
    });
  }

  async function load() {
    try {
      const managed = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.managed;
      current = normalize(managed ? await managed.get(null) : null);
    } catch (err) {
      // No policy installed (or not a managed browser): use the defaults.
      current = DEFAULTS;
    }
    return current;
  }

  P.policy = { load, normalize, DEFAULTS, get current() { return current; } };
})(globalThis);
