# models/

The optional on-device model: **GLiNER multi-PII** (mDeBERTa-v3 base encoder), exported to ONNX with int8 weights. It runs in the offscreen page with onnxruntime-web and adds names, companies, addresses and usernames to the rule detections.

| File | Purpose |
|---|---|
| `multi_pii/config.json`, `gliner_config.json` | Model configuration (span mode, max width, entity tokens) |
| `multi_pii/tokenizer.json`, `tokenizer_config.json`, `special_tokens_map.json`, `added_tokens.json` | SentencePiece tokenizer used by `offscreen/gliner-core.js` |
| `multi_pii/onnx/model_int8.onnx` | **Model weights, about 350 MB. Not in this repository** (GitHub's limit is 100 MB) |

## Adding the weights

1. Obtain the int8 ONNX export of the GLiNER multi-PII model that matches these tokenizer and config files.
2. Save it as `models/multi_pii/onnx/model_int8.onnx`. The folder is excluded by `.gitignore`.
3. Reload the extension and turn on **Use model suggestions** in the options (or push `"model": "on"` by policy).

Without the weights the model status shows *not installed* and the extension works on rules alone.
