/*
 * Product options form (size, colors, material, sides, finishes, quantity,
 * turnaround) and the live price panel. Shared by the product page and the
 * designer so both calculate prices the same way.
 */
(function (root) {
  'use strict';
  const { h, fmtNum } = root.App;

  const UNITS = [
    { id: 'mm', name: 'mm', step: 1, digits: 0 },
    { id: 'cm', name: 'cm', step: 0.1, digits: 1 },
    { id: 'in', name: 'in', step: 0.01, digits: 2 },
  ];

  function defaultState(product, settings) {
    const preset = product.sizePresets[0];
    return {
      unit: 'mm',
      presetId: preset ? preset.id : 'custom',
      widthMm: preset ? preset.width : product.minWidth,
      heightMm: preset ? preset.height : product.minHeight,
      quantity: Math.max(product.minQuantity || 1, product.quantityTiers.length ? product.quantityTiers[0].minQty : 1),
      colorId: product.colorOptions[0] && product.colorOptions[0].id,
      materialId: product.materials[0] && product.materials[0].id,
      sideId: product.sides[0] && product.sides[0].id,
      finishIds: [],
      turnaroundId: settings.turnarounds[0] && settings.turnarounds[0].id,
    };
  }

  // Reads state from the URL, falling back to defaults for anything missing/invalid.
  function stateFromQuery(product, settings, params) {
    params = params || new URLSearchParams(location.search);
    const s = defaultState(product, settings);
    const has = (list, id) => list.some((x) => x.id === id);
    if (['mm', 'cm', 'in'].includes(params.get('unit'))) s.unit = params.get('unit');
    const w = Number(params.get('w'));
    const hh = Number(params.get('h'));
    if (w > 0 && hh > 0) {
      s.widthMm = w;
      s.heightMm = hh;
      const match = product.sizePresets.find((p) => p.width === w && p.height === hh);
      s.presetId = match ? match.id : product.allowCustomSize ? 'custom' : s.presetId;
      if (!match && !product.allowCustomSize) {
        const p = product.sizePresets[0];
        s.widthMm = p.width;
        s.heightMm = p.height;
      }
    }
    if (Number(params.get('qty')) > 0) s.quantity = Math.floor(Number(params.get('qty')));
    if (has(product.colorOptions, params.get('color'))) s.colorId = params.get('color');
    if (has(product.materials, params.get('material'))) s.materialId = params.get('material');
    if (has(product.sides, params.get('side'))) s.sideId = params.get('side');
    if (has(settings.turnarounds, params.get('turnaround'))) s.turnaroundId = params.get('turnaround');
    if (params.get('finishes')) s.finishIds = params.get('finishes').split(',').filter((f) => has(product.finishes, f));
    return s;
  }

  function stateToQuery(productId, s, extra) {
    const p = new URLSearchParams({
      product: productId,
      w: String(Pricing.round2(s.widthMm)),
      h: String(Pricing.round2(s.heightMm)),
      unit: s.unit,
      qty: String(s.quantity),
    });
    if (s.colorId) p.set('color', s.colorId);
    if (s.materialId) p.set('material', s.materialId);
    if (s.sideId) p.set('side', s.sideId);
    if (s.turnaroundId) p.set('turnaround', s.turnaroundId);
    if (s.finishIds.length) p.set('finishes', s.finishIds.join(','));
    for (const [k, v] of Object.entries(extra || {})) if (v) p.set(k, v);
    return p.toString();
  }

  function toQuoteInput(s) {
    return {
      widthMm: s.widthMm, heightMm: s.heightMm, quantity: s.quantity,
      colorId: s.colorId, materialId: s.materialId, sideId: s.sideId,
      finishIds: s.finishIds, turnaroundId: s.turnaroundId,
    };
  }

  let uid = 0;
  function radioChips(name, items, selectedId, onPick, describe) {
    const group = `${name}-${++uid}`;
    return h('div', { class: 'chips', role: 'radiogroup' },
      items.map((item) =>
        h('label', { class: 'chip', title: describe ? describe(item) : '' },
          h('input', { type: 'radio', name: group, value: item.id, checked: item.id === selectedId, onchange: () => onPick(item.id) }),
          h('span', null, item.name)
        )
      )
    );
  }

  /**
   * Renders the options form into `container`. Calls onChange(state) on every change.
   * opts.compact hides the helper text (used in the designer sidebar).
   */
  function createForm(container, product, settings, state, onChange, opts) {
    opts = opts || {};
    const unitInfo = () => UNITS.find((u) => u.id === state.unit);
    const disp = (mm) => Pricing.round2(Pricing.fromMm(mm, state.unit)).toFixed(unitInfo().digits).replace(/\.0+$/, '');

    function emit() {
      onChange(state);
    }

    // Typing a dimension switches the size picker to "Custom size".
    function toCustom() {
      if (state.presetId === 'custom') return;
      state.presetId = 'custom';
      const radio = container.querySelector('.config-section input[type=radio][value="custom"]');
      if (radio) radio.checked = true;
    }

    function render() {
      container.replaceChildren();

      // --- Size ---
      const sizeItems = product.sizePresets.map((p) => ({ id: p.id, name: p.name }));
      if (product.allowCustomSize) sizeItems.push({ id: 'custom', name: 'Custom size' });

      const widthInput = h('input', {
        type: 'number', min: 0, step: unitInfo().step, value: disp(state.widthMm), 'aria-label': 'Width',
        disabled: !product.allowCustomSize,
        oninput: (e) => { state.widthMm = Pricing.toMm(e.target.value, state.unit); toCustom(); emit(); },
      });
      const heightInput = h('input', {
        type: 'number', min: 0, step: unitInfo().step, value: disp(state.heightMm), 'aria-label': 'Height',
        disabled: !product.allowCustomSize,
        oninput: (e) => { state.heightMm = Pricing.toMm(e.target.value, state.unit); toCustom(); emit(); },
      });
      const unitSelect = h('select', {
        'aria-label': 'Unit',
        onchange: (e) => { state.unit = e.target.value; render(); emit(); },
      }, UNITS.map((u) => h('option', { value: u.id, selected: u.id === state.unit }, u.name)));

      const swap = h('button', {
        type: 'button', class: 'btn secondary small', title: 'Swap width and height (portrait / landscape)',
        onclick: () => {
          [state.widthMm, state.heightMm] = [state.heightMm, state.widthMm];
          if (state.presetId !== 'custom' && product.allowCustomSize) state.presetId = 'custom';
          render();
          emit();
        },
      }, '⇄ Rotate');

      container.appendChild(h('div', { class: 'config-section' },
        h('h3', null, 'Size'),
        radioChips('size', sizeItems, state.presetId, (id) => {
          state.presetId = id;
          const p = product.sizePresets.find((x) => x.id === id);
          if (p) { state.widthMm = p.width; state.heightMm = p.height; }
          render();
          emit();
        }),
        h('div', { class: 'row', style: 'margin-top:12px; align-items:end' },
          h('div', null, h('label', null, 'Width'), widthInput),
          h('div', null, h('label', null, 'Height'), heightInput),
          h('div', { style: 'flex:0 0 80px' }, h('label', null, 'Unit'), unitSelect),
          h('div', { style: 'flex:0 0 auto' }, swap)
        ),
        opts.compact ? null : h('p', { class: 'help' },
          `Allowed: ${disp(product.minWidth)}–${disp(product.maxWidth)} × ${disp(product.minHeight)}–${disp(product.maxHeight)} ${state.unit}`)
      ));

      // --- Colors / material / sides ---
      if (product.colorOptions.length) {
        container.appendChild(h('div', { class: 'config-section' }, h('h3', null, 'Colors'),
          radioChips('color', product.colorOptions, state.colorId, (id) => { state.colorId = id; emit(); })));
      }
      if (product.materials.length) {
        container.appendChild(h('div', { class: 'config-section' }, h('h3', null, 'Material'),
          radioChips('material', product.materials, state.materialId, (id) => { state.materialId = id; emit(); })));
      }
      if (product.sides.length > 1) {
        container.appendChild(h('div', { class: 'config-section' }, h('h3', null, 'Printed sides'),
          radioChips('side', product.sides, state.sideId, (id) => { state.sideId = id; emit(); })));
      }
      if (product.finishes.length) {
        container.appendChild(h('div', { class: 'config-section' }, h('h3', null, 'Finishing'),
          h('div', { class: 'chips' }, product.finishes.map((f) =>
            h('label', { class: 'chip' },
              h('input', {
                type: 'checkbox', value: f.id, checked: state.finishIds.includes(f.id),
                onchange: (e) => {
                  state.finishIds = e.target.checked
                    ? [...state.finishIds, f.id]
                    : state.finishIds.filter((x) => x !== f.id);
                  emit();
                },
              }),
              h('span', null, f.name)
            )))));
      }

      // --- Quantity & turnaround ---
      const qtyInput = h('input', {
        type: 'number', min: product.minQuantity || 1, step: 1, value: state.quantity, 'aria-label': 'Quantity',
        oninput: (e) => { state.quantity = Math.floor(Number(e.target.value)) || 0; emit(); },
      });
      const quick = [...new Set([product.minQuantity || 1, ...product.quantityTiers.map((t) => t.minQty)])].sort((a, b) => a - b);
      container.appendChild(h('div', { class: 'config-section' },
        h('h3', null, 'Quantity'),
        h('div', { class: 'row', style: 'align-items:center' },
          h('div', { style: 'flex:0 0 140px' }, qtyInput),
          h('div', { class: 'chips' }, quick.map((q) =>
            h('button', { type: 'button', class: 'btn secondary small', onclick: () => { state.quantity = q; qtyInput.value = q; emit(); } }, fmtNum(q))
          ))
        )
      ));

      if (settings.turnarounds.length) {
        container.appendChild(h('div', { class: 'config-section' }, h('h3', null, 'Turnaround'),
          radioChips('turnaround', settings.turnarounds.map((t) => ({
            id: t.id,
            name: `${t.name} · ${t.days === 0 ? 'today' : `${t.days} day${t.days === 1 ? '' : 's'}`}`,
          })), state.turnaroundId, (id) => { state.turnaroundId = id; emit(); })));
      }
    }

    render();
    return { render, getState: () => state };
  }

  function renderPrice(container, product, settings, state, result) {
    const money = (n) => Pricing.formatMoney(n, settings);
    container.replaceChildren();
    if (!result.ok) {
      container.appendChild(h('div', null,
        h('div', { class: 'price-total muted' }, '—'),
        h('ul', { class: 'price-lines' }, result.errors.map((e) => h('li', { class: 'error-text' }, e)))
      ));
      return;
    }
    const b = result.breakdown;
    const lines = [
      ['Size', `${fmtNum(Pricing.fromMm(b.widthMm, state.unit))} × ${fmtNum(Pricing.fromMm(b.heightMm, state.unit))} ${state.unit} (${fmtNum(b.areaSqm, 4)} m²)`],
      ['Price per piece', money(b.unitPrice)],
      [`Subtotal (${fmtNum(b.quantity)} pcs)`, money(b.subtotal)],
    ];
    const list = h('ul', { class: 'price-lines' }, lines.map(([k, v]) => h('li', null, h('span', null, k), h('span', null, v))));
    if (b.discount > 0) list.appendChild(h('li', { class: 'discount' }, h('span', null, `Volume discount (${b.discountPct}%)`), h('span', null, `−${money(b.discount)}`)));
    if (b.rushFee > 0) list.appendChild(h('li', null, h('span', null, `${b.turnaround.name} turnaround`), h('span', null, money(b.rushFee))));
    if (b.setupFee > 0) list.appendChild(h('li', null, h('span', null, 'Setup fee'), h('span', null, money(b.setupFee))));
    if (b.finishFlat > 0) list.appendChild(h('li', null, h('span', null, 'Finishing setup'), h('span', null, money(b.finishFlat))));
    if (b.tax > 0) list.appendChild(h('li', null, h('span', null, `Tax (${b.taxRate}%)`), h('span', null, money(b.tax))));

    container.appendChild(h('div', null,
      h('div', { class: 'muted small' }, 'Total price'),
      h('div', { class: 'price-total' }, money(b.total)),
      h('div', { class: 'muted small' }, `${money(b.perPiece)} per piece${b.minUnitPriceApplied ? ' · minimum piece price applied' : ''}`),
      list
    ));

    // Show what the next tiers would cost so customers see the savings.
    if (product.quantityTiers.length) {
      const rows = [{ minQty: product.minQuantity || 1, discountPct: 0 }, ...product.quantityTiers]
        .filter((t, i, arr) => arr.findIndex((x) => x.minQty === t.minQty) === i);
      const table = h('table', { class: 'tier-table' },
        h('thead', null, h('tr', null, h('th', null, 'Qty'), h('th', null, 'Discount'), h('th', null, 'Per piece'))),
        h('tbody', null, rows.map((t) => {
          const r = Pricing.calculate(product, { ...toQuoteInput(state), quantity: t.minQty }, settings);
          const active = Pricing.tierFor(product.quantityTiers, b.quantity);
          const isActive = active ? active.minQty === t.minQty : t.discountPct === 0;
          return h('tr', { class: isActive ? 'active' : '' },
            h('td', null, `${fmtNum(t.minQty)}+`),
            h('td', null, t.discountPct ? `${t.discountPct}%` : '—'),
            h('td', null, r.ok ? money(r.breakdown.perPiece) : '—'));
        }))
      );
      container.appendChild(h('details', { open: true }, h('summary', { class: 'small', style: 'cursor:pointer; font-weight:600' }, 'Buy more, save more'), table));
    }
  }

  // Updates the fixed price bar shown at the bottom of the screen on phones.
  function updateMobileBar(settings, result) {
    const total = document.getElementById('mb-total');
    if (!total) return;
    const sub = document.getElementById('mb-sub');
    const action = document.getElementById('mb-action');
    if (result.ok) {
      total.textContent = Pricing.formatMoney(result.breakdown.total, settings);
      sub.textContent = `${fmtNum(result.breakdown.quantity)} pcs · ${Pricing.formatMoney(result.breakdown.perPiece, settings)} each`;
    } else {
      total.textContent = '—';
      sub.textContent = result.errors[0] || '';
    }
    action.disabled = !result.ok;
  }

  function blankTemplate() {
    return {
      id: '',
      name: 'Your own artwork',
      background: '#ffffff',
      elements: [{ id: 'artwork', type: 'image', label: 'Upload your artwork', href: '', x: 0, y: 0, w: 100, h: 100, editable: true }],
    };
  }

  root.Options = { defaultState, stateFromQuery, stateToQuery, toQuoteInput, createForm, renderPrice, updateMobileBar, blankTemplate };
})(window);
