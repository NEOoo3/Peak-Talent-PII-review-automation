// Shared namespace for every script in the extension.
// Content scripts run as classic scripts in Chrome's isolated world, so page
// scripts cannot see or modify this object. The same files are loaded by the
// Node unit tests, which is why everything hangs off globalThis.
(function (g) {
  'use strict';
  g.PIIRA = g.PIIRA || {};
  g.PIIRA.detectors = g.PIIRA.detectors || [];
})(globalThis);
