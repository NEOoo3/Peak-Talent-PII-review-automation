// Values whose field says what they are: a CSV/TSV column, a JSON key or a "Key:" label
// (core/structured.js), and the task's file name ("by-pii-type~~kartu_keluarga~~…", core/pii-keys.js).
//   - A value under a typed field gets that type when it has the type's shape:
//     nomor_kk: "9451533181049204" -> Indonesian Family Card (KK).
//   - In a CSV/JSON file, a value under a field with no known name gets the file's type when it has
//     that type's shape (a "value" column in a us_bank_number file).
// The file name alone never turns free text into PII: a git log in an aws_secret_key file is full of
// 40-character hashes that are not secrets.
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const U = P.util;

  // Free-text "Key:" fields only for fixed-shape types; names, companies and addresses there are
  // left to their own detectors, which know where such values end.
  const LOOSE = new Set(['Person Name', 'Business Name', 'Address', 'Person Username', 'GitHub Username', 'URL/Link', 'Password',
    'Postal Code', 'Date of Birth']);

  // A "name" that names a thing, not a person: the record's own id ({"id":"CHAT","name":"CHAT"}), a constant
  // (CATEGORY_SOCIAL), or the name of a mailbox label / folder (Gmail label exports: labelListVisibility…).
  const ID_KEYS = /^(?:id|key|slug|code|type|kind|value|label|labelId|uid)$/i;
  const THING_RECORD = /^(?:labelListVisibility|messageListVisibility|messagesTotal|threadsTotal|threadsUnread|messagesUnread|folderId|parentFolderId|childFolderCount|totalItemCount|unreadItemCount)$/;
  function namesAThing(structure, text, c, value) {
    const v = value.trim();
    if (/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(v)) return true;
    const ls = text.lastIndexOf('\n', c.start - 1) + 1;
    let le = text.indexOf('\n', c.end);
    if (le < 0) le = text.length;
    const record = structure.cells.filter((o) => o !== c && o.start >= ls && o.end <= le);
    return record.some((o) => THING_RECORD.test(o.key) ||
      (ID_KEYS.test(o.key) && text.slice(o.start, o.end).trim().toLowerCase() === v.toLowerCase()));
  }

  function detect(text, ctx) {
    const structure = (ctx && ctx.structure) || P.structured.parse(text);
    const hint = ctx && ctx.hint;
    const K = P.piiKeys;
    const out = [];
    if (!structure) return out;
    // A name-like file type (Person Name, username…) is only given to the one column nobody claims.
    const unclaimed = new Set(structure.cells.filter((c) => !c.type && !c.nonPii && c.source !== 'field').map((c) => c.key));
    for (const c of structure.cells) {
      if (c.nonPii) continue;
      const value = text.slice(c.start, c.end);
      let type = null;
      if (c.type) {
        if (c.source === 'field' && LOOSE.has(c.type)) continue;
        // The file's type is more specific than the column's when they are the same kind (passport -> US passport).
        type = hint && K.sameFamily(hint.type, c.type) && K.fitsType(hint.type, value) ? hint.type : c.type;
        if (!K.fitsType(type, value)) continue;
      } else if (hint && structure.format && c.source !== 'field' && (!LOOSE.has(hint.type) || unclaimed.size === 1) &&
        K.fitsType(hint.type, value)) {
        type = hint.type;
      }
      if (!type) continue;
      if (type === 'Person Name' && namesAThing(structure, text, c, value)) continue;
      const d = U.make(text, c.start, c.end, type, c.type ? 0.93 : 0.8, 'context', `field-${c.source}`);
      d.field = c.key;
      d.pinned = true; // the field decides where the value starts and ends
      out.push(d);
    }
    return out;
  }

  P.namesAThing = namesAThing;
  U.register('Field context', detect);
})(globalThis);
