# page/

Everything that interacts with the review site's own UI.

| File | Purpose |
|---|---|
| `site-labeler.js` | Applies a label the way a person does: select text, then *Choose a label*, the exact label, *Annotate matching entries*, Apply. Also the word rules Auto-Fill follows. Never touches Submit |
| `site-observer.js` | Turns the reviewer's own label edits (added, changed, removed, Overscrubbed) into answers for learning |
| `url-rules.js` | Finds links in both documents, tells links from file names (Public Suffix List), and spots partly scrubbed links |
