# sw/

Modules loaded by the service worker (`background.js` → `importScripts`). They run in the extension's own origin, so their storage can't be read by the review site.

| File | Purpose |
|---|---|
| `store.js` | IndexedDB wrapper: learning memory, examples, team profiles, outbox |
| `memory.js` | The learning memory's storage: small incremental writes, change notifications to other tabs |
| `cloud-sync.js` | Optional team sync: pulls a project's team list (cached, ETag), sends queued shareable answers; holds the server address and API key |
