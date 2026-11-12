// Domains whose URLs are NOT PII (the team's URL whitelist). A URL on one of these
// domains, or a subdomain of one, is never reported as URL/Link. Dummy domains
// (example.com, *.test…) are always skipped too.
//
// The team's list is still to be provided: add domains here, lower case, without
// "www." — e.g. 'wikipedia.org'. Reload the extension after editing.
(function (g) {
  'use strict';
  g.PIIRA.WHITELISTED_DOMAINS = [
  ];
})(globalThis);
