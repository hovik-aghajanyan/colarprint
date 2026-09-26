(async function () {
  'use strict';
  const { api, h, initShell } = App;

  const settings = await initShell();
  const [products, templates] = await Promise.all([api('/api/products'), api('/api/templates')]);
  const productById = Object.fromEntries(products.map((p) => [p.id, p]));

  // "From" price = cheapest preset at the minimum quantity with default options.
  function fromPrice(product) {
    const base = Options.defaultState(product, settings);
    const sizes = product.sizePresets.length
      ? product.sizePresets
      : [{ width: product.minWidth, height: product.minHeight }];
    let best = null;
    for (const s of sizes) {
      const r = Pricing.calculate(product, { ...Options.toQuoteInput(base), widthMm: s.width, heightMm: s.height, quantity: product.minQuantity || 1 }, settings);
      if (r.ok && (best === null || r.breakdown.total < best)) best = r.breakdown.total;
    }
    return best;
  }

  const grid = document.getElementById('product-grid');
  grid.replaceChildren(
    ...products.map((p) => {
      const price = fromPrice(p);
      return h('a', { class: 'card product-card', href: `/product?id=${encodeURIComponent(p.id)}` },
        h('div', { class: 'product-icon' }, p.icon || '🖨️'),
        h('h3', null, p.name),
        h('p', { class: 'muted small' }, p.description),
        h('div', { class: 'from' }, price !== null ? `From ${Pricing.formatMoney(price, settings)}` : 'Get a quote')
      );
    })
  );

  function thumb(tpl) {
    return h('div', { class: 'design-thumb' }, Render.renderDesign(tpl, tpl.width, tpl.height));
  }

  const hero = document.getElementById('hero-art');
  hero.replaceChildren(...templates.slice(0, 4).map(thumb));

  const tGrid = document.getElementById('template-grid');
  const filters = document.getElementById('template-filters');
  const categories = ['All', ...new Set(templates.map((t) => t.category))];
  let active = 'All';

  function renderTemplates() {
    const list = templates.filter((t) => active === 'All' || t.category === active);
    tGrid.replaceChildren(
      ...list.map((t) => {
        const product = productById[t.productIds.find((id) => productById[id])];
        const href = product ? `/design?product=${encodeURIComponent(product.id)}&template=${encodeURIComponent(t.id)}` : null;
        return h('div', { class: 'card template-card' },
          thumb(t),
          h('div', { class: 'template-meta' },
            h('strong', null, t.name),
            h('span', { class: 'badge' }, t.category)),
          h('div', { class: 'muted small' }, t.productIds.map((id) => productById[id] && productById[id].name).filter(Boolean).join(', ')),
          href ? h('a', { class: 'btn secondary small', href }, 'Customize') : null
        );
      })
    );
    filters.replaceChildren(
      ...categories.map((c) =>
        h('button', { class: `btn small ${c === active ? '' : 'secondary'}`, onclick: () => { active = c; renderTemplates(); } }, c)
      )
    );
  }
  renderTemplates();
})().catch((err) => {
  console.error(err);
  App.toast('Could not load the shop. Please refresh.', 'error');
});
