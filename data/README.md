# data/

Offline reference data, bundled so the extension never needs to look anything up on the network.

| File | Contents |
|---|---|
| `names.js` | First names and surnames (from Wikidata), for name detection |
| `business-names.json` | Well-known public organisations (top companies, institutes, brands, global banks): not PII |
| `client-business-names.js` | Your organisation's client company and product names: always a Business Name. **Empty in this repository; add your own** |
| `indian-banks.js` | Indian banks, which are labeled as Business Name |
| `whitelisted-domains.js` | Domains whose links are never PII (team whitelist; empty by default) |
| `psl.js` | The Public Suffix List, for telling real domains from file names |
| `kb/meta.json` | Knowledge-base build information and sources |
| `kb/companies.json` | Companies with their Wikipedia reach (Wikidata, CC0) |
| `kb/people.json` | Public figures with their Wikipedia reach (Wikidata, CC0) |
| `kb/domains.json` | Top 100,000 domains (Tranco list) |
