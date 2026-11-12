// IndexedDB in the extension's own origin (the service worker), never the page's: a content script's
// IndexedDB belongs to peaktalent.ai and the site's own scripts could read it.
//
//   memory    remembered answers, one record per value key      {k, l, f, n, t, w, s}
//   examples  the learned model's training examples, per key    {k, x, y, t, s, f}
//   meta      small documents by id                             {id: 'stats' | 'cloud-status' | …}
//   outbox    corrections waiting to be sent to the team server {id (auto), project, item}
//   profiles  cached team profiles per project                  {project, profile, fetchedAt, etag}
'use strict';

const PiiraStore = (() => {
  const NAME = 'piira';
  const VERSION = 1;
  let opening = null;

  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('memory')) db.createObjectStore('memory', { keyPath: 'k' });
        if (!db.objectStoreNames.contains('examples')) db.createObjectStore('examples', { keyPath: 'k' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('profiles')) db.createObjectStore('profiles', { keyPath: 'project' });
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
      req.onerror = () => { opening = null; reject(req.error); };
    });
    return opening;
  }

  const done = (tx) => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
  const result = (req) => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  async function all(store) {
    const db = await open();
    return result(db.transaction(store, 'readonly').objectStore(store).getAll());
  }
  async function get(store, key) {
    const db = await open();
    return result(db.transaction(store, 'readonly').objectStore(store).get(key));
  }
  /** Writes and deletes in one transaction: ops = [{store, put: value} | {store, del: key} | {store, clear: true}]. */
  async function apply(ops) {
    if (!ops.length) return;
    const db = await open();
    const stores = [...new Set(ops.map((o) => o.store))];
    const tx = db.transaction(stores, 'readwrite');
    for (const o of ops) {
      const s = tx.objectStore(o.store);
      if (o.clear) s.clear();
      else if (o.del !== undefined) s.delete(o.del);
      else s.put(o.put);
    }
    return done(tx);
  }
  async function count(store) {
    const db = await open();
    return result(db.transaction(store, 'readonly').objectStore(store).count());
  }
  /** Oldest `limit` records of a store (outbox order). */
  async function head(store, limit) {
    const db = await open();
    const out = [];
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur || out.length >= limit) { resolve(out); return; }
        out.push(cur.value);
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }

  return { open, all, get, apply, count, head };
})();
