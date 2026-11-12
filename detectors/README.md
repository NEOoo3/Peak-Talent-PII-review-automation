# detectors/

One rule-based detector per PII family. Each file registers a pure function `detect(text) → detections` with `P.util.register`. A detector reports the specific **type** (for example "Indian GSTIN"), and `core/engine.js` later maps it to the site label. Detectors combine shape patterns, checksums, keyword proximity and field names. Types and labels are listed in [docs/DETECTION-RULES.md](../docs/DETECTION-RULES.md).

| File | Detects |
|---|---|
| `person-name.js` | Person names: titles, form fields, salutations, sign-offs, name dictionary, repeats |
| `email-address.js` | Personal and business email addresses (dummy domains excluded) |
| `contact-number.js` | Indian mobile, international and landline numbers |
| `date.js` | Dates of birth (PII) and other dates (out of scope, detected for over-scrub checks) |
| `person-username.js` | Usernames, login IDs, @handles, GitHub usernames |
| `address.js` | Home and office addresses, from address anchors (Road, Nagar, Sector, PIN…) |
| `business-name.js` | Company names (suffixes, "Company:" fields, client names, task-title client) |
| `account-number.js` | Bank account numbers, IBAN (mod-97), masked account numbers |
| `ifsc-code.js` | Indian IFSC codes |
| `pan-card.js` | Indian PAN, individual or business by the 4th letter |
| `ip-address.js` | Public and private IPv4, IPv6, MAC addresses |
| `api-keys.js` | Vendor API keys and tokens (Anthropic, OpenAI, AWS, Stripe, GitHub…), JWTs, private keys, generic secrets |
| `password.js` | Passwords, PINs, OTPs, security answers |
| `aadhaar.js` | Indian Aadhaar numbers (Verhoeff checksum) |
| `driving-license.js` | Indian driving licence numbers |
| `voter-id.js` | Indian Voter ID (EPIC) |
| `card-number.js` | Payment card numbers (Luhn), CVV, expiry dates |
| `upi-id.js` | Indian UPI IDs |
| `url.js` | Links of people and organisations; public, template and image links excluded; connection URLs with credentials |
| `vehicle-plate.js` | Indian and other vehicle number plates |
| `gps.js` | GPS coordinates (decimal, hemispheres, degrees-minutes-seconds) |
| `postal-code.js` | Postal codes (out of scope; detected for over-scrub checks) |
| `crypto-wallet.js` | Ethereum/EVM and Bitcoin wallet addresses |
| `imei.js` | IMEI numbers (Luhn, with a keyword) |
| `passport.js` | Passport numbers (generic, US, Indonesian), with a keyword |
| `india-ids.js` | GSTIN, TAN, CIN, UAN |
| `us-ids.js` | SSN, EIN, US driver licence, US bank account and routing numbers |
| `brazil-ids.js` | CPF, CNPJ, RG, CNH, PIS/PASEP, voter registration (check digits) |
| `indonesia-ids.js` | NIK, family card (KK), NPWP, BPJS, NIP, SIM |
| `structured-fields.js` | Values typed by their column, JSON key or file name |
| `record-fields.js` | Ticket and change-log records: person fields, account IDs, Atlassian IDs |
| `cloud-ids.js` | SSH public keys, cloud account IDs (ARN, AWS), VPC IDs, card IDs, invocation IDs, transaction IDs |

**New detector:** create the file, list it in `manifest.json` before `core/engine.js`, and add its type to `core/labels.js`.
