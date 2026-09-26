/*
 * In-browser implementation of the /api routes, used by the static GitHub
 * Pages build where there is no Node server. Catalog data comes from
 * data/catalog.json; admin edits and orders are kept in this browser's
 * localStorage. Admin edits can be exported as a new catalog.json and
 * committed to publish them for every visitor.
 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'colorprint-static-db';
  const DEMO_PASSWORD = 'demo';
  const ORDER_STATUSES = ['new', 'in_production', 'ready', 'shipped', 'completed', 'cancelled'];
  const { ValidationError, normalizeProduct, normalizeTemplate, normalizeSettings, normalizeCustomer, normalizeElements } = root.Validate;

  let dbPromise = null;
  let memoryDb = null; // used when localStorage is unavailable

  function readLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return memoryDb;
    }
  }

  function save(db) {
    memoryDb = db;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch (e) {
      console.warn('Could not save to localStorage', e);
    }
  }

  async function fetchCatalog() {
    const res = await fetch('data/catalog.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('Could not load the product catalog');
    return res.json();
  }

  function load() {
    if (!dbPromise) {
      dbPromise = (async () => {
        const catalog = await fetchCatalog();
        const local = readLocal();
        let db;
        if (local && local.baseVersion === catalog.version && local.catalogEdited) {
          db = local;
        } else {
          // A newer catalog was published (or nothing was edited): use it, keep this browser's orders.
          db = {
            baseVersion: catalog.version,
            catalogEdited: false,
            settings: catalog.settings,
            products: catalog.products,
            templates: catalog.templates,
            orders: (local && local.orders) || [],
            session: local && local.session,
          };
          save(db);
        }
        return db;
      })();
    }
    return dbPromise;
  }

  const ok = (data, status) => ({ status: status || 200, data });
  const fail = (status, error) => ({ status, data: { error } });
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const find = (list, id) => list.find((x) => x.id === id);

  function quoteFor(db, product, body) {
    return root.Pricing.calculate(product, {
      widthMm: body.widthMm, heightMm: body.heightMm, quantity: body.quantity,
      colorId: body.colorId, materialId: body.materialId, sideId: body.sideId,
      finishIds: body.finishIds, turnaroundId: body.turnaroundId,
    }, db.settings);
  }

  function editCatalog(db) {
    db.catalogEdited = true;
    save(db);
  }

  async function route(method, url, body, headers) {
    const db = await load();
    const path = url.pathname.replace(/^.*?\/api\//, '/');
    const q = url.searchParams;
    const seg = path.split('/').filter(Boolean).map(decodeURIComponent);

    // ----- Public -----
    if (method === 'GET' && path === '/settings') return ok(db.settings);
    if (method === 'GET' && path === '/products') return ok(db.products.filter((p) => p.active));
    if (method === 'GET' && seg[0] === 'products' && seg.length === 2) {
      const p = find(db.products, seg[1]);
      return p && p.active ? ok(p) : fail(404, 'Product not found');
    }
    if (method === 'POST' && path === '/quote') {
      const p = find(db.products, body.productId);
      if (!p || !p.active) return fail(404, 'Product not found');
      const r = quoteFor(db, p, body);
      return ok(r, r.ok ? 200 : 400);
    }
    if (method === 'GET' && path === '/templates') {
      let list = db.templates;
      if (q.get('productId')) list = list.filter((t) => t.productIds.includes(q.get('productId')));
      if (q.get('category')) list = list.filter((t) => t.category === q.get('category'));
      return ok(list);
    }
    if (method === 'GET' && path === '/templates/suggest') {
      const limit = Math.min(Math.max(Number(q.get('limit')) || 6, 1), 50);
      return ok(root.Suggest.suggestTemplates(db.templates, {
        productId: q.get('productId'), width: Number(q.get('width')), height: Number(q.get('height')),
      }).slice(0, limit));
    }
    if (method === 'GET' && seg[0] === 'templates' && seg.length === 2) {
      const t = find(db.templates, seg[1]);
      return t ? ok(t) : fail(404, 'Template not found');
    }
    if (method === 'POST' && path === '/orders') {
      const p = find(db.products, body.productId);
      if (!p || !p.active) return fail(404, 'Product not found');
      const quote = quoteFor(db, p, body);
      if (!quote.ok) return fail(400, quote.errors.join('. '));
      const customer = normalizeCustomer(body.customer);
      let design = null;
      if (body.design) {
        const tpl = body.design.templateId ? find(db.templates, body.design.templateId) : null;
        design = {
          templateId: tpl ? tpl.id : null,
          templateName: tpl ? tpl.name : null,
          background: /^#[0-9a-fA-F]{3,8}$/.test(body.design.background || '') ? body.design.background : '#ffffff',
          elements: normalizeElements(body.design.elements),
        };
      }
      const order = {
        id: `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(16).slice(2, 6).toUpperCase()}`,
        createdAt: new Date().toISOString(),
        status: 'new',
        productId: p.id,
        productName: p.name,
        displayUnit: ['mm', 'cm', 'in'].includes(body.displayUnit) ? body.displayUnit : 'mm',
        quote: quote.breakdown,
        currency: db.settings.currency,
        customer,
        design,
      };
      db.orders.push(order);
      save(db);
      return ok({ id: order.id, total: order.quote.total, currency: order.currency, status: order.status }, 201);
    }
    if (method === 'GET' && seg[0] === 'orders' && seg.length === 2) {
      const o = find(db.orders, seg[1]);
      const email = String(q.get('email') || '').trim().toLowerCase();
      if (!o || !email || o.customer.email.toLowerCase() !== email) return fail(404, 'Order not found');
      return ok({ id: o.id, createdAt: o.createdAt, status: o.status, productName: o.productName, quote: o.quote, currency: o.currency });
    }

    // ----- Admin -----
    if (seg[0] !== 'admin') return fail(404, 'Not found');
    if (method === 'POST' && path === '/admin/login') {
      if (String((body && body.password) || '') !== DEMO_PASSWORD) return fail(401, 'Wrong password');
      db.session = Math.random().toString(36).slice(2) + Date.now().toString(36);
      save(db);
      return ok({ token: db.session });
    }
    const token = String(headers.Authorization || '').replace(/^Bearer /, '');
    if (!db.session || token !== db.session) return fail(401, 'Please log in');

    const a = seg.slice(1);
    if (method === 'POST' && a[0] === 'logout') {
      db.session = null;
      save(db);
      return ok({ ok: true });
    }
    if (method === 'GET' && a[0] === 'stats') {
      const byStatus = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0]));
      let revenue = 0;
      for (const o of db.orders) {
        byStatus[o.status] = (byStatus[o.status] || 0) + 1;
        if (o.status !== 'cancelled') revenue += o.quote.total;
      }
      return ok({ orders: db.orders.length, revenue: root.Pricing.round2(revenue), byStatus, products: db.products.length, templates: db.templates.length });
    }
    if (a[0] === 'settings') {
      if (method === 'GET') return ok(db.settings);
      if (method === 'PUT') {
        db.settings = normalizeSettings(body || {});
        editCatalog(db);
        return ok(db.settings);
      }
    }
    if (a[0] === 'products') {
      if (method === 'GET' && a.length === 1) return ok(db.products);
      if (method === 'POST' && a.length === 1) {
        const p = normalizeProduct(body || {});
        if (find(db.products, p.id)) return fail(409, `A product with id "${p.id}" already exists`);
        db.products.push(p);
        editCatalog(db);
        return ok(p, 201);
      }
      const idx = db.products.findIndex((p) => p.id === a[1]);
      if (idx === -1) return fail(404, 'Product not found');
      if (method === 'PUT') {
        db.products[idx] = normalizeProduct(body || {}, a[1]);
        editCatalog(db);
        return ok(db.products[idx]);
      }
      if (method === 'DELETE') {
        db.products.splice(idx, 1);
        for (const t of db.templates) t.productIds = t.productIds.filter((x) => x !== a[1]);
        editCatalog(db);
        return ok({ ok: true });
      }
    }
    if (a[0] === 'templates') {
      const productIds = db.products.map((p) => p.id);
      if (method === 'GET' && a.length === 1) return ok(db.templates);
      if (method === 'POST' && a.length === 1) {
        const t = normalizeTemplate(body || {}, null, productIds);
        if (find(db.templates, t.id)) return fail(409, `A template with id "${t.id}" already exists`);
        db.templates.push(t);
        editCatalog(db);
        return ok(t, 201);
      }
      const idx = db.templates.findIndex((t) => t.id === a[1]);
      if (idx === -1) return fail(404, 'Template not found');
      if (method === 'PUT') {
        db.templates[idx] = normalizeTemplate(body || {}, a[1], productIds);
        editCatalog(db);
        return ok(db.templates[idx]);
      }
      if (method === 'DELETE') {
        db.templates.splice(idx, 1);
        editCatalog(db);
        return ok({ ok: true });
      }
    }
    if (a[0] === 'orders') {
      if (method === 'GET' && a.length === 1) return ok([...db.orders].sort((x, y) => y.createdAt.localeCompare(x.createdAt)));
      const o = find(db.orders, a[1]);
      if (!o) return fail(404, 'Order not found');
      if (method === 'PATCH') {
        if (!ORDER_STATUSES.includes(body && body.status)) return fail(400, 'Invalid status');
        o.status = body.status;
        o.updatedAt = new Date().toISOString();
        save(db);
        return ok(o);
      }
      if (method === 'DELETE') {
        db.orders = db.orders.filter((x) => x.id !== a[1]);
        save(db);
        return ok({ ok: true });
      }
    }
    return fail(404, 'Not found');
  }

  async function request(path, options) {
    options = options || {};
    const url = new URL(path, location.href);
    let body = options.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { return fail(400, 'Invalid JSON'); }
    }
    try {
      const res = await route((options.method || 'GET').toUpperCase(), url, clone(body || {}), options.headers || {});
      return { status: res.status, data: clone(res.data) };
    } catch (err) {
      if (err instanceof ValidationError) return fail(400, err.message);
      throw err;
    }
  }

  // ----- Publishing helpers for the admin panel -----
  async function exportCatalog() {
    const db = await load();
    return {
      version: new Date().toISOString(),
      settings: db.settings,
      products: db.products,
      templates: db.templates,
    };
  }

  async function importCatalog(catalog) {
    if (!catalog || !Array.isArray(catalog.products) || !Array.isArray(catalog.templates) || !catalog.settings) {
      throw new Error('That file is not a ColorPrint catalog.json');
    }
    const db = await load();
    // Validate everything before touching the stored data.
    const settings = normalizeSettings(catalog.settings);
    const products = catalog.products.map((p) => normalizeProduct(p, p.id));
    const ids = products.map((p) => p.id);
    const templates = catalog.templates.map((t) => normalizeTemplate(t, t.id, ids));
    Object.assign(db, { settings, products, templates });
    editCatalog(db);
  }

  async function resetCatalog() {
    const db = await load();
    const catalog = await fetchCatalog();
    Object.assign(db, { baseVersion: catalog.version, catalogEdited: false, settings: catalog.settings, products: catalog.products, templates: catalog.templates });
    save(db);
  }

  async function hasLocalEdits() {
    return (await load()).catalogEdited;
  }

  root.StaticApi = { request, exportCatalog, importCatalog, resetCatalog, hasLocalEdits, DEMO_PASSWORD };
})(window);
