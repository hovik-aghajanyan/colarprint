(async function () {
  'use strict';
  const { api, h, qs, initShell, toast } = App;

  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
  const settings = await initShell();
  const params = new URLSearchParams(location.search);

  // ---------- Load template + product ----------
  const templateId = qs('template');
  let template;
  if (!templateId || templateId === 'blank') {
    template = Options.blankTemplate();
  } else {
    try {
      template = await api(`/api/templates/${encodeURIComponent(templateId)}`);
    } catch (e) {
      toast('Template not found — starting with a blank design.', 'error');
      template = Options.blankTemplate();
    }
  }

  let product = null;
  const productId = qs('product') || (template.productIds && template.productIds[0]);
  try {
    product = await api(`/api/products/${encodeURIComponent(productId || '')}`);
  } catch (e) {
    document.getElementById('design-title').textContent = 'Product not found';
    return;
  }

  const state = Options.stateFromQuery(product, settings, params);
  // No size in the URL: pick the preset whose shape best matches the template.
  if (!params.get('w') && template.width && product.sizePresets.length) {
    const ratio = template.width / template.height;
    const best = [...product.sizePresets].sort(
      (a, b) => Math.abs(Math.log(a.width / a.height / ratio)) - Math.abs(Math.log(b.width / b.height / ratio))
    )[0];
    state.presetId = best.id;
    state.widthMm = best.width;
    state.heightMm = best.height;
  }

  document.title = `Design ${product.name} — ${settings.companyName}`;
  document.getElementById('design-title').textContent = `${product.name}: ${template.name}`;

  const fresh = () => ({
    templateId: template.id || null,
    background: template.background || '#ffffff',
    elements: JSON.parse(JSON.stringify(template.elements || [])),
  });
  let design = fresh();
  let selectedId = null;

  const canvas = document.getElementById('canvas');
  const layers = document.getElementById('layers');
  const priceBox = document.getElementById('price');
  const bgColor = document.getElementById('bg-color');
  const fileInput = document.getElementById('file-input');
  const fitHint = document.getElementById('fit-hint');
  let currentSvg = null;
  let pendingImageTarget = null;

  const selected = () => design.elements.find((e) => e.id === selectedId);
  const newId = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 7)}`;

  // ---------- Rendering ----------
  function renderCanvas() {
    const w = state.widthMm > 0 ? state.widthMm : 100;
    const hh = state.heightMm > 0 ? state.heightMm : 100;
    currentSvg = Render.renderDesign(design, w, hh, { selectedId });
    canvas.replaceChildren(currentSvg);
    bgColor.value = /^#[0-9a-f]{6}$/i.test(design.background) ? design.background : '#ffffff';
  }

  function colorInput(value, onInput) {
    return h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#000000', oninput: (e) => onInput(e.target.value) });
  }

  function range(label, value, min, max, step, onInput) {
    return h('label', { class: 'small', style: 'display:flex; align-items:center; gap:6px; font-weight:500; margin:0; flex:1 1 100%' },
      h('span', { style: 'width:56px' }, label),
      h('input', { type: 'range', min, max, step, value, oninput: (e) => onInput(Number(e.target.value)) }));
  }

  function renderLayers() {
    layers.replaceChildren();
    if (!design.elements.length) layers.appendChild(h('p', { class: 'muted small' }, 'No elements. Add text or an image.'));
    // Top-most first, like a design tool.
    [...design.elements].reverse().forEach((el) => {
      const isSel = el.id === selectedId;
      const head = h('div', { class: 'layer-head' },
        h('strong', null, el.label || { rect: 'Shape', circle: 'Circle', text: 'Text', image: 'Image' }[el.type]),
        h('div', { class: 'toolbar' },
          h('button', { class: 'btn ghost small', type: 'button', title: 'Bring forward', onclick: (e) => { e.stopPropagation(); move(el.id, 1); } }, '↑'),
          h('button', { class: 'btn ghost small', type: 'button', title: 'Send backward', onclick: (e) => { e.stopPropagation(); move(el.id, -1); } }, '↓'),
          h('button', { class: 'btn ghost small', type: 'button', title: 'Delete', onclick: (e) => { e.stopPropagation(); removeEl(el.id); } }, '✕')
        ));
      const box = h('div', {
        class: `layer ${isSel ? 'selected' : ''}`,
        dataset: { layer: el.id },
        onclick: (e) => {
          if (selectedId === el.id) return;
          const typing = e.target.tagName === 'TEXTAREA';
          select(el.id);
          // Selecting re-renders the list; keep the caret in the field the user clicked.
          if (typing) {
            const ta = layers.querySelector(`[data-layer="${CSS.escape(el.id)}"] textarea`);
            if (ta) ta.focus();
          }
        },
      }, head);

      if (el.type === 'text') {
        box.appendChild(h('textarea', {
          rows: Math.min(4, String(el.text).split('\n').length + 1),
          disabled: el.editable === false,
          oninput: (e) => { el.text = e.target.value; renderCanvas(); },
        }, el.text));
        if (isSel) {
          box.appendChild(h('div', { class: 'layer-controls' },
            colorInput(el.color, (v) => { el.color = v; renderCanvas(); }),
            h('button', { type: 'button', class: `btn small ${el.weight === 'bold' ? '' : 'secondary'}`, onclick: () => { el.weight = el.weight === 'bold' ? 'normal' : 'bold'; refresh(); } }, 'B'),
            ...['start', 'middle', 'end'].map((a) => h('button', {
              type: 'button', class: `btn small ${el.align === a ? '' : 'secondary'}`,
              onclick: () => { el.align = a; refresh(); },
            }, { start: '⯇', middle: '≡', end: '⯈' }[a])),
            range('Size', el.size, 0.5, 40, 0.1, (v) => { el.size = v; renderCanvas(); }),
            range('X', el.x, 0, 100, 0.5, (v) => { el.x = v; renderCanvas(); }),
            range('Y', el.y, 0, 100, 0.5, (v) => { el.y = v; renderCanvas(); })
          ));
        }
      } else if (el.type === 'image') {
        box.appendChild(h('div', { class: 'layer-controls' },
          h('button', { type: 'button', class: 'btn small', onclick: () => { pendingImageTarget = el.id; fileInput.click(); } }, el.href ? 'Replace image' : 'Upload image')));
        if (isSel) {
          box.appendChild(h('div', { class: 'layer-controls' },
            range('Width', el.w, 1, 100, 0.5, (v) => { el.w = v; renderCanvas(); }),
            range('Height', el.h, 1, 100, 0.5, (v) => { el.h = v; renderCanvas(); }),
            range('X', el.x, -50, 100, 0.5, (v) => { el.x = v; renderCanvas(); }),
            range('Y', el.y, -50, 100, 0.5, (v) => { el.y = v; renderCanvas(); })
          ));
        }
      } else {
        box.appendChild(h('div', { class: 'layer-controls' },
          h('span', { class: 'small muted' }, 'Color'),
          colorInput(el.fill, (v) => { el.fill = v; renderCanvas(); })));
      }
      layers.appendChild(box);
    });
  }

  function refresh() {
    renderCanvas();
    renderLayers();
  }

  function select(id) {
    selectedId = id;
    refresh();
  }

  function move(id, dir) {
    const i = design.elements.findIndex((e) => e.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= design.elements.length) return;
    [design.elements[i], design.elements[j]] = [design.elements[j], design.elements[i]];
    refresh();
  }

  function removeEl(id) {
    design.elements = design.elements.filter((e) => e.id !== id);
    if (selectedId === id) selectedId = null;
    refresh();
  }

  // ---------- Drag to move ----------
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    const target = e.target.closest('[data-id]');
    if (!target) {
      if (selectedId) select(null);
      return;
    }
    const el = design.elements.find((x) => x.id === target.dataset.id);
    if (!el) return;
    e.preventDefault();
    if (selectedId !== el.id) select(el.id);
    const rect = currentSvg.getBoundingClientRect();
    const isCircle = el.type === 'circle';
    drag = { el, rect, startX: e.clientX, startY: e.clientY, ox: isCircle ? el.cx : el.x, oy: isCircle ? el.cy : el.y, isCircle, moved: false };
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = ((e.clientX - drag.startX) / drag.rect.width) * 100;
    const dy = ((e.clientY - drag.startY) / drag.rect.height) * 100;
    const nx = Math.round((drag.ox + dx) * 10) / 10;
    const ny = Math.round((drag.oy + dy) * 10) / 10;
    if (drag.isCircle) { drag.el.cx = nx; drag.el.cy = ny; } else { drag.el.x = nx; drag.el.y = ny; }
    drag.moved = true;
    renderCanvas();
  });
  window.addEventListener('pointerup', () => {
    if (drag && drag.moved) renderLayers();
    drag = null;
  });

  document.addEventListener('keydown', (e) => {
    const el = selected();
    // Only react when nothing else has focus, so typing in forms is never hijacked.
    if (!el || (document.activeElement && document.activeElement !== document.body)) return;
    const step = e.shiftKey ? 5 : 0.5;
    const key = el.type === 'circle' ? ['cx', 'cy'] : ['x', 'y'];
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      el[key[0]] += moves[e.key][0];
      el[key[1]] += moves[e.key][1];
      renderCanvas();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeEl(el.id);
    }
  });

  // ---------- Toolbar ----------
  document.getElementById('add-text').addEventListener('click', () => {
    const el = { id: newId('text'), type: 'text', label: 'Text', text: 'Your text', x: 50, y: 50, size: 8, color: '#111827', weight: 'bold', align: 'middle', editable: true };
    design.elements.push(el);
    select(el.id);
  });
  document.getElementById('add-image').addEventListener('click', () => {
    const el = { id: newId('image'), type: 'image', label: 'Image', href: '', x: 35, y: 30, w: 30, h: 40, editable: true };
    design.elements.push(el);
    pendingImageTarget = el.id;
    select(el.id);
    fileInput.click();
  });
  bgColor.addEventListener('input', (e) => { design.background = e.target.value; renderCanvas(); });
  document.getElementById('reset').addEventListener('click', () => {
    if (!confirm('Discard your changes and start again from the template?')) return;
    design = fresh();
    selectedId = null;
    refresh();
  });
  document.getElementById('download').addEventListener('click', async () => {
    try {
      const url = await Render.svgToPng(currentSvg, 1600);
      const a = h('a', { href: url, download: `${product.id}-design.png` });
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      toast('Could not create the preview image.', 'error');
    }
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      toast('That image is larger than 5 MB. Please use a smaller file.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const el = design.elements.find((x) => x.id === pendingImageTarget);
      if (el) {
        el.href = reader.result;
        el.label = file.name.slice(0, 60);
      }
      refresh();
    };
    reader.readAsDataURL(file);
  });

  // ---------- Options + price ----------
  function updateFit() {
    if (!template.width) {
      fitHint.textContent = 'Upload your print-ready artwork. It will be scaled to fit the print size.';
      return;
    }
    const d = Math.abs(Math.log(state.widthMm / state.heightMm / (template.width / template.height)));
    fitHint.textContent = d > 0.35
      ? 'Heads up: this template was designed for a different shape. Adjust the layout or try a template that fits your size.'
      : 'The template has been adapted to your print size. Edit anything you like.';
  }

  function updatePrice() {
    const result = Pricing.calculate(product, Options.toQuoteInput(state), settings);
    Options.renderPrice(priceBox, product, settings, state, result);
    document.getElementById('order-btn').disabled = !result.ok;
    return result;
  }

  function onOptionsChange() {
    updatePrice();
    if (state.widthMm > 0 && state.heightMm > 0) {
      renderCanvas();
      updateFit();
    }
    const query = Options.stateToQuery(product.id, state, { template: template.id || 'blank' });
    history.replaceState(null, '', `?${query}`);
    document.getElementById('back-link').href = `/product?id=${encodeURIComponent(product.id)}&${Options.stateToQuery(product.id, state).replace(/^product=[^&]*&/, '')}`;
  }

  Options.createForm(document.getElementById('options'), product, settings, state, onOptionsChange, { compact: true });
  refresh();
  onOptionsChange();

  // ---------- Checkout ----------
  const modal = document.getElementById('order-modal');
  const content = document.getElementById('order-content');
  const close = () => modal.classList.add('hidden');
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  document.getElementById('order-btn').addEventListener('click', () => {
    const result = updatePrice();
    if (!result.ok) return;
    const missingImage = design.elements.some((e) => e.type === 'image' && !e.href);
    const field = (id, label, type, required, extra) =>
      h('div', { class: 'field' }, h('label', { for: id }, label + (required ? ' *' : '')),
        type === 'textarea' ? h('textarea', { id, name: id, ...extra }) : h('input', { id, name: id, type, required, ...extra }));
    const error = h('p', { class: 'error-text' });
    const submit = h('button', { class: 'btn block lg', type: 'submit' }, `Order for ${Pricing.formatMoney(result.breakdown.total, settings)}`);
    const form = h('form', { novalidate: false },
      h('h2', { id: 'order-title' }, 'Complete your order'),
      h('p', { class: 'muted' }, `${result.breakdown.quantity} × ${product.name}, ${App.fmtNum(Pricing.fromMm(state.widthMm, state.unit))} × ${App.fmtNum(Pricing.fromMm(state.heightMm, state.unit))} ${state.unit}`),
      missingImage ? h('p', { class: 'error-text' }, 'Note: one of your image placeholders is empty. You can still order and email us the file.') : null,
      field('name', 'Full name', 'text', true, { autocomplete: 'name' }),
      h('div', { class: 'row' },
        field('email', 'Email', 'email', true, { autocomplete: 'email' }),
        field('phone', 'Phone', 'tel', false, { autocomplete: 'tel' })),
      field('address', 'Delivery address (leave empty for pickup)', 'textarea', false, { rows: 2 }),
      field('notes', 'Notes for the printer', 'textarea', false, { rows: 2 }),
      error,
      h('div', { class: 'row' }, h('button', { class: 'btn secondary', type: 'button', onclick: close }, 'Cancel'), submit)
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.textContent = '';
      submit.disabled = true;
      const fd = new FormData(form);
      try {
        const order = await api('/api/orders', {
          method: 'POST',
          body: {
            productId: product.id,
            ...Options.toQuoteInput(state),
            displayUnit: state.unit,
            design,
            customer: Object.fromEntries(fd.entries()),
          },
        });
        content.replaceChildren(
          h('h2', null, '🎉 Order placed!'),
          h('p', null, 'Your order number is ', h('strong', null, order.id), '.'),
          h('p', { class: 'muted' }, `Total: ${Pricing.formatMoney(order.total, settings)}. We will email you when your print is ready.`),
          h('div', { class: 'row' },
            h('a', { class: 'btn', href: `/track?id=${encodeURIComponent(order.id)}` }, 'Track order'),
            h('a', { class: 'btn secondary', href: '/' }, 'Back to shop'))
        );
      } catch (err) {
        error.textContent = err.message;
        submit.disabled = false;
      }
    });
    content.replaceChildren(form);
    modal.classList.remove('hidden');
    form.querySelector('input').focus();
  });
})().catch((err) => {
  console.error(err);
  App.toast('Something went wrong loading the designer.', 'error');
});
