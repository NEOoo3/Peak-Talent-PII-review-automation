// Cloud and payment references from the PII/BII Annotation Guide ("PII Credentials"), all labeled Credentials
// on the 13-label site (core/labels.js gives the nearest Golden label):
//   - SSH Key: an SSH public key line ("ssh-rsa AAAAB3NzaC1yc2E… user@host"). Private keys are Private Key Block.
//   - Cloud Account ID: a 12-digit cloud account, in an ARN ("arn:aws:iam::125636728392:role/…") or next to
//     "AWS account". JSON keys (account_id, …OwnerId) are read by detectors/record-fields.js.
//   - VPC ID: "vpc-0a1b2c3d4e5f67890".
//   - Card ID: a tokenized card reference ("card_1NqX2kLkdIwHu7ixAbCdEfGh", "pm_…", "src_…", "tok_…").
//   - Invocation ID: one run of a cloud function ("invocationId": "…", Lambda's "RequestId: …" log lines).
//   - Transaction ID: a bank or blockchain transaction ("Transaction ID: TXN2024…", "tx hash 0x5c50…", UTR).
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const U = P.util;

  const SSH = /(?<![\w-])(?:ssh-(?:rsa|dss|ed25519)|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh\.com)[ \t]+AAAA[A-Za-z0-9+\/]{20,}={0,3}/gd;
  const ARN = /\barn:aws[\w-]*:[\w-]+:[\w-]*:(\d{12}):/gd;
  const AWS_ACCOUNT = /\b(?:aws|amazon)[ \t]+account(?:[ \t]+(?:id|number|no\.?))?[ \t]*(?:is|[:=#-])?[ \t]*["']?(\d{4}[ -]?\d{4}[ -]?\d{4})(?![\d-])/gid;
  const VPC = /(?<![\w-])vpc-(?:[0-9a-f]{17}|[0-9a-f]{8})(?![\w-])/gd;
  const CARD_ID = /(?<![\w-])(?:card|pm|src|tok)_(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{14,}(?![\w-])/gd;
  const VALUE = String.raw`["']?[ \t]*(?:is[ \t]*)?[:=#]?[ \t]*["']?`;
  const INVOCATION = new RegExp(String.raw`\b(?:invocation|execution|(?:aws|lambda)[ _-]?request)[ _-]?id\b${VALUE}([A-Za-z0-9][\w-]{7,})`, 'gid');
  const LAMBDA_LOG = /\b(?:START|END|REPORT)[ \t]+RequestId:[ \t]*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gd;
  const TRANSACTION = new RegExp(String.raw`\b(?:transaction|txn|tx)(?:[ _-]?(?:id|hash|ref(?:erence)?|no\.?|number))?\b${VALUE}(0x[0-9a-fA-F]{64}|[A-Za-z0-9][\w-]{7,})`, 'gid');
  const UTR = new RegExp(String.raw`\bUTR(?:[ _-]?(?:no\.?|number))?\b${VALUE}([A-Z0-9]{12,22})\b`, 'gd');
  const hasDigit = (v) => /\d/.test(v);

  U.register('Credentials', (text) => [
    ...U.collect(text, SSH, 'SSH Key', 0.95, 'regex', { rule: 'ssh-public-key' }),
    ...U.collect(text, ARN, 'Cloud Account ID', 0.93, 'regex', { group: 1, rule: 'cloud-account-arn' }),
    ...U.collect(text, AWS_ACCOUNT, 'Cloud Account ID', 0.9, 'regex', { group: 1, rule: 'cloud-account-aws' }),
    ...U.collect(text, VPC, 'VPC ID', 0.93, 'regex', { rule: 'vpc-id' }),
    ...U.collect(text, CARD_ID, 'Card ID', 0.92, 'regex', { rule: 'card-id' }),
    ...U.collect(text, INVOCATION, 'Invocation ID', (v) => (hasDigit(v) ? 0.9 : null), 'regex', { group: 1, rule: 'invocation-id' }),
    ...U.collect(text, LAMBDA_LOG, 'Invocation ID', 0.9, 'regex', { group: 1, rule: 'invocation-lambda-log' }),
    ...U.collect(text, TRANSACTION, 'Transaction ID', (v) => (hasDigit(v) ? 0.88 : null), 'regex', { group: 1, rule: 'transaction-id' }),
    ...U.collect(text, UTR, 'Transaction ID', (v) => (hasDigit(v) ? 0.88 : null), 'regex', { group: 1, rule: 'transaction-utr' }),
  ]);
})(globalThis);
