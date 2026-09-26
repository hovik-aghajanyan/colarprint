const test = require('node:test');
const assert = require('node:assert/strict');
const { Store } = require('../src/store');
const { createApp } = require('../src/app');

async function withServer(fn) {
  const store = new Store(null).load(); // in-memory, seeded
  const app = createApp(store, { adminPassword: 'secret' });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, token) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  try {
    await fn(call, store);
  } finally {
    server.close();
  }
}

const login = async (call) => (await call('POST', '/api/admin/login', { password: 'secret' })).body.token;

test('public catalogue and quote', () =>
  withServer(async (call) => {
    const products = await call('GET', '/api/products');
    assert.equal(products.status, 200);
    assert.ok(products.body.length >= 5);

    const quote = await call('POST', '/api/quote', { productId: 'posters', widthMm: 594, heightMm: 841, quantity: 1 });
    assert.equal(quote.status, 200);
    assert.equal(quote.body.ok, true);
    assert.ok(quote.body.breakdown.total > 0);

    const bad = await call('POST', '/api/quote', { productId: 'posters', widthMm: 99999, heightMm: 841, quantity: 1 });
    assert.equal(bad.status, 400);
  }));

test('template suggestions rank by aspect ratio', () =>
  withServer(async (call) => {
    const wide = await call('GET', '/api/templates/suggest?productId=banners&width=3000&height=1000');
    assert.equal(wide.status, 200);
    assert.equal(wide.body[0].id, 'banner-birthday');
    assert.equal(wide.body[0].fit, 'good');
    assert.ok(wide.body.every((t) => t.productIds.includes('banners')));
  }));

test('admin endpoints require login', () =>
  withServer(async (call) => {
    assert.equal((await call('GET', '/api/admin/products')).status, 401);
    assert.equal((await call('POST', '/api/admin/login', { password: 'wrong' })).status, 401);
    const token = await login(call);
    assert.equal((await call('GET', '/api/admin/products', null, token)).status, 200);
    await call('POST', '/api/admin/logout', null, token);
    assert.equal((await call('GET', '/api/admin/products', null, token)).status, 401);
  }));

test('admin price changes affect quotes', () =>
  withServer(async (call) => {
    const token = await login(call);
    const q = { productId: 'posters', widthMm: 1000, heightMm: 1000, quantity: 1 };
    const before = (await call('POST', '/api/quote', q)).body.breakdown.total;

    const product = (await call('GET', '/api/products/posters')).body;
    const updated = await call('PUT', '/api/admin/products/posters', { ...product, pricePerSqm: product.pricePerSqm * 2 }, token);
    assert.equal(updated.status, 200);

    const after = (await call('POST', '/api/quote', q)).body.breakdown.total;
    assert.ok(Math.abs(after - before * 2) < 0.02, `${after} should be double ${before}`);

    const invalid = await call('PUT', '/api/admin/products/posters', { ...product, pricePerSqm: 'abc' }, token);
    assert.equal(invalid.status, 400);
  }));

test('create product and template', () =>
  withServer(async (call) => {
    const token = await login(call);
    const created = await call('POST', '/api/admin/products', {
      name: 'Mugs', pricePerSqm: 100, minUnitPrice: 8,
      sizePresets: [{ name: 'Standard', width: 200, height: 90 }],
      colorOptions: [{ name: 'Full color', multiplier: 1 }],
    }, token);
    assert.equal(created.status, 201);
    assert.equal(created.body.id, 'mugs');
    assert.equal(created.body.sizePresets[0].id, 'standard');

    const tpl = await call('POST', '/api/admin/templates', {
      name: 'Mug Hello', productIds: ['mugs'], width: 200, height: 90,
      elements: [{ type: 'text', text: 'Hello', x: 50, y: 50, size: 20, color: '#000000' }],
    }, token);
    assert.equal(tpl.status, 201);

    const badTpl = await call('POST', '/api/admin/templates', { name: 'X', productIds: ['nope'] }, token);
    assert.equal(badTpl.status, 400);

    const list = await call('GET', '/api/templates?productId=mugs');
    assert.equal(list.body.length, 1);
  }));

test('orders: server recomputes price and admin can update status', () =>
  withServer(async (call) => {
    const order = await call('POST', '/api/orders', {
      productId: 'business-cards', widthMm: 89, heightMm: 51, quantity: 500, colorId: 'cmyk',
      finishIds: ['rounded'], turnaroundId: 'express',
      customer: { name: 'Ann', email: 'ann@example.com' },
      design: { templateId: 'bc-modern', background: '#ffffff', elements: [{ type: 'text', text: '<script>x</script>', x: 1, y: 1, size: 5, color: '#000' }] },
      total: 0.01, // ignored — the server computes the price
    });
    assert.equal(order.status, 201);
    const quote = (await call('POST', '/api/quote', {
      productId: 'business-cards', widthMm: 89, heightMm: 51, quantity: 500, colorId: 'cmyk', finishIds: ['rounded'], turnaroundId: 'express',
    })).body.breakdown;
    assert.equal(order.body.total, quote.total);

    assert.equal((await call('GET', `/api/orders/${order.body.id}?email=wrong@example.com`)).status, 404);
    const tracked = await call('GET', `/api/orders/${order.body.id}?email=ANN@example.com`);
    assert.equal(tracked.status, 200);
    assert.equal(tracked.body.status, 'new');

    const token = await login(call);
    const patched = await call('PATCH', `/api/admin/orders/${order.body.id}`, { status: 'in_production' }, token);
    assert.equal(patched.status, 200);
    assert.equal((await call('PATCH', `/api/admin/orders/${order.body.id}`, { status: 'bogus' }, token)).status, 400);

    const missingEmail = await call('POST', '/api/orders', { productId: 'business-cards', widthMm: 89, heightMm: 51, quantity: 500, customer: { name: 'A' } });
    assert.equal(missingEmail.status, 400);

    const badImage = await call('POST', '/api/orders', {
      productId: 'business-cards', widthMm: 89, heightMm: 51, quantity: 500,
      customer: { name: 'A', email: 'a@b.co' },
      design: { elements: [{ type: 'image', href: 'javascript:alert(1)' }] },
    });
    assert.equal(badImage.status, 400);
  }));
