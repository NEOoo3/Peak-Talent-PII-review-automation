# Detection and review rules

This document covers what the extension treats as PII, how each type is labeled in both label sets, and the review rules applied on top of detection. It follows the *PII / BII Annotation Guide* and the team's scope decisions.

## 1. PII types and labels

83 types. On the **standard** site every type folds into one of the 13 labels. On the **Golden** site each type is labeled with its own name, or the nearest Golden label where none exists.

| Type | Standard label (13) | Golden label | Scope |
|---|---|---|---|
| Person Name | Person Name | Person Name | |
| Person Username | Person Username | Person Username | |
| GitHub Username | Person Username | GitHub Username | |
| Email Address | Email Address | Email Address | |
| Contact Number | Contact Number | International Phone Number | |
| Indian Mobile Number | Contact Number | Indian Mobile Number | |
| International Phone Number | Contact Number | International Phone Number | |
| Address | Address | Address | |
| GPS Coordinates | Address | GPS Coordinates | |
| Postal Code | Address | Postal Code | out of scope |
| Brazilian CEP | Address | Brazilian CEP | out of scope |
| Indonesian Postal Code | Address | Indonesian Postal Code | out of scope |
| Date | Date | Date | out of scope |
| Date of Birth | Date | Date of Birth | |
| URL/Link | URL/Link | URL/Link | |
| Vehicle Number Plate | Vehicle Number Plate | Vehicle Number Plate | |
| Indian Vehicle Number Plate | Vehicle Number Plate | Indian Vehicle Number Plate | |
| Business Name | Business Name | Business Name | |
| Account Number | Account Number | Bank Account Number | |
| Bank Account Number | Account Number | Bank Account Number | |
| IBAN | Account Number | IBAN | |
| US Bank Account/Routing Number | Account Number | US Bank Account/Routing Number | |
| Payment Card Number (number, CVV, expiry) | Account Number | Payment Card Number | |
| Indian UPI ID | Account Number | Indian UPI ID | |
| Indian IFSC Code | Account Number | Indian IFSC Code | |
| Crypto Wallet Address | Account Number | Crypto Wallet Address | |
| Public IPv4 Address | IP Address | Public IPv4 Address | |
| Private IP Address | IP Address | Private IP Address | |
| IPv6 Address | IP Address | IPv6 Address | |
| MAC Address | IP Address | MAC Address | |
| Passport Number | Credentials | Passport Number | |
| Driver Licence Number | Credentials | Driver Licence Number | |
| IMEI Number | Credentials | IMEI Number | |
| Indian Aadhaar Number | Credentials | Indian Aadhaar Number | |
| Indian PAN (Individual) | Credentials | Indian PAN (Individual) | |
| Indian PAN (Business) | Credentials | Indian PAN (Business) | |
| Indian GSTIN | Credentials | Indian GSTIN | |
| Indian TAN | Credentials | Indian TAN | |
| Indian CIN | Credentials | Indian CIN | |
| Indian UAN | Credentials | Indian UAN | |
| Indian Voter ID | Credentials | Indian Voter ID | |
| US Social Security Number | Credentials | US Social Security Number | |
| US Passport Number | Credentials | US Passport Number | |
| US Employer Identification Number | Credentials | US Employer Identification Number | |
| US Driver Licence Number | Credentials | US Driver Licence Number | |
| Brazilian CPF | Credentials | Brazilian CPF | |
| Brazilian CNPJ | Credentials | Brazilian CNPJ | |
| Brazilian RG | Credentials | Brazilian RG | |
| Brazilian CNH | Credentials | Brazilian CNH | |
| Brazilian PIS/PASEP | Credentials | Brazilian PIS/PASEP | |
| Brazilian Voter Registration | Credentials | Brazilian Voter Registration | |
| Indonesian NIK | Credentials | Indonesian NIK | |
| Indonesian Family Card (KK) | Credentials | Indonesian Family Card (KK) | |
| Indonesian NPWP | Credentials | Indonesian NPWP | |
| Indonesian BPJS Number | Credentials | Indonesian BPJS Number | |
| Indonesian Civil Servant Number (NIP) | Credentials | Indonesian Civil Servant Number (NIP) | |
| Indonesian Passport Number | Credentials | Indonesian Passport Number | |
| Indonesian Driving Licence (SIM) | Credentials | Indonesian Driving Licence (SIM) | |
| Anthropic API Key | Credentials | Anthropic API Key | |
| OpenAI API Key | Credentials | OpenAI API Key | |
| Stripe Key | Credentials | Stripe Key | |
| AWS Access Key ID | Credentials | AWS Access Key ID | |
| AWS Secret Access Key | Credentials | AWS Secret Access Key | |
| Google API Key | Credentials | Google API Key | |
| Slack Token | Credentials | Slack Token | |
| GitHub Token | Credentials | GitHub Token | |
| GitLab Token | Credentials | GitLab Token | |
| SendGrid Key | Credentials | SendGrid Key | |
| npm Token | Credentials | npm Token | |
| PyPI Token | Credentials | PyPI Token | |
| Sentry Token | Credentials | Sentry Token | |
| JWT Token | Credentials | JWT Token | |
| Bearer Token | Credentials | Bearer Token | |
| Private Key Block | Credentials | Private Key Block | |
| Connection URL with Credentials | Credentials | Connection URL with Credentials | |
| Generic API Key | Credentials | Generic API Key | |
| Password (incl. PINs, OTPs, security answers) | Credentials | Password | |
| SSH Key (public key line) | Credentials | Generic API Key | |
| Cloud Account ID (12-digit, e.g. AWS) | Credentials | Credentials | |
| VPC ID | Credentials | Credentials | |
| Card ID (tokenized card reference) | Credentials | Payment Card Number | |
| Invocation ID (cloud function run) | Credentials | Credentials | |
| Transaction ID (bank, UTR, blockchain) | Credentials | Credentials | |

*Out of scope* types are still detected, so that a label on one can be explained as over-scrubbing, but they are not reported as PII (`P.SETTINGS.reportOutOfScope`).

When two detections cover the same text, the longer span wins, then the more specific type (`P.SPECIFICITY` in `core/labels.js`). For example, a GSTIN beats the PAN inside it.

## 2. Not PII

| Rule | Source |
|---|---|
| Well-known public companies, institutes, global banks, popular brands | `data/business-names.json`, `data/kb/` |
| Department and team names ("Field Services", "People Ops") | `P.DEPARTMENTS` in `core/labels.js` |
| Dummy values: `example.com`, `test@test.com`, `1234567890`, sequential or repeated digits, known test cards and PANs | detectors, `core/engine.js` |
| Placeholders: `YOUR_API_KEY`, `<token>`, `${SECRET}`, `xxxx` | `core/engine.js` |
| Record IDs: a number under an `…_id` key (`user_id`, `order_id`); **except** account, owner and transaction IDs | `core/engine.js` |
| Service mailboxes: `noreply@`, `notifications@`, `mailer-daemon@` | `core/engine.js` |
| Public links: package registries, open-source funding pages, team whitelist, popular homepages, template links (`https://{domain}/…`), XML namespaces | `detectors/url.js` |
| **Links to image files**: `.jpg .jpeg .png .webp .gif .svg .tif .tiff .raw` (also before `?…` / `#…`) | `detectors/url.js` |
| Plain hashes (checksums, commit IDs, lockfile integrity). Only hex values named as a key, secret, token or HMAC are credentials | `detectors/api-keys.js` |
| Plain dates and postal codes | out of scope (above) |

## 3. Review rules (left document vs. right document)

Applied by `content.js` after the label check and the redaction check.

| Situation | Result |
|---|---|
| PII on the left appears **unchanged** on the right | **PII still visible**: label it (Auto-Fill does) |
| PII **replaced** on the right, by any value, well or badly | **Redacted correctly**: no mark, no label suggestion, on either side |
| A **name replaced by another name** ("Rahul and Uday" → "Pavan and Amit") | Redacted correctly, even for lone first names |
| A **link changed anywhere** (`app.read.ai/…/01M0…` → `app.galeorysum.ai/…/24D2…`) | Redacted correctly. Only the identical link is a leak |
| A **prefixed ID changed** (`card_1NqX…` → `card_7PbR…`) | Redacted correctly |
| A **date, month or year** replaced (`May 2025` → `Mje 1523`, `2025` → `1523`) | **Overscrubbed**, unless it is a date of birth |
| A **date of birth** replaced (`DOB: 14/08/1989`, `Born on 3 March 1990`) | Redacted correctly |
| Text that is not PII replaced | **Overscrubbed** (digit-for-digit swaps excepted) |
| A value the reviewer marked **Not PII** | Not flagged again in any later document |

A date counts as a date of birth when:
- it was detected as one,
- or a birth keyword (DOB, Date of Birth, Birthday, Born on) comes right before it with no other number in between, or within a few characters after it ("14/08/1989 (DOB)").

## 4. Field and file-name hints

The field a value sits in can decide its type. `core/structured.js` reads CSV headers, JSON keys and `Key:` labels, and `core/pii-keys.js` maps field names to types:
- `nomor_kk` → Indonesian Family Card (KK)
- `us_bank_number` → US Bank Account/Routing Number
- `vpc_id` → VPC ID
- `transaction_id` → Transaction ID

A field can only claim a value that has the type's shape (`fitsType`).

The task file name works the same way: `by-pii-type~~kartu_keluarga~~…` hints that values are Indonesian KK numbers. Mapping decisions:
- `us_itin` → US Social Security Number. There is no ITIN type, and an ITIN has the SSN shape.
- `passport_number` files → US Passport Number. A plain `passport` column stays the generic Passport Number.

## 5. Projects

Tasks come from different projects, read from the task name's first part (`core/projects.js`). Each project can carry its own rules. For example, on Code Base, "Dev" is not a person and dev servers are not PII. The reviewer can switch the project in the panel.

## 6. Adding or changing a rule

1. **Detector.** Add or extend a file in `detectors/`: shape regex, validation, and keyword or field context. Register it with `P.util.register(label, detect)`.
2. **Type.** Add the type to `P.TYPES` (13-label family and scope), `P.SPECIFICITY`, and the Golden mapping (`GOLDEN` or `GOLDEN_FALLBACK`) in `core/labels.js`.
3. **Field names.** Add JSON and CSV key names and a strict shape check in `core/pii-keys.js`.
4. **Exclusions.** Put never-PII filters in `core/engine.js` (`neverPii`) or in the detector itself.
5. **Load order.** List any new file in `manifest.json` before `core/engine.js`, so the offscreen engine loads it too.
