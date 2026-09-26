(async function () {
  'use strict';
  const { api, h, qs, initShell, fmtNum } = App;

  const settings = await initShell();
  let product;
  try {
    product = await api(`/api/products/${encodeURIComponent(qs('id') || '')}`);
  } catch (e) {
    document.getElementById('product-name').textContent = 'Product not found';
    document.getElementById('product-desc').replaceChildren(h('a', { href: '/' }, 'Back to all products'));
    return;
  }

  document.title = `${product.name} — ${settings.companyName}`;
  document.getElementById('product-name').textContent = `${product.icon || ''} ${product.name}`.trim();
  document.getElementById('product-desc').textContent = product.description;

  const params = new URLSearchParams(location.search);
  const state = Options.stateFromQuery(product, settings, params);
  const priceBox = document.getElementById('price');
  const preview = document.getElementById('size-preview');
  const suggestGrid = document.getElementById('suggest-grid');
  const uploadBtn = document.getElementById('upload-btn');

  let suggestTimer = null;
  let lastSuggestKey = '';

  function updatePreview() {
    const w = state.widthMm;
    const hgt = state.heightMm;
    preview.replaceChildren();
    if (!(w > 0 && hgt > 0)) return;
    const box = 148;
    const scale = box / Math.max(w, hgt);
    preview.appendChild(h('div', {
      class: 'paper',
      style: `width:${Math.max(12, w * scale)}px;height:${Math.max(12, hgt * scale)}px`,
    }, `${fmtNum(Pricing.fromMm(w, state.unit))} × ${fmtNum(Pricing.fromMm(hgt, state.unit))} ${state.unit}`));
  }

  async function loadSuggestions() {
    const key = `${Math.round(state.widthMm)}x${Math.round(state.heightMm)}`;
    if (key === lastSuggestKey) return;
    lastSuggestKey = key;
    const list = await api(`/api/templates/suggest?productId=${encodeURIComponent(product.id)}&width=${state.widthMm}&height=${state.heightMm}&limit=12`);
    const fitLabel = { good: 'Perfect fit', ok: 'Fits with small changes', poor: 'Different shape' };
    if (!list.length) {
      suggestGrid.replaceChildren(h('p', { class: 'muted' }, 'No templates for this product yet — upload your own artwork instead.'));
      return;
    }
    suggestGrid.replaceChildren(
      ...list.map((t) =>
        h('div', { class: 'card template-card' },
          // Preview the template at the customer's size so they see the real result.
          h('div', { class: 'design-thumb' }, Render.renderDesign(t, state.widthMm, state.heightMm)),
          h('div', { class: 'template-meta' }, h('strong', null, t.name), h('span', { class: `badge ${t.fit}` }, fitLabel[t.fit])),
          h('a', { class: 'btn small', href: `/design?${Options.stateToQuery(product.id, state, { template: t.id })}` }, 'Use this template')
        )
      )
    );
  }

  function update() {
    const result = Pricing.calculate(product, Options.toQuoteInput(state), settings);
    Options.renderPrice(priceBox, product, settings, state, result);
    updatePreview();
    uploadBtn.href = `/design?${Options.stateToQuery(product.id, state, { template: 'blank' })}`;
    history.replaceState(null, '', `?id=${encodeURIComponent(product.id)}&${Options.stateToQuery(product.id, state).replace(/^product=[^&]*&/, '')}`);
    clearTimeout(suggestTimer);
    if (state.widthMm > 0 && state.heightMm > 0) suggestTimer = setTimeout(() => loadSuggestions().catch(console.error), 250);
  }

  Options.createForm(document.getElementById('options'), product, settings, state, update);
  update();
})().catch((err) => {
  console.error(err);
  App.toast('Something went wrong loading this product.', 'error');
});
