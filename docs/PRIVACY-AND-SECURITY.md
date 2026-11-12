# Privacy and security

The extension handles documents that are full of personal data. Its design rule is simple: **document text never leaves the reviewer's browser, and the extension never changes or submits the review on its own.**

## 1. Data flow

| Data | Where it goes | Stored |
|---|---|---|
| Document text (left and right) | Content scripts and the extension's offscreen page, in memory only | Never |
| Detections and findings | In memory, per tab | Never |
| Reviewer answers on **personal** values | Learning memory | As two 32-bit FNV-1a hashes of the value; examples as hashed feature numbers |
| Reviewer answers on **company names** and plain **"not PII"** words | Learning memory; team sync, if enabled | Plain value (these are public, not personal) |
| Page setup (CSS selectors) | `chrome.storage.local` | Selectors only, never text |
| Options | `chrome.storage.local` / policy | Settings only |
| "Report" and "Save task for testing" files | Downloaded to the reviewer's computer, on click only | Contain document excerpts; `.gitignore` keeps them out of the repository |

## 2. Isolation

- **Isolated world.** Content scripts run in Chrome's isolated world, so the site's scripts can't read the extension's state (`globalThis.PIIRA`).
- **Extension-origin storage.** IndexedDB lives in the service worker's (extension) origin, not the review site's, which the site could read (`sw/store.js`).
- **Closed Shadow DOM.** The panel's styles and DOM are separated from the page.
- **No DOM changes.** Highlights use the CSS Custom Highlight API and label tags sit in a separate fixed layer, so the page's DOM and text are never modified.
- **Data off the page.** Detection and the model run in the offscreen document (extension origin), so data never passes through page-visible channels.

## 3. Actions on the site

- **Auto-Fill and Auto-Apply** only open the site's own *Choose a label* popup, pick a label and press **Apply**, one word at a time, exactly as a reviewer would. They run only when the reviewer presses the button.
- **Never clicked:** Submit, Save, Complete, Approve and Reject.
- **Click setup** catches the reviewer's clicks while picking, so nothing on the page is triggered.

## 4. Network

- **Default:** no network requests. The model, tokenizer, Public Suffix List, name lists and knowledge base are all bundled.
- **Link checks are offline.** Links are judged from their text and the Public Suffix List, never by opening them, because opening a client's link would leak it.
- **Team sync** (optional, off by default):
  - Runs only in the service worker, against an HTTPS server the reviewer or admin configures, with an API key the page never sees.
  - **Sends:** company names, plain "not PII" words, the field name, the project.
  - **Never sends:** document text, names, phone numbers, IDs, keys, addresses, or hashes of them (`core/cloud-share.js`).

## 5. Permissions

Minimal by design. See [DEPLOYMENT.md § 5](DEPLOYMENT.md#5-permissions). Broad host access (`https://*/*`) is optional, and it's requested only for the one team-sync server.

## 6. Repository hygiene

- Model weights, packaged builds, signing keys and local test exports are excluded by `.gitignore`.
- The repository contains no client data. Add your organisation's client names to `data/client-business-names.js` locally.
- Report security issues privately to the maintainer, not as a public issue.
