# Team sync (optional)

Off by default. Detection always runs in the browser. The server only stores a per-project team list (company names and
plain "not PII" words) and receives those two kinds of answers. It is a separate service (FastAPI + SQLite, Dockerfile
included), referred to as `../piira-cloud` and not part of this repository; this page documents its protocol.

## Flow

```
reviewer answer ──► core/learning.js (IndexedDB, extension origin)
                     └► core/cloud-share.js filter ──► sw/cloud-sync.js outbox
Submit (watched, never clicked) ──► POST /v1/projects/{project}/corrections
server: 2 reviewers agree (or admin approves) ──► profile version + 1
next task ──► GET /v1/projects/{project}/profile (ETag, 10-min cache, offline fallback)
           └► team list applied below the reviewer's own answers
```

| Leaves the device | Never leaves |
|---|---|
| Business Name values, plain "not PII" words, the field name, the project | Document text, names, phones, IDs, keys, addresses, hashes of them |

## Turn it on

1. Deploy the server (see `../piira-cloud/README.md`), set `PIIRA_REVIEWER_KEYS` and `PIIRA_ADMIN_KEYS`.
2. Each reviewer: extension options → **Team sync** → server address (https), API key → **Save**
   (Chrome asks once for access to that one server) → **Test connection**.
3. Or for everyone, by Chrome policy (`managed_schema.json`):

```json
{ "cloud": { "enabled": true, "endpoint": "https://piira.example.com", "apiKey": "<reviewer key>", "share": true } }
```

Reviewers still grant access to the server once (optional host permission). `"enabled": false` switches sync off for
everyone; `"share": false` receives the team list without sending answers.

## Project settings from the server

`PUT /v1/projects/{project}/settings` (admin key): `{"labelSet": "golden" | "standard" | null, "thresholds":
{"model.min": 0.15, "model.add": 0.2, "model.strong": 0.4}}`. Applied when the reviewer's label set is on Auto.

## Project id

The task name's first part (`rai_codebase~~DK9__…` → `rai_codebase`), else `default`; a reviewer can fix it in options.
