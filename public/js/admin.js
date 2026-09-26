(function () {
  'use strict';
  const { h, toast, fmtNum } = App;

  const TOKEN_KEY = 'colorprint-admin-token';
  const STATUS_LABELS = {
    new: 'New', in_production: 'In production', ready: 'Ready', shipped: 'Shipped', completed: 'Completed', cancelled: 'Cancelled',
  };

  let token = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch (e) { /* storage unavailable */ }
  let settings = null;
  let currentView = 'dashboard';

  const view = document.getElementById('view');
  const modal = document.getElementById('modal');
  const modalContent = document.getElementById('modal-content');

  // ---------- API + auth ----------
  async function adminApi(path, options) {
    options = options || {};
    try {
      const data = await App.api(`/api/admin${path}`, {
        ...options,
        headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
      });
      if (options.method && options.method !== 'GET') renderStaticBanner();
      return data;
    } catch (err) {
      if (err.status === 401) showLogin();
      throw err;
    }
  }

  function setToken(t) {
    token = t;
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* ignore */ }
  }

  function showLogin() {
    setToken(null);
    document.getElementById('shell').classList.add('hidden');
    document.getElementById('login').classList.remove('hidden');
    document.getElementById('password').focus();
  }

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('login-error');
    err.textContent = '';
    try {
      const res = await App.api('/api/admin/login', { method: 'POST', body: { password: document.getElementById('password').value } });
      setToken(res.token);
      document.getElementById('password').value = '';
      start();
    } catch (ex) {
      err.textContent = ex.message;
    }
  });

  document.getElementById('logout').addEventListener('click', async () => {
    try { await adminApi('/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
    showLogin();
  });

  document.querySelectorAll('#admin-nav [data-view]').forEach((btn) =>
    btn.addEventListener('click', () => go(btn.dataset.view))
  );

  function go(name) {
    currentView = name;
    location.hash = name;
    document.querySelectorAll('#admin-nav [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    closeModal();
    const views = { dashboard: renderDashboard, orders: renderOrders, products: renderProducts, templates: renderTemplates, settings: renderSettings };
    view.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
    renderStaticBanner();
    (views[name] || renderDashboard)().catch((err) => {
      if (err.status !== 401) view.replaceChildren(h('p', { class: 'error-text' }, err.message));
    });
  }

  async function start() {
    try {
      settings = await adminApi('/settings');
    } catch (e) {
      if (e.status !== 401) toast(e.message, 'error');
      return;
    }
    document.getElementById('login').classList.add('hidden');
    document.getElementById('shell').classList.remove('hidden');
    await App.initShell();
    go((location.hash || '#dashboard').slice(1));
  }

  // ---------- Modal ----------
  function openModal(...children) {
    modalContent.replaceChildren(...children);
    modal.classList.remove('hidden');
  }
  function closeModal() {
    modal.classList.add('hidden');
    modalContent.replaceChildren();
  }
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  const money = (n, currency) => Pricing.formatMoney(n, { currency: currency || settings.currency });

  // ---------- Generic editable table ----------
  /**
   * rows: array (mutated in place). columns: [{ key, label, type: 'text'|'number'|'color', step, width }]
   */
  function tableEditor(rows, columns, { newRow, onChange, addLabel }) {
    const wrap = h('div');
    function render() {
      wrap.replaceChildren(
        h('div', { class: 'table-wrap' },
          h('table', { class: 'data' },
            h('thead', null, h('tr', null, ...columns.map((c) => h('th', null, c.label)), h('th', null, ''))),
            h('tbody', null,
              rows.length ? null : h('tr', null, h('td', { colspan: columns.length + 1, class: 'muted small' }, 'None yet.')),
              rows.map((row, i) =>
                h('tr', null,
                  ...columns.map((c) =>
                    h('td', { style: c.width ? `width:${c.width}` : '' },
                      h('input', {
                        type: c.type || 'text', step: c.step, value: row[c.key] === undefined ? '' : row[c.key], placeholder: c.placeholder,
                        'aria-label': c.label,
                        oninput: (e) => {
                          row[c.key] = c.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value;
                          onChange();
                        },
                      }))
                  ),
                  h('td', { style: 'width:1%; white-space:nowrap' },
                    h('button', { type: 'button', class: 'btn ghost small', title: 'Move up', disabled: i === 0, onclick: () => { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; render(); onChange(); } }, '↑'),
                    h('button', { type: 'button', class: 'btn ghost small', title: 'Remove', onclick: () => { rows.splice(i, 1); render(); onChange(); } }, '✕'))
                )
              )
            )
          )
        ),
        h('button', { type: 'button', class: 'btn secondary small', style: 'margin-top:8px', onclick: () => { rows.push(newRow()); render(); onChange(); } }, addLabel || '+ Add row')
      );
    }
    render();
    return wrap;
  }

  function inputField(obj, key, label, opts) {
    opts = opts || {};
    const attrs = {
      id: `f-${key}`, type: opts.type || 'text', step: opts.step, min: opts.min, value: obj[key] === undefined ? '' : obj[key],
      oninput: (e) => {
        obj[key] = opts.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value;
        if (opts.onChange) opts.onChange();
      },
    };
    const input = opts.type === 'textarea' ? h('textarea', { ...attrs, type: undefined }, obj[key] || '') : h('input', attrs);
    return h('div', { class: 'field' }, h('label', { for: attrs.id }, label), input, opts.help ? h('p', { class: 'help' }, opts.help) : null);
  }

  function checkboxField(obj, key, label, onChange) {
    return h('label', { style: 'display:flex; gap:8px; align-items:center; font-weight:500' },
      h('input', { type: 'checkbox', checked: obj[key] !== false, onchange: (e) => { obj[key] = e.target.checked; if (onChange) onChange(); } }),
      label);
  }

  // ---------- Dashboard ----------
  async function renderDashboard() {
    const [stats, orders] = await Promise.all([adminApi('/stats'), adminApi('/orders')]);
    const stat = (label, value) => h('div', { class: 'card stat' }, h('div', { class: 'muted small' }, label), h('div', { class: 'value' }, value));
    view.replaceChildren(
      h('h1', null, 'Dashboard'),
      h('div', { class: 'stats' },
        stat('Orders', fmtNum(stats.orders)),
        stat('Revenue (excl. cancelled)', money(stats.revenue)),
        stat('New orders', fmtNum(stats.byStatus.new || 0)),
        stat('In production', fmtNum(stats.byStatus.in_production || 0)),
        stat('Products', fmtNum(stats.products)),
        stat('Templates', fmtNum(stats.templates))),
      h('div', { class: 'card' }, h('h3', null, 'Recent orders'), ordersTable(orders.slice(0, 8), () => renderDashboard()))
    );
  }

  // ---------- Orders ----------
  function ordersTable(orders, reload) {
    if (!orders.length) return h('p', { class: 'muted' }, 'No orders yet. They will appear here when customers check out.');
    return h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', null, h('tr', null, ...['Order', 'Date', 'Customer', 'Product', 'Size', 'Qty', 'Total', 'Status', ''].map((t) => h('th', null, t)))),
      h('tbody', null, orders.map((o) =>
        h('tr', null,
          h('td', null, h('strong', null, o.id)),
          h('td', null, new Date(o.createdAt).toLocaleDateString()),
          h('td', null, o.customer.name, h('div', { class: 'small muted' }, o.customer.email)),
          h('td', null, o.productName),
          h('td', null, `${fmtNum(o.quote.widthMm)} × ${fmtNum(o.quote.heightMm)} mm`),
          h('td', null, fmtNum(o.quote.quantity)),
          h('td', null, money(o.quote.total, o.currency)),
          h('td', null, statusSelect(o, reload)),
          h('td', null, h('button', { class: 'btn secondary small', onclick: () => showOrder(o, reload) }, 'View'))
        )
      ))
    ));
  }

  function statusSelect(order, reload) {
    return h('select', {
      'aria-label': 'Status',
      onchange: async (e) => {
        try {
          await adminApi(`/orders/${encodeURIComponent(order.id)}`, { method: 'PATCH', body: { status: e.target.value } });
          order.status = e.target.value;
          toast(`Order ${order.id} → ${STATUS_LABELS[order.status]}`, 'success');
          if (reload) reload();
        } catch (err) {
          toast(err.message, 'error');
        }
      },
    }, Object.entries(STATUS_LABELS).map(([k, v]) => h('option', { value: k, selected: k === order.status }, v)));
  }

  async function renderOrders() {
    const orders = await adminApi('/orders');
    let filter = 'all';
    let search = '';
    const tableBox = h('div');
    const draw = () => {
      const q = search.toLowerCase();
      const list = orders.filter((o) =>
        (filter === 'all' || o.status === filter) &&
        (!q || [o.id, o.customer.name, o.customer.email, o.productName].some((s) => String(s).toLowerCase().includes(q))));
      tableBox.replaceChildren(ordersTable(list, draw));
    };
    view.replaceChildren(
      h('h1', null, 'Orders'),
      h('div', { class: 'card' },
        h('div', { class: 'toolbar', style: 'margin-bottom:12px' },
          h('input', { type: 'text', placeholder: 'Search order, customer, product…', style: 'max-width:320px', oninput: (e) => { search = e.target.value; draw(); } }),
          h('select', { style: 'max-width:200px', onchange: (e) => { filter = e.target.value; draw(); } },
            h('option', { value: 'all' }, 'All statuses'),
            Object.entries(STATUS_LABELS).map(([k, v]) => h('option', { value: k }, v)))),
        tableBox)
    );
    draw();
  }

  function showOrder(o, reload) {
    const b = o.quote;
    const row = (k, v) => h('tr', null, h('th', null, k), h('td', null, v));
    const design = o.design;
    let preview = null;
    if (design) {
      const svg = Render.renderDesign(design, b.widthMm, b.heightMm);
      preview = h('div', null,
        h('div', { class: 'design-thumb', style: 'aspect-ratio:auto; min-height:220px' }, svg),
        h('div', { class: 'toolbar', style: 'margin-top:8px' },
          h('button', { class: 'btn secondary small', onclick: async () => {
            const url = await Render.svgToPng(svg, 2400);
            const a = h('a', { href: url, download: `${o.id}.png` });
            document.body.appendChild(a); a.click(); a.remove();
          } }, 'Download PNG'),
          h('button', { class: 'btn secondary small', onclick: () => {
            const blob = new Blob([Render.svgToString(svg)], { type: 'image/svg+xml' });
            const url = URL.createObjectURL(blob);
            const a = h('a', { href: url, download: `${o.id}.svg` });
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          } }, 'Download SVG'),
          ...design.elements.filter((e) => e.type === 'image' && e.href).map((e, i) =>
            h('a', { class: 'btn secondary small', href: e.href, download: e.label || `artwork-${i + 1}` }, `Original: ${e.label || `image ${i + 1}`}`))
        ),
        design.templateName ? h('p', { class: 'small muted' }, `Template: ${design.templateName}`) : null
      );
    }
    openModal(
      h('div', { class: 'section-head' },
        h('h2', null, `Order ${o.id}`),
        h('button', { class: 'btn ghost', onclick: closeModal }, '✕')),
      h('div', { class: 'split' },
        h('div', null,
          preview || h('p', { class: 'muted' }, 'No design attached.'),
          h('h3', { style: 'margin-top:16px' }, 'Customer'),
          h('table', { class: 'data' }, h('tbody', null,
            row('Name', o.customer.name), row('Email', h('a', { href: `mailto:${o.customer.email}` }, o.customer.email)),
            row('Phone', o.customer.phone || '—'), row('Address', o.customer.address || 'Pickup'), row('Notes', o.customer.notes || '—')))),
        h('div', null,
          h('div', { class: 'field' }, h('label', null, 'Status'), statusSelect(o, reload)),
          h('table', { class: 'data' }, h('tbody', null,
            row('Product', o.productName),
            row('Size', `${fmtNum(b.widthMm)} × ${fmtNum(b.heightMm)} mm (${b.areaSqm} m²)`),
            row('Quantity', fmtNum(b.quantity)),
            row('Colors', b.color ? b.color.name : '—'),
            row('Material', b.material ? b.material.name : '—'),
            row('Sides', b.side ? b.side.name : '—'),
            row('Finishing', b.finishes.length ? b.finishes.map((f) => f.name).join(', ') : '—'),
            row('Turnaround', b.turnaround ? b.turnaround.name : '—'),
            row('Per piece', money(b.unitPrice, o.currency)),
            row('Subtotal', money(b.subtotal, o.currency)),
            row('Discount', b.discount ? `−${money(b.discount, o.currency)} (${b.discountPct}%)` : '—'),
            row('Rush fee', money(b.rushFee, o.currency)),
            row('Setup + finishing fees', money(b.setupFee + b.finishFlat, o.currency)),
            row('Tax', money(b.tax, o.currency)),
            row(h('strong', null, 'Total'), h('strong', null, money(b.total, o.currency))),
            row('Placed', new Date(o.createdAt).toLocaleString()))),
          h('button', { class: 'btn danger small', style: 'margin-top:16px', onclick: async () => {
            if (!confirm(`Delete order ${o.id}? This cannot be undone.`)) return;
            try {
              await adminApi(`/orders/${encodeURIComponent(o.id)}`, { method: 'DELETE' });
              toast('Order deleted', 'success');
              closeModal();
              go(currentView);
            } catch (err) { toast(err.message, 'error'); }
          } }, 'Delete order')))
    );
  }

  // ---------- Products ----------
  async function renderProducts() {
    const products = await adminApi('/products');
    view.replaceChildren(
      h('div', { class: 'section-head' },
        h('div', null, h('h1', null, 'Products & pricing'), h('p', { class: 'muted' }, 'Set the price per m², size limits, colors, materials, finishes and bulk discounts.')),
        h('button', { class: 'btn', onclick: () => editProduct(null) }, '+ New product')),
      h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', null, h('tr', null, ...['', 'Product', 'Price / m²', 'Min piece', 'Setup fee', 'Min qty', 'Status', ''].map((t) => h('th', null, t)))),
        h('tbody', null, products.map((p) => h('tr', null,
          h('td', { style: 'font-size:1.5rem; width:1%' }, p.icon),
          h('td', null, h('strong', null, p.name), h('div', { class: 'small muted' }, `${p.sizePresets.length} sizes · ${p.colorOptions.length} color options · ${p.materials.length} materials`)),
          h('td', null, money(p.pricePerSqm)),
          h('td', null, money(p.minUnitPrice)),
          h('td', null, money(p.setupFee)),
          h('td', null, fmtNum(p.minQuantity)),
          h('td', null, h('span', { class: `badge ${p.active ? 'good' : ''}` }, p.active ? 'Active' : 'Hidden')),
          h('td', { style: 'white-space:nowrap' },
            h('button', { class: 'btn secondary small', onclick: () => editProduct(p) }, 'Edit'), ' ',
            h('a', { class: 'btn ghost small', href: `product.html?id=${encodeURIComponent(p.id)}`, target: '_blank', rel: 'noopener' }, 'View'))
        )))
      )))
    );
  }

  function editProduct(existing) {
    const p = existing
      ? JSON.parse(JSON.stringify(existing))
      : {
          name: '', icon: '🖨️', description: '', active: true, pricePerSqm: 20, minUnitPrice: 1, setupFee: 0, minQuantity: 1,
          minWidth: 50, maxWidth: 1000, minHeight: 50, maxHeight: 1000, allowCustomSize: true,
          sizePresets: [{ id: '', name: 'A4 (210 × 297 mm)', width: 210, height: 297 }],
          colorOptions: [{ id: 'bw', name: 'Black & White', multiplier: 1 }, { id: 'cmyk', name: 'Full Color (CMYK)', multiplier: 1.6 }],
          materials: [{ id: '', name: 'Standard paper', pricePerSqm: 0 }],
          sides: [{ id: 'single', name: 'Single sided', multiplier: 1 }],
          finishes: [],
          quantityTiers: [],
        };

    const testerBox = h('div');
    const testerPrice = h('div', { style: 'margin-top:12px' });
    let testState = null;

    // The tester uses the unsaved draft so the admin sees the effect of changes immediately.
    function draftProduct() {
      const num = (v, d) => (v === '' || v === undefined || Number.isNaN(Number(v)) ? d : Number(v));
      const withIds = (list) => list.map((x, i) => ({ ...x, id: x.id || `opt-${i}` }));
      return {
        ...p,
        pricePerSqm: num(p.pricePerSqm, 0), minUnitPrice: num(p.minUnitPrice, 0), setupFee: num(p.setupFee, 0),
        minQuantity: num(p.minQuantity, 1), minWidth: num(p.minWidth, 1), maxWidth: num(p.maxWidth, 1e4),
        minHeight: num(p.minHeight, 1), maxHeight: num(p.maxHeight, 1e4),
        sizePresets: withIds(p.sizePresets).map((s) => ({ ...s, width: num(s.width, 0), height: num(s.height, 0) })),
        colorOptions: withIds(p.colorOptions).map((c) => ({ ...c, multiplier: num(c.multiplier, 1) })),
        materials: withIds(p.materials).map((m) => ({ ...m, pricePerSqm: num(m.pricePerSqm, 0) })),
        sides: withIds(p.sides).map((s) => ({ ...s, multiplier: num(s.multiplier, 1) })),
        finishes: withIds(p.finishes).map((f) => ({ ...f, perUnit: num(f.perUnit, 0), perSqm: num(f.perSqm, 0), flat: num(f.flat, 0) })),
        quantityTiers: p.quantityTiers.map((t) => ({ minQty: num(t.minQty, 1), discountPct: num(t.discountPct, 0) })),
      };
    }

    function rebuildTester() {
      const draft = draftProduct();
      const prev = testState;
      testState = Options.defaultState(draft, settings);
      if (prev) {
        // Keep the tester's size/quantity when the admin edits prices.
        Object.assign(testState, { unit: prev.unit, widthMm: prev.widthMm, heightMm: prev.heightMm, quantity: prev.quantity });
        const keep = (list, key) => { if (list.some((x) => x.id === prev[key])) testState[key] = prev[key]; };
        keep(draft.colorOptions, 'colorId'); keep(draft.materials, 'materialId'); keep(draft.sides, 'sideId');
        const match = draft.sizePresets.find((s) => s.width === prev.widthMm && s.height === prev.heightMm);
        testState.presetId = match ? match.id : draft.allowCustomSize ? 'custom' : testState.presetId;
        testState.finishIds = prev.finishIds.filter((id) => draft.finishes.some((f) => f.id === id));
      }
      Options.createForm(testerBox, draft, settings, testState, () => updateTester(draft), { compact: true });
      updateTester(draft);
    }
    function updateTester(draft) {
      const result = Pricing.calculate(draft, Options.toQuoteInput(testState), settings);
      Options.renderPrice(testerPrice, draft, settings, testState, result);
    }
    let timer = null;
    const changed = () => { clearTimeout(timer); timer = setTimeout(rebuildTester, 300); };

    const section = (title, help, ...content) =>
      h('div', { class: 'card editor-section' }, h('h3', null, title), help ? h('p', { class: 'help', style: 'margin-top:-6px' }, help) : null, ...content);

    const error = h('p', { class: 'error-text' });
    const save = async () => {
      error.textContent = '';
      try {
        const body = { ...p };
        if (existing) await adminApi(`/products/${encodeURIComponent(existing.id)}`, { method: 'PUT', body });
        else await adminApi('/products', { method: 'POST', body });
        toast('Product saved', 'success');
        renderProducts();
      } catch (err) {
        error.textContent = err.message;
        toast(err.message, 'error');
      }
    };

    view.replaceChildren(
      h('div', { class: 'section-head' },
        h('div', null,
          h('p', { class: 'small' }, h('a', { href: '#products', onclick: (e) => { e.preventDefault(); renderProducts(); } }, '← All products')),
          h('h1', null, existing ? `Edit ${existing.name}` : 'New product')),
        h('div', { class: 'toolbar' },
          existing ? h('button', { class: 'btn danger', onclick: async () => {
            if (!confirm(`Delete ${existing.name}? Templates will be unlinked from it.`)) return;
            try { await adminApi(`/products/${encodeURIComponent(existing.id)}`, { method: 'DELETE' }); toast('Product deleted', 'success'); renderProducts(); } catch (err) { toast(err.message, 'error'); }
          } }, 'Delete') : null,
          h('button', { class: 'btn', onclick: save }, 'Save product'))),
      error,
      h('div', { class: 'split' },
        h('div', null,
          section('Basics', null,
            h('div', { class: 'row' },
              h('div', { style: 'flex:0 0 90px' }, inputField(p, 'icon', 'Icon')),
              inputField(p, 'name', 'Name')),
            inputField(p, 'description', 'Description', { type: 'textarea' }),
            checkboxField(p, 'active', 'Visible in the shop')),
          section('Base pricing', 'Piece price = area (m²) × (price per m² + material extra) × color multiplier × sides multiplier, never below the minimum piece price.',
            h('div', { class: 'row' },
              inputField(p, 'pricePerSqm', `Price per m² (${settings.currency})`, { type: 'number', step: '0.01', onChange: changed }),
              inputField(p, 'minUnitPrice', 'Minimum price per piece', { type: 'number', step: '0.01', onChange: changed }),
              inputField(p, 'setupFee', 'Setup fee per order', { type: 'number', step: '0.01', onChange: changed }),
              inputField(p, 'minQuantity', 'Minimum quantity', { type: 'number', step: '1', onChange: changed }))),
          section('Size limits (mm)', 'Customers can enter any size inside these limits when custom sizes are allowed.',
            h('div', { class: 'row' },
              inputField(p, 'minWidth', 'Min width', { type: 'number', onChange: changed }),
              inputField(p, 'maxWidth', 'Max width', { type: 'number', onChange: changed }),
              inputField(p, 'minHeight', 'Min height', { type: 'number', onChange: changed }),
              inputField(p, 'maxHeight', 'Max height', { type: 'number', onChange: changed })),
            checkboxField(p, 'allowCustomSize', 'Allow custom sizes', changed)),
          section('Size presets', 'Standard sizes shown as quick picks (millimetres).',
            tableEditor(p.sizePresets, [
              { key: 'name', label: 'Name' },
              { key: 'width', label: 'Width (mm)', type: 'number', width: '120px' },
              { key: 'height', label: 'Height (mm)', type: 'number', width: '120px' },
            ], { newRow: () => ({ id: '', name: '', width: 100, height: 100 }), onChange: changed, addLabel: '+ Add size' })),
          section('Color options', 'Multiplier on the print cost, e.g. 1 = base price, 1.6 = 60% more for full color.',
            tableEditor(p.colorOptions, [
              { key: 'name', label: 'Name' },
              { key: 'multiplier', label: 'Multiplier', type: 'number', step: '0.05', width: '120px' },
            ], { newRow: () => ({ id: '', name: '', multiplier: 1 }), onChange: changed, addLabel: '+ Add color option' })),
          section('Materials', 'Extra price per m² added to the base price (can be 0 or negative).',
            tableEditor(p.materials, [
              { key: 'name', label: 'Name' },
              { key: 'pricePerSqm', label: 'Extra / m²', type: 'number', step: '0.01', width: '120px' },
            ], { newRow: () => ({ id: '', name: '', pricePerSqm: 0 }), onChange: changed, addLabel: '+ Add material' })),
          section('Printed sides', 'Multiplier on the print cost.',
            tableEditor(p.sides, [
              { key: 'name', label: 'Name' },
              { key: 'multiplier', label: 'Multiplier', type: 'number', step: '0.05', width: '120px' },
            ], { newRow: () => ({ id: '', name: '', multiplier: 1 }), onChange: changed, addLabel: '+ Add option' })),
          section('Finishing options', 'Optional extras. Per piece + per m² are charged on every piece; the flat fee once per order.',
            tableEditor(p.finishes, [
              { key: 'name', label: 'Name' },
              { key: 'perUnit', label: 'Per piece', type: 'number', step: '0.01', width: '100px' },
              { key: 'perSqm', label: 'Per m²', type: 'number', step: '0.01', width: '100px' },
              { key: 'flat', label: 'Flat fee', type: 'number', step: '0.01', width: '100px' },
            ], { newRow: () => ({ id: '', name: '', perUnit: 0, perSqm: 0, flat: 0 }), onChange: changed, addLabel: '+ Add finish' })),
          section('Quantity discounts', 'The highest tier the quantity reaches applies.',
            tableEditor(p.quantityTiers, [
              { key: 'minQty', label: 'From quantity', type: 'number', step: '1' },
              { key: 'discountPct', label: 'Discount %', type: 'number', step: '0.5' },
            ], { newRow: () => ({ minQty: 100, discountPct: 5 }), onChange: changed, addLabel: '+ Add tier' }))
        ),
        h('div', { class: 'sticky' },
          h('div', { class: 'card' }, h('h3', null, 'Price tester'), h('p', { class: 'help' }, 'Preview what customers will pay with your unsaved changes.'), testerPrice, h('hr', { style: 'border:0; border-top:1px solid var(--border); margin:16px 0' }), testerBox)))
    );
    rebuildTester();
    window.scrollTo(0, 0);
  }

  // ---------- Templates ----------
  async function renderTemplates() {
    const [templates, products] = await Promise.all([adminApi('/templates'), adminApi('/products')]);
    const names = Object.fromEntries(products.map((p) => [p.id, p.name]));
    view.replaceChildren(
      h('div', { class: 'section-head' },
        h('div', null, h('h1', null, 'Templates'), h('p', { class: 'muted' }, 'Design templates customers can personalise. Positions are in % so they adapt to any size.')),
        h('button', { class: 'btn', onclick: () => editTemplate(null, products) }, '+ New template')),
      h('div', { class: 'grid' }, templates.map((t) =>
        h('div', { class: 'card template-card' },
          h('div', { class: 'design-thumb' }, Render.renderDesign(t, t.width, t.height)),
          h('div', { class: 'template-meta' }, h('strong', null, t.name), h('span', { class: 'badge' }, t.category)),
          h('div', { class: 'small muted' }, t.productIds.map((id) => names[id] || id).join(', ') || 'Not linked to a product'),
          h('div', { class: 'toolbar' },
            h('button', { class: 'btn secondary small', onclick: () => editTemplate(t, products) }, 'Edit'),
            h('button', { class: 'btn ghost small', onclick: () => editTemplate({ ...JSON.parse(JSON.stringify(t)), id: '', name: `${t.name} copy` }, products, true) }, 'Duplicate'))
        )))
    );
  }

  const ELEMENT_FIELDS = {
    text: [
      ['label', 'Label', 'text'], ['text', 'Text', 'textarea'], ['x', 'X %', 'number'], ['y', 'Y %', 'number'],
      ['size', 'Size % of height', 'number'], ['color', 'Color', 'color'],
      ['weight', 'Weight', ['normal', 'bold']], ['align', 'Align', ['start', 'middle', 'end']], ['editable', 'Customer can edit', 'checkbox'],
    ],
    rect: [['x', 'X %', 'number'], ['y', 'Y %', 'number'], ['w', 'Width %', 'number'], ['h', 'Height %', 'number'], ['rx', 'Corner radius', 'number'], ['fill', 'Fill', 'color']],
    circle: [['cx', 'Center X %', 'number'], ['cy', 'Center Y %', 'number'], ['r', 'Radius %', 'number'], ['fill', 'Fill', 'color']],
    image: [['label', 'Label', 'text'], ['x', 'X %', 'number'], ['y', 'Y %', 'number'], ['w', 'Width %', 'number'], ['h', 'Height %', 'number']],
  };
  const ELEMENT_DEFAULTS = {
    text: () => ({ type: 'text', label: 'Text', text: 'New text', x: 50, y: 50, size: 8, color: '#111827', weight: 'bold', align: 'middle', editable: true }),
    rect: () => ({ type: 'rect', x: 10, y: 10, w: 30, h: 20, rx: 0, fill: '#e11d48' }),
    circle: () => ({ type: 'circle', cx: 50, cy: 50, r: 20, fill: '#0ea5e9' }),
    image: () => ({ type: 'image', label: 'Logo', href: '', x: 40, y: 10, w: 20, h: 20, editable: true }),
  };

  function editTemplate(existing, products, isCopy) {
    const t = existing
      ? JSON.parse(JSON.stringify(existing))
      : { name: '', category: 'General', productIds: [], width: 210, height: 297, background: '#ffffff', tags: [], elements: [ELEMENT_DEFAULTS.text()] };
    t.elements.forEach((e, i) => { if (!e.id) e.id = `${e.type}-${i}`; });
    const isNew = !existing || isCopy;

    const previewBox = h('div', { class: 'design-thumb', style: 'aspect-ratio:auto; min-height:260px' });
    const drawPreview = () => {
      const w = Number(t.width) > 0 ? Number(t.width) : 100;
      const hh = Number(t.height) > 0 ? Number(t.height) : 100;
      previewBox.replaceChildren(Render.renderDesign(t, w, hh));
    };

    const elementsBox = h('div');
    function drawElements() {
      elementsBox.replaceChildren(...t.elements.map((el, i) => {
        const fields = ELEMENT_FIELDS[el.type] || [];
        return h('div', { class: 'layer' },
          h('div', { class: 'layer-head' },
            h('strong', null, `${i + 1}. ${el.type}${el.label ? ` — ${el.label}` : ''}`),
            h('div', { class: 'toolbar' },
              h('button', { class: 'btn ghost small', type: 'button', title: 'Move up (behind)', disabled: i === 0, onclick: () => { [t.elements[i - 1], t.elements[i]] = [t.elements[i], t.elements[i - 1]]; drawElements(); drawPreview(); } }, '↑'),
              h('button', { class: 'btn ghost small', type: 'button', title: 'Remove', onclick: () => { t.elements.splice(i, 1); drawElements(); drawPreview(); } }, '✕'))),
          h('div', { class: 'row' }, fields.map(([key, label, type]) => {
            let input;
            const set = (v) => { el[key] = v; drawPreview(); };
            if (Array.isArray(type)) {
              input = h('select', { onchange: (e) => set(e.target.value) }, type.map((o) => h('option', { value: o, selected: el[key] === o }, o)));
            } else if (type === 'checkbox') {
              input = h('input', { type: 'checkbox', checked: el[key] !== false, onchange: (e) => set(e.target.checked) });
            } else if (type === 'textarea') {
              input = h('textarea', { rows: 2, oninput: (e) => set(e.target.value) }, el[key] || '');
            } else if (type === 'color') {
              input = h('input', { type: 'color', value: el[key] || '#000000', oninput: (e) => set(e.target.value) });
            } else {
              input = h('input', { type, step: type === 'number' ? '0.1' : undefined, value: el[key] === undefined ? '' : el[key], oninput: (e) => set(type === 'number' ? Number(e.target.value) : e.target.value) });
            }
            return h('div', { style: type === 'textarea' ? 'flex:1 1 100%' : 'flex:1 1 90px' }, h('label', { class: 'small' }, label), input);
          })));
      }));
    }

    const error = h('p', { class: 'error-text' });
    const save = async () => {
      error.textContent = '';
      try {
        if (isNew) await adminApi('/templates', { method: 'POST', body: t });
        else await adminApi(`/templates/${encodeURIComponent(existing.id)}`, { method: 'PUT', body: t });
        toast('Template saved', 'success');
        renderTemplates();
      } catch (err) {
        error.textContent = err.message;
        toast(err.message, 'error');
      }
    };

    const tagsField = { tags: (t.tags || []).join(', ') };

    view.replaceChildren(
      h('div', { class: 'section-head' },
        h('div', null,
          h('p', { class: 'small' }, h('a', { href: '#templates', onclick: (e) => { e.preventDefault(); renderTemplates(); } }, '← All templates')),
          h('h1', null, isNew ? 'New template' : `Edit ${existing.name}`)),
        h('div', { class: 'toolbar' },
          !isNew ? h('button', { class: 'btn danger', onclick: async () => {
            if (!confirm(`Delete template ${existing.name}?`)) return;
            try { await adminApi(`/templates/${encodeURIComponent(existing.id)}`, { method: 'DELETE' }); toast('Template deleted', 'success'); renderTemplates(); } catch (err) { toast(err.message, 'error'); }
          } }, 'Delete') : null,
          h('button', { class: 'btn', onclick: save }, 'Save template'))),
      error,
      h('div', { class: 'split' },
        h('div', null,
          h('div', { class: 'card editor-section' },
            h('div', { class: 'row' }, inputField(t, 'name', 'Name'), inputField(t, 'category', 'Category')),
            h('div', { class: 'row' },
              inputField(t, 'width', 'Design width (mm)', { type: 'number', onChange: drawPreview, help: 'Sets the shape it is designed for; used to suggest it for matching sizes.' }),
              inputField(t, 'height', 'Design height (mm)', { type: 'number', onChange: drawPreview }),
              h('div', { class: 'field', style: 'flex:0 0 110px' }, h('label', null, 'Background'),
                h('input', { type: 'color', value: t.background, oninput: (e) => { t.background = e.target.value; drawPreview(); } }))),
            inputField(tagsField, 'tags', 'Tags (comma separated)', { onChange: () => { t.tags = tagsField.tags; } }),
            h('label', null, 'Available for products'),
            h('div', { class: 'chips' }, products.map((p) =>
              h('label', { class: 'chip' },
                h('input', { type: 'checkbox', checked: t.productIds.includes(p.id), onchange: (e) => {
                  t.productIds = e.target.checked ? [...t.productIds, p.id] : t.productIds.filter((x) => x !== p.id);
                } }),
                h('span', null, p.name))))),
          h('div', { class: 'card editor-section' },
            h('h3', null, 'Elements', h('span', { class: 'toolbar' },
              ...Object.keys(ELEMENT_DEFAULTS).map((type) =>
                h('button', { class: 'btn secondary small', type: 'button', onclick: () => {
                  t.elements.push({ id: `${type}-${Date.now().toString(36)}`, ...ELEMENT_DEFAULTS[type]() });
                  drawElements(); drawPreview();
                } }, `+ ${type}`)))),
            h('p', { class: 'help' }, 'Elements are drawn in order — later ones appear on top.'),
            elementsBox)),
        h('div', { class: 'sticky' }, h('div', { class: 'card' }, h('h3', null, 'Preview'), previewBox)))
    );
    drawElements();
    drawPreview();
    window.scrollTo(0, 0);
  }

  // ---------- Settings ----------
  async function renderSettings() {
    const s = JSON.parse(JSON.stringify(await adminApi('/settings')));
    const error = h('p', { class: 'error-text' });
    view.replaceChildren(
      h('div', { class: 'section-head' },
        h('h1', null, 'Settings'),
        h('button', { class: 'btn', onclick: async () => {
          error.textContent = '';
          try {
            settings = await adminApi('/settings', { method: 'PUT', body: s });
            toast('Settings saved', 'success');
            App.initShell();
          } catch (err) {
            error.textContent = err.message;
          }
        } }, 'Save settings')),
      error,
      h('div', { class: 'card editor-section' },
        h('h3', null, 'Company'),
        h('div', { class: 'row' }, inputField(s, 'companyName', 'Company name'), inputField(s, 'tagline', 'Tagline')),
        h('div', { class: 'row' }, inputField(s, 'contactEmail', 'Contact email'), inputField(s, 'contactPhone', 'Contact phone'))),
      h('div', { class: 'card editor-section' },
        h('h3', null, 'Money'),
        h('div', { class: 'row' },
          inputField(s, 'currency', 'Currency (ISO code)', { help: 'e.g. USD, EUR, GBP, AMD' }),
          inputField(s, 'taxRate', 'Tax / VAT %', { type: 'number', step: '0.1' }))),
      h('div', { class: 'card editor-section' },
        h('h3', null, 'Turnaround options'),
        h('p', { class: 'help' }, 'The multiplier is applied to the discounted print cost, e.g. 1.3 = 30% rush fee. The first option is the default.'),
        tableEditor(s.turnarounds, [
          { key: 'name', label: 'Name' },
          { key: 'days', label: 'Working days', type: 'number', step: '1', width: '120px' },
          { key: 'multiplier', label: 'Multiplier', type: 'number', step: '0.05', width: '120px' },
        ], { newRow: () => ({ id: '', name: '', days: 3, multiplier: 1 }), onChange: () => {}, addLabel: '+ Add turnaround' })),
      App.isStatic ? publishCard() : null
    );
  }

  // ---------- Publishing (static GitHub Pages build only) ----------
  function download(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = h('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function publishCard() {
    const fileInput = h('input', {
      type: 'file', accept: 'application/json,.json', class: 'hidden',
      onchange: async () => {
        const file = fileInput.files[0];
        fileInput.value = '';
        if (!file) return;
        try {
          await StaticApi.importCatalog(JSON.parse(await file.text()));
          settings = await adminApi('/settings');
          toast('Catalog imported', 'success');
          renderStaticBanner();
          renderSettings();
        } catch (err) {
          toast(err.message, 'error');
        }
      },
    });
    return h('div', { class: 'card editor-section' },
      h('h3', null, 'Publish changes to the website'),
      h('p', null, 'This site runs on GitHub Pages, so your changes to prices, products, templates and settings are saved in this browser only. To publish them for every visitor:'),
      h('ol', null,
        h('li', null, 'Click ', h('strong', null, 'Export catalog.json'), '.'),
        h('li', null, 'In the GitHub repository, replace ', h('code', null, 'public/data/catalog.json'), ' with the downloaded file and commit it.'),
        h('li', null, 'GitHub Pages redeploys automatically within a minute or two.')),
      h('div', { class: 'toolbar' },
        h('button', { class: 'btn', type: 'button', onclick: async () => {
          download('catalog.json', `${JSON.stringify(await StaticApi.exportCatalog(), null, 2)}\n`, 'application/json');
        } }, 'Export catalog.json'),
        h('button', { class: 'btn secondary', type: 'button', onclick: () => fileInput.click() }, 'Import catalog.json'),
        h('button', { class: 'btn ghost', type: 'button', onclick: async () => {
          if (!confirm('Discard your unpublished changes and reload the published catalog?')) return;
          await StaticApi.resetCatalog();
          settings = await adminApi('/settings');
          toast('Reverted to the published catalog', 'success');
          renderStaticBanner();
          renderSettings();
        } }, 'Discard local changes')),
      fileInput,
      h('p', { class: 'help', style: 'margin-top:12px' }, 'Orders placed on the static site are sent to you by email from the customer. The Orders page only lists orders placed in this browser.'));
  }

  async function renderStaticBanner() {
    const box = document.getElementById('static-banner');
    if (!App.isStatic) return;
    const edited = await StaticApi.hasLocalEdits();
    box.replaceChildren(h('div', { class: 'card', style: 'margin-bottom:20px; background:#fffbeb; border-color:#fcd34d' },
      h('strong', null, 'GitHub Pages mode. '),
      edited
        ? h('span', null, 'You have unpublished changes saved in this browser. ',
          h('a', { href: '#settings', onclick: (e) => { e.preventDefault(); go('settings'); } }, 'Export them to publish'), '.')
        : h('span', null, 'Changes are saved in this browser until you export and publish them from Settings.')));
  }

  if (App.isStatic) {
    const hint = document.getElementById('login-hint');
    hint.textContent = `Demo admin on GitHub Pages. Password: ${StaticApi.DEMO_PASSWORD}. Changes stay in this browser until you publish them.`;
    hint.classList.remove('hidden');
  }

  if (token) start();
  else showLogin();
})();
