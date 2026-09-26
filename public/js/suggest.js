/*
 * Ranks templates by how well their proportions match the requested print
 * size, so suggested layouts don't get squashed. Shared by server and browser.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Suggest = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function suggestTemplates(templates, { productId, width, height }) {
    const targetRatio = width > 0 && height > 0 ? width / height : null;
    return templates
      .filter((t) => !productId || t.productIds.includes(productId))
      .map((t) => {
        const ratio = t.width / t.height;
        // Log distance treats 2:1 and 1:2 symmetrically; 0 = identical shape.
        const distance = targetRatio ? Math.abs(Math.log(targetRatio / ratio)) : 0;
        let fit = 'good';
        if (distance > 0.35) fit = 'poor';
        else if (distance > 0.12) fit = 'ok';
        return { ...t, fit, fitScore: Math.round((1 / (1 + distance)) * 100) };
      })
      .sort((a, b) => b.fitScore - a.fitScore || a.name.localeCompare(b.name));
  }

  return { suggestTemplates };
});
