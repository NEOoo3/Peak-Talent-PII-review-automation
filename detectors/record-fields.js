// Ticket and change-log records (Jira / Atlassian exports, from a teammate's version): the field name says what the
// value is.
//   - Person Name: the value of a person field ("assignee", "reporter", "creator", "author", "Custom field (CC)",
//     "(QA Contact)", "createdBy"…), also lists ("Ravi Kumar, Priya Sharma") and change-log entries
//     ({"field": "assignee", "from": "…", "to": "…"}). Placeholders ("Unassigned", "Automation", "System") are not people.
//   - Credentials: account IDs — an "accountId" / "*_account_id" value, an AWS "…OwnerId" 12-digit account,
//     and Atlassian IDs ("557058:1a2b…-…").
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const U = P.util;

  const NAME_KEY = /(?:^|[^a-z])(?:assignee|reporter|creator|author|owner|lead|reviewer|approver|tester|developer|requester|requestor|participants?|watchers?|contact|cc|(?:created|updated|modified|assigned)[ _]?by|full[ _]?name|display[ _]?name|first[ _]?name|last[ _]?name)(?![a-z])/i;
  const NOT_NAME_KEY = /(email|mail|account|_id|\bid\b|url|link|key|token|time|date|status|count|milestone|schema|geo|version|type|priority|sprint|label|component|summary|description)/i;
  const ACCOUNT_KEY = /account[ _]?id/i;
  // AWS resources name their account as an owner: "OwnerId", "SourceSecurityGroupOwnerId" with a 12-digit account ID.
  const AWS_OWNER_KEY = /owner[ _]?id$/i;
  const NOT_NAME_WORDS = new Set(('unassigned none null nobody anonymous automation system admin administrator unknown existing ' +
    'manual open closed tbd yes no true false other team support desk group department service services helpdesk bot queue ' +
    'committee board office n/a na').split(' '));
  const NAME_TOKEN = /^\p{Lu}[\p{L}\p{M}'’.\-]{0,40}$/u;
  const ATLASSIAN_ID = /\b\d{5,7}(?::|%3A)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gid;
  // One key/value pair of JSON text (plain or with escaped quotes).
  const KV = /\\?"([^"\n\\]{1,80})\\?"\s*:\s*\\?"([^"\n]{1,500}?)\\?"/gd;
  const FROM_TO = /"field"\s*:\s*"([^"\n]{1,60})"\s*,\s*"from"\s*:\s*(?:null|"([^"\n]*)")\s*,\s*"to"\s*:\s*(?:null|"([^"\n]*)")/gd;

  const isNameKey = (key) => NAME_KEY.test(key) && !NOT_NAME_KEY.test(key);
  function looksLikeName(s) {
    const tokens = String(s || '').trim().split(/\s+/);
    if (!tokens[0] || tokens.length > 5) return false;
    if (!tokens.every((t) => NAME_TOKEN.test(t) && !NOT_NAME_WORDS.has(t.toLowerCase()))) return false;
    return tokens.some((t) => t.replace(/[.'’\-]/g, '').length >= 2);
  }

  function detect(text) {
    if (!text.includes('"')) return [];
    const out = [];
    const names = (valueStart, value) => {
      for (const seg of value.matchAll(/[^,;&\/\[\]]+/g)) {
        const t = seg[0].trim();
        if (!t || !looksLikeName(t)) continue;
        const s = valueStart + seg.index + seg[0].indexOf(t);
        const d = U.make(text, s, s + t.length, 'Person Name', 0.9, 'context', 'record-name-field');
        d.pinned = true; // the field decides where the name starts and ends
        out.push(d);
      }
    };
    for (const m of text.matchAll(KV)) {
      const [key, val] = [m[1], m[2]];
      const vs = m.indices[2][0];
      if (isNameKey(key) && !val.includes('@')) names(vs, val);
      else if (ACCOUNT_KEY.test(key) || (AWS_OWNER_KEY.test(key) && /^\s*\d{12}\s*$/.test(val))) {
        const t = val.trim();
        if (/^[A-Za-z0-9:%_.\-]{8,}$/.test(t)) {
          const s = vs + val.indexOf(t);
          // A 12-digit value is a cloud (AWS) account; other account IDs (Atlassian "5b10ac8d…") are keys.
          const d = U.make(text, s, s + t.length, /^\d{12}$/.test(t) ? 'Cloud Account ID' : 'Generic API Key', 0.93, 'context', 'record-account-id');
          d.pinned = true;
          out.push(d);
        }
      }
    }
    for (const m of text.matchAll(FROM_TO)) {
      if (!isNameKey(m[1])) continue;
      if (m[2] && m.indices[2]) names(m.indices[2][0], m[2]);
      if (m[3] && m.indices[3]) names(m.indices[3][0], m[3]);
    }
    out.push(...U.collect(text, ATLASSIAN_ID, 'Generic API Key', 0.93, 'regex', { rule: 'atlassian-account-id' }));
    return out;
  }

  P.recordFields = { looksLikeName, isNameKey };
  U.register('Person Name', detect);
})(globalThis);
