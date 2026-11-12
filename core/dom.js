// Finds the task panels on the page using selectors.js.
(function (g) {
  'use strict';
  const P = g.PIIRA;

  function first(list, root) {
    const invalid = [];
    for (const sel of list || []) {
      try {
        const el = (root || document).querySelector(sel);
        if (el) return { el, invalid };
      } catch (e) {
        invalid.push(sel);
      }
    }
    return { el: null, invalid };
  }

  /**
   * @returns {{ok:true,left,right} | {ok:false,message,details:string[]}}
   */
  function locate(S) {
    S = S || P.SELECTORS;
    const left = first(S.leftDocument);
    const right = first(S.rightDocument);
    const details = [];
    if (!left.el) details.push(`Left document not found (selectors.js → leftDocument: ${JSON.stringify(S.leftDocument)})`);
    if (!right.el) details.push(`Right document not found (selectors.js → rightDocument: ${JSON.stringify(S.rightDocument)})`);
    for (const bad of left.invalid.concat(right.invalid)) details.push(`Invalid CSS selector: ${bad}`);
    if (left.el && right.el && (left.el === right.el || left.el.contains(right.el) || right.el.contains(left.el))) {
      details.push('leftDocument and rightDocument point at the same (or nested) element.');
    }
    if (details.length) {
      return { ok: false, message: "Couldn't find the document panels — update selectors.js", details };
    }
    return { ok: true, left: left.el, right: right.el };
  }

  P.dom = { locate };
})(globalThis);
