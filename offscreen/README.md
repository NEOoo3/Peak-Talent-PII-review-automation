# offscreen/

A hidden extension page (Chrome offscreen document) that does the heavy work away from the review page, so large documents never freeze the site. It is cross-origin isolated, which allows multi-threaded WebAssembly.

| File | Purpose |
|---|---|
| `offscreen.html` | Loads onnxruntime-web and the scripts below |
| `engine-host.js` | Runs the same rule detectors as the content script (loaded from `manifest.json`) for detection requests |
| `gliner-core.js` | GLiNER in plain JavaScript: SentencePiece tokenizer, prompt building, span decoding around the ONNX model |
| `prompts.js` | Which entity types the model is asked for, and how its answers map to site labels |
| `model-host.js` | Loads the model from `models/multi_pii/`, runs detection requests within a time budget, caches results, frees memory when idle |
