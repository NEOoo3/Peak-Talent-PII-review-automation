# Deployment and configuration

## 1. Install for one reviewer

1. Download or clone the repository.
2. *(Optional)* Put the model weights in place ([models/README.md](../models/README.md)).
3. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the folder.
4. Open a task on `*.peaktalent.ai` or `*.peaktalent.co`. The **PII** and **Auto-Fill PII** buttons appear at the bottom right.

To update: replace the files (or `git pull`) and press the reload icon on the extension card. Then reload the review tab.

## 2. Install for a team

Chrome can force-install the extension and push settings to every reviewer through enterprise policy:

1. **Package.** In `chrome://extensions`, click **Pack extension** to get a `.crx` and a key. Or publish to the Chrome Web Store as an unlisted or private item. Keep the `.pem` key private; it is excluded by `.gitignore`.
2. **Force-install.** Use `ExtensionInstallForcelist` (Google Admin console, Group Policy, or a configuration profile on macOS).
3. **Configure.** Push settings with `3rdparty.extensions.<extension-id>`, which follows the schema in `managed_schema.json` (below).

## 3. Policy settings (`managed_schema.json`)

Read by `core/policy.js`. Reviewers cannot change policy settings. Without a policy, every setting has its default.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `enabled` | boolean | `true` | `false` switches the extension off on every page |
| `pageSetup` | object | none | CSS selectors for the two documents and the label spans (`leftDocument`, `rightDocument`, `label.rightLabelSpan`, `labelNameAttributes`, `labelClassPrefixes`, `labelNameFromChild`, `ignoreInText`). A reviewer's own saved setup still wins |
| `extraKnownNames` | string[] | `[]` | Public organisation names added to the not-PII list. Redacting one is reported as over-scrubbing |
| `supportContact` | string | none | Shown in the panel footer (an email or a channel name) |
| `cloud` | object | off | Team sync: `enabled`, `endpoint` (https), `apiKey`, `share`. See [CLOUD.md](CLOUD.md) |
| `model` | `"user"` · `"on"` · `"off"` | `"user"` | The on-device model: each reviewer decides (`user`), on for everyone, or off for everyone |
| `defaultStage` | string | none | Not used since the two checks were merged into one list. Kept for compatibility |

Example:

```json
{
  "enabled": true,
  "model": "on",
  "supportContact": "#pii-review-help",
  "extraKnownNames": ["Contoso", "Fabrikam"],
  "cloud": { "enabled": false }
}
```

## 4. Reviewer options (`options/`)

| Section | Settings |
|---|---|
| Highlights | Show label names on highlighted text · Check selected text |
| On-device model | Use model suggestions, plus model status |
| Team sync | Sync on/off · server address · API key · project (optional) · share my answers · Test connection |

Panel settings, per reviewer:
- **Label set:** Auto, Standard or Golden.
- **Project:** Auto, All Apps, Code Base or General.
- **Highlights:** on or off.
- **Learning:** what the extension has learned, undo, reset, and export.

## 5. Permissions

| Permission | Why |
|---|---|
| `host_permissions`: `*.peaktalent.ai`, `*.peaktalent.co` | Run the content scripts on review tasks |
| `storage` | Saved page setup, options, learning revision signal; `chrome.storage.managed` for policy |
| `offscreen` | The hidden page that runs detection and the model off the review page |
| `optional_host_permissions`: `https://*/*`, localhost | Requested only when a reviewer turns on team sync, for that one server |
| CSP `wasm-unsafe-eval` | onnxruntime-web (WebAssembly) on extension pages only |
| COOP / COEP | Cross-origin isolation, for multi-threaded WASM in the offscreen page |

The extension makes no network requests unless team sync is configured.

## 6. When the site changes

- **Page markup.** `selectors.js` is the only file tied to it. Update the selectors there, or push `pageSetup` by policy, or let reviewers use **Set up manually**.
- **Labeling popup.** If the popup changes ("Choose a label", the label list, *Annotate matching entries*, Apply), update `page/site-labeler.js`.
- **Labels.** New or renamed labels go in `core/labels.js`.
