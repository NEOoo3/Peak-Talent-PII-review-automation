# Changelog

From 2.2.0 on, each release is named after the next constellation in alphabetical order. Earlier builds were numbered betas of 2.1.

## 2.8.0 Gemini - Image Links
- Links that end in an image file (`.jpg .jpeg .png .webp .gif .svg .tif .tiff .raw`, also before `?…` / `#…`) are no longer tagged as URL/Link or Auto-Filled.

## 2.7.0 Fornax - Guide Rules
- Brought the rules in line with the *PII / BII Annotation Guide*.
- **New credential types**, with a label in both label sets:
  - Card ID (Golden: Payment Card Number)
  - SSH Key (Golden: Generic API Key)
  - Cloud Account ID
  - VPC ID
  - Invocation ID
  - Transaction ID (bank, UTR, blockchain)
- **Date of birth is now PII** (Date / Date of Birth). Plain dates stay out of scope.
- **Private IP addresses are now PII** in every project.
- AWS account IDs under `_account_id`, `accountId` and `…OwnerId` are labeled Credentials. Ordinary `…_id` record numbers are still ignored.
- "My username is …" is recognised.
- An ID changed on the right but keeping its prefix (`card_1Nq…` → `card_7Pb…`) counts as redacted.

## 2.6.0 Eridanus - Match All
- The hover card's **Auto-Apply** ticks *Annotate matching entries*. The main Auto-Fill does not.

## 2.5.0 Draco - Scrubbed Links
- A link changed anywhere on the right counts as redacted, with no URL/Link suggestion.
- A name replaced by another name counts as redacted, even a lone first name.

## 2.4.0 Cassiopeia - Form Links
- Links with template fields in the query (`…/viewform?entry.1={email}`) are real links. Template links (`https://{domain}/…`) and whitelisted links are no longer Auto-Filled.
- A closing `}` that belongs to the link stays in the label.

## 2.3.0 Bootes - Whole Value
- **Auto-Apply** labels every word of a value ("New York" → both words).

## 2.2.0 Andromeda - Dates
- A changed date, month or year is Overscrubbed. A changed date of birth is redacted correctly.
- Release codenames replaced beta numbers, with a codename chip in the panel footer and on the options page.

## 2.1 betas
| Build | Change |
|---|---|
| beta 19 Remember Keep | A "Not PII" answer is remembered on the click itself |
| beta 18 Leave Scrubbed | A value replaced on the right is done, business names included |
| beta 17 Offscreen | Detection runs off the page again (offscreen engine fix) |
| beta 16 Speed | Page-freeze fixes on large tasks, model thread cap, quieter page watcher |
| beta 15 Group Fill | Per-group Auto-Fill; short-word over-scrub fix |
| beta 14 One List | Label check and redaction check merged into one review list; Add sheet and select restyle |
| beta 13 Glass | Frosted-glass black-and-white UI |
| beta 12 Auto-Apply | Click-to-apply card on marked words |
| beta 11 Cloud | Optional team sync, IndexedDB memory, offscreen engine, Public Suffix List |
| beta 10 Golden | Golden project label set (80 labels) |
| beta 9 | Scrubbed names in record fields, account IDs, Auto-Fill reliability, coloured right-side marks, draggable launcher |
