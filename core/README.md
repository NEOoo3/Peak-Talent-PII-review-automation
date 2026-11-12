# core/

The shared engine: label definitions, the detection engine, document reading, learning, and the services the content script uses. Most files are pure and load in Node, the offscreen page and the review page alike.

| File | Purpose |
|---|---|
| `namespace.js` | Creates the shared namespace `globalThis.PIIRA` that every script attaches to |
| `policy.js` | Reads organisation settings pushed by Chrome enterprise policy (`managed_schema.json`) |
| `ext-client.js` | Promise wrapper for messages to the extension's background and offscreen pages; never rejects |
| `cloud-share.js` | Decides what may leave the device for team sync, and which project a task belongs to |
| `labels.js` | The 13 site labels, every PII type and its label, Golden label set, colours, specificity order |
| `util.js` | Detector helpers: regex collection, keyword proximity, trimming, checksum helpers, registration |
| `known-names.js` | Well-known public names (top companies, institutes, brands, banks) that are not PII |
| `knowledge.js` | Offline knowledge base lookups (Wikidata companies and people, Tranco top domains) |
| `redaction-rules.js` | Rules for the redaction check: same type, readable replacement, language and structure |
| `pii-keys.js` | Field and file names that say what a value is (`nomor_kk`, `vpc_id`) and strict shape checks |
| `structured.js` | Reads a document's structure: CSV headers, JSON keys, `Key:` labels and their values |
| `projects.js` | Detects the task's project and client from its name; per-project rules |
| `names.js` | First names and surnames lookup, so names are found without "Mr." or "Name:" |
| `table-context.js` | Uses table headings and field labels to confirm, retype or recover detections |
| `engine.js` | Runs every detector, resolves overlaps, assigns site labels and drops never-PII values |
| `engine-client.js` | Runs detection in the offscreen page, with an in-page fallback |
| `hybrid.js` | Merges rule detections with the GLiNER model's entities |
| `learning.js` | On-device learning: value memory (hashed) and a small learned classifier |
| `cloud-client.js` | Page side of team sync: pulls the team list, queues shareable answers |
| `model-client.js` | Page side of the on-device model: requests, status, timeouts |
| `text-model.js` | Turns a document element into plain text with a map back to DOM nodes |
| `dom.js` | Finds the task panels from `selectors.js` |
| `autodetect.js` | Finds the two documents and the label markup automatically |
| `config.js` | Effective selectors: saved setup or auto-detected, over the defaults |
| `layout.js` | Chooses the document layout: saved, policy, selectors, or auto-detected |
| `label-tags.js` | Label pills above detected values on the left document, in an overlay layer |
| `report.js` | "Report" and "Save task for testing" files; release name and version |
| `select-check.js` | Select-to-check card: is the selected text PII, and why |
| `page-watcher.js` | Watches the page for new tasks and label changes; triggers re-analysis (debounced) |
| `psl.js` | Public Suffix List lookups: suffix, registrable domain, subdomain (offline) |
