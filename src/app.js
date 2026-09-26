const path = require('path');
const crypto = require('crypto');
const express = require('express');
const Pricing = require('../public/js/pricing');
const {
  ValidationError,
  normalizeProduct,
  normalizeTemplate,
  normalizeSettings,
  normalizeCustomer,
  normalizeElements,
} = require('./validate');

const ORDER_STATUSES = ['new', 'in_production', 'ready', 'shipped', 'completed', 'cancelled'];
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function createApp(store, { adminPassword }) {
  const app = express();
  const sessions = new Map(); // token -> expiry timestamp

  app.disable('x-powered-by');
  app.use(express.json({ limit: '12mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

  // Wraps handlers so thrown ValidationErrors become 400 responses.
  const handle = (fn) => (req, res, next) => {
    try {
      fn(req, res, next);
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      next(err);
    }
  };

  const quoteFor = (product, body) =>
    Pricing.calculate(
      product,
      {
        widthMm: body.widthMm,
        heightMm: body.heightMm,
        quantity: body.quantity,
        colorId: body.colorId,
        materialId: body.materialId,
        sideId: body.sideId,
        finishIds: body.finishIds,
        turnaroundId: body.turnaroundId,
      },
      store.settings
    );

  // ---------- Public API ----------

  app.get('/api/settings', (req, res) => res.json(store.settings));

  app.get('/api/products', (req, res) => {
    res.json(store.list('products').filter((p) => p.active));
  });

  app.get('/api/products/:id', (req, res) => {
    const product = store.get('products', req.params.id);
    if (!product || !product.active) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  });

  app.post('/api/quote', (req, res) => {
    const product = store.get('products', req.body.productId);
    if (!product || !product.active) return res.status(404).json({ error: 'Product not found' });
    const result = quoteFor(product, req.body);
    res.status(result.ok ? 200 : 400).json(result);
  });

  app.get('/api/templates', (req, res) => {
    let list = store.list('templates');
    if (req.query.productId) list = list.filter((t) => t.productIds.includes(req.query.productId));
    if (req.query.category) list = list.filter((t) => t.category === req.query.category);
    res.json(list);
  });

  // Suggests templates for a product, ranked by how well their proportions
  // match the requested print size (so layouts don't get squashed).
  app.get('/api/templates/suggest', (req, res) => {
    const width = Number(req.query.width);
    const height = Number(req.query.height);
    const limit = Math.min(Math.max(Number(req.query.limit) || 6, 1), 50);
    const productId = req.query.productId;
    res.json(suggestTemplates(store.list('templates'), { productId, width, height }).slice(0, limit));
  });

  app.get('/api/templates/:id', (req, res) => {
    const tpl = store.get('templates', req.params.id);
    if (!tpl) return res.status(404).json({ error: 'Template not found' });
    res.json(tpl);
  });

  app.post(
    '/api/orders',
    handle((req, res) => {
      const body = req.body || {};
      const product = store.get('products', body.productId);
      if (!product || !product.active) return res.status(404).json({ error: 'Product not found' });
      const quote = quoteFor(product, body);
      if (!quote.ok) return res.status(400).json({ error: quote.errors.join('. '), errors: quote.errors });

      const customer = normalizeCustomer(body.customer);
      let design = null;
      if (body.design) {
        const tpl = body.design.templateId ? store.get('templates', body.design.templateId) : null;
        design = {
          templateId: tpl ? tpl.id : null,
          templateName: tpl ? tpl.name : null,
          background: /^#[0-9a-fA-F]{3,8}$/.test(body.design.background || '') ? body.design.background : '#ffffff',
          elements: normalizeElements(body.design.elements),
        };
      }

      const order = {
        id: `ORD-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
        createdAt: new Date().toISOString(),
        status: 'new',
        productId: product.id,
        productName: product.name,
        displayUnit: ['mm', 'cm', 'in'].includes(body.displayUnit) ? body.displayUnit : 'mm',
        quote: quote.breakdown,
        currency: store.settings.currency,
        customer,
        design,
      };
      store.insert('orders', order);
      res.status(201).json({ id: order.id, total: order.quote.total, currency: order.currency, status: order.status });
    })
  );

  // Lets a customer check order status with their order id + email.
  app.get('/api/orders/:id', (req, res) => {
    const order = store.get('orders', req.params.id);
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!order || !email || order.customer.email.toLowerCase() !== email) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json({
      id: order.id,
      createdAt: order.createdAt,
      status: order.status,
      productName: order.productName,
      quote: order.quote,
      currency: order.currency,
    });
  });

  // ---------- Admin API ----------

  app.post('/api/admin/login', (req, res) => {
    const given = Buffer.from(String((req.body && req.body.password) || ''));
    const expected = Buffer.from(adminPassword);
    const ok = given.length === expected.length && crypto.timingSafeEqual(given, expected);
    if (!ok) return res.status(401).json({ error: 'Wrong password' });
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, Date.now() + SESSION_TTL_MS);
    res.json({ token });
  });

  const requireAdmin = (req, res, next) => {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const expiry = sessions.get(token);
    if (!expiry || expiry < Date.now()) {
      sessions.delete(token);
      return res.status(401).json({ error: 'Please log in' });
    }
    req.adminToken = token;
    next();
  };

  const admin = express.Router();
  admin.use(requireAdmin);

  admin.post('/logout', (req, res) => {
    sessions.delete(req.adminToken);
    res.json({ ok: true });
  });

  admin.get('/stats', (req, res) => {
    const orders = store.list('orders');
    const byStatus = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0]));
    let revenue = 0;
    for (const o of orders) {
      byStatus[o.status] = (byStatus[o.status] || 0) + 1;
      if (o.status !== 'cancelled') revenue += o.quote.total;
    }
    res.json({
      orders: orders.length,
      revenue: Pricing.round2(revenue),
      byStatus,
      products: store.list('products').length,
      templates: store.list('templates').length,
    });
  });

  admin.get('/settings', (req, res) => res.json(store.settings));
  admin.put(
    '/settings',
    handle((req, res) => {
      store.settings = normalizeSettings(req.body || {});
      res.json(store.settings);
    })
  );

  admin.get('/products', (req, res) => res.json(store.list('products')));
  admin.post(
    '/products',
    handle((req, res) => {
      const product = normalizeProduct(req.body || {});
      if (store.get('products', product.id)) return res.status(409).json({ error: `A product with id "${product.id}" already exists` });
      res.status(201).json(store.insert('products', product));
    })
  );
  admin.put(
    '/products/:id',
    handle((req, res) => {
      if (!store.get('products', req.params.id)) return res.status(404).json({ error: 'Product not found' });
      res.json(store.replace('products', req.params.id, normalizeProduct(req.body || {}, req.params.id)));
    })
  );
  admin.delete('/products/:id', (req, res) => {
    if (!store.remove('products', req.params.id)) return res.status(404).json({ error: 'Product not found' });
    for (const tpl of store.list('templates')) {
      tpl.productIds = tpl.productIds.filter((p) => p !== req.params.id);
    }
    store.save();
    res.json({ ok: true });
  });

  const productIds = () => store.list('products').map((p) => p.id);

  admin.get('/templates', (req, res) => res.json(store.list('templates')));
  admin.post(
    '/templates',
    handle((req, res) => {
      const tpl = normalizeTemplate(req.body || {}, null, productIds());
      if (store.get('templates', tpl.id)) return res.status(409).json({ error: `A template with id "${tpl.id}" already exists` });
      res.status(201).json(store.insert('templates', tpl));
    })
  );
  admin.put(
    '/templates/:id',
    handle((req, res) => {
      if (!store.get('templates', req.params.id)) return res.status(404).json({ error: 'Template not found' });
      res.json(store.replace('templates', req.params.id, normalizeTemplate(req.body || {}, req.params.id, productIds())));
    })
  );
  admin.delete('/templates/:id', (req, res) => {
    if (!store.remove('templates', req.params.id)) return res.status(404).json({ error: 'Template not found' });
    res.json({ ok: true });
  });

  admin.get('/orders', (req, res) => {
    const orders = [...store.list('orders')].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json(orders);
  });
  admin.patch('/orders/:id', (req, res) => {
    const order = store.get('orders', req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const status = req.body && req.body.status;
    if (!ORDER_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    order.status = status;
    order.updatedAt = new Date().toISOString();
    store.save();
    res.json(order);
  });
  admin.delete('/orders/:id', (req, res) => {
    if (!store.remove('orders', req.params.id)) return res.status(404).json({ error: 'Order not found' });
    res.json({ ok: true });
  });

  app.use('/api/admin', admin);

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Upload too large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  });

  return app;
}

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

module.exports = { createApp, suggestTemplates, ORDER_STATUSES };
