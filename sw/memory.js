// The learning memory's storage (core/learning.js keeps a working copy in each tab). Writes are small
// and incremental: one remembered value and its example per answer. Other tabs hear about a write
// through chrome.storage ('piira.learning.rev') and reload.
'use strict';

const PiiraMemory = (() => {
  const OLD_KEY = 'piira.learning.v1';      // beta 10 kept everything in one chrome.storage.local document
  const REV_KEY = 'piira.learning.rev';

  // Move beta 10's memory into IndexedDB once, then drop the old document.
  async function migrate() {
    const old = (await chrome.storage.local.get(OLD_KEY))[OLD_KEY];
    if (!old) return;
    const ops = [];
    for (const [k, rec] of Array.isArray(old.mem) ? old.mem : []) ops.push({ store: 'memory', put: { ...rec, k } });
    for (const e of Array.isArray(old.ex) ? old.ex : []) if (e && e.k) ops.push({ store: 'examples', put: e });
    ops.push({ store: 'meta', put: { id: 'stats', ...(old.st || {}) } });
    await PiiraStore.apply(ops);
    await chrome.storage.local.remove(OLD_KEY);
  }

  async function load() {
    await migrate();
    const [memory, examples, stats] = await Promise.all([PiiraStore.all('memory'), PiiraStore.all('examples'), PiiraStore.get('meta', 'stats')]);
    return {
      ok: true,
      mem: memory.map((r) => { const { k, ...rec } = r; return [k, rec]; }),
      ex: examples,
      st: stats ? { seen: stats.seen || 0, hit: stats.hit || 0 } : { seen: 0, hit: 0 },
    };
  }

  async function write(msg) {
    const ops = [];
    for (const o of Array.isArray(msg.ops) ? msg.ops : []) {
      if (o.store !== 'memory' && o.store !== 'examples') continue;
      if (o.del !== undefined) ops.push({ store: o.store, del: String(o.del) });
      else if (o.put && typeof o.put.k === 'string') ops.push({ store: o.store, put: o.put });
    }
    if (msg.stats) ops.push({ store: 'meta', put: { id: 'stats', seen: +msg.stats.seen || 0, hit: +msg.stats.hit || 0 } });
    if (msg.clear) ops.unshift({ store: 'memory', clear: true }, { store: 'examples', clear: true });
    await PiiraStore.apply(ops);
    await chrome.storage.local.set({ [REV_KEY]: { at: Date.now(), from: String(msg.from || '') } });
    return { ok: true, written: ops.length };
  }

  return { load, write, REV_KEY };
})();
