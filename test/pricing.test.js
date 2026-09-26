const test = require('node:test');
const assert = require('node:assert/strict');
const Pricing = require('../public/js/pricing');

const settings = {
  taxRate: 0,
  turnarounds: [
    { id: 'standard', name: 'Standard', days: 5, multiplier: 1 },
    { id: 'express', name: 'Express', days: 2, multiplier: 1.5 },
  ],
};

const product = {
  id: 'p',
  pricePerSqm: 100,
  minUnitPrice: 0,
  setupFee: 0,
  minQuantity: 1,
  minWidth: 10, maxWidth: 2000, minHeight: 10, maxHeight: 2000,
  colorOptions: [
    { id: 'bw', name: 'B/W', multiplier: 1 },
    { id: 'color', name: 'Color', multiplier: 2 },
  ],
  materials: [
    { id: 'std', name: 'Standard', pricePerSqm: 0 },
    { id: 'premium', name: 'Premium', pricePerSqm: 50 },
  ],
  sides: [
    { id: 'single', name: 'Single', multiplier: 1 },
    { id: 'double', name: 'Double', multiplier: 1.5 },
  ],
  finishes: [
    { id: 'lam', name: 'Laminate', perUnit: 0, perSqm: 10, flat: 0 },
    { id: 'setup', name: 'Die', perUnit: 1, perSqm: 0, flat: 20 },
  ],
  quantityTiers: [
    { minQty: 10, discountPct: 10 },
    { minQty: 100, discountPct: 20 },
  ],
};

const base = { widthMm: 1000, heightMm: 1000, quantity: 1 };

test('price scales with area', () => {
  const one = Pricing.calculate(product, base, settings);
  const half = Pricing.calculate(product, { ...base, heightMm: 500 }, settings);
  assert.equal(one.ok, true);
  assert.equal(one.breakdown.total, 100);
  assert.equal(half.breakdown.total, 50);
});

test('color, material and sides modify the print cost', () => {
  const r = Pricing.calculate(product, { ...base, colorId: 'color', materialId: 'premium', sideId: 'double' }, settings);
  // 1 m² × (100 + 50) × 2 × 1.5
  assert.equal(r.breakdown.unitPrice, 450);
});

test('minimum piece price applies to tiny prints', () => {
  const r = Pricing.calculate({ ...product, minUnitPrice: 5 }, { ...base, widthMm: 10, heightMm: 10 }, settings);
  assert.equal(r.breakdown.unitPrice, 5);
  assert.equal(r.breakdown.minUnitPriceApplied, true);
});

test('quantity tiers pick the highest reached tier', () => {
  assert.equal(Pricing.calculate(product, { ...base, quantity: 9 }, settings).breakdown.discountPct, 0);
  assert.equal(Pricing.calculate(product, { ...base, quantity: 10 }, settings).breakdown.discountPct, 10);
  const r = Pricing.calculate(product, { ...base, quantity: 150 }, settings);
  assert.equal(r.breakdown.discountPct, 20);
  assert.equal(r.breakdown.total, 150 * 100 * 0.8);
});

test('finishes add per-piece, per-m² and flat fees', () => {
  const r = Pricing.calculate(product, { ...base, quantity: 2, finishIds: ['lam', 'setup'] }, settings);
  // unit = 100 + 10 (lam) + 1 = 111; ×2 = 222; + 20 flat
  assert.equal(r.breakdown.unitPrice, 111);
  assert.equal(r.breakdown.total, 242);
});

test('turnaround, setup fee and tax', () => {
  const r = Pricing.calculate({ ...product, setupFee: 10 }, { ...base, turnaroundId: 'express' }, { ...settings, taxRate: 10 });
  // 100 + 50 rush + 10 setup = 160, +10% tax
  assert.equal(r.breakdown.rushFee, 50);
  assert.equal(r.breakdown.net, 160);
  assert.equal(r.breakdown.total, 176);
});

test('rejects sizes outside the limits and too-small quantities', () => {
  const r = Pricing.calculate({ ...product, minQuantity: 5 }, { widthMm: 5000, heightMm: 1, quantity: 1 }, settings);
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 3);
});

test('rejects unknown options', () => {
  const r = Pricing.calculate(product, { ...base, colorId: 'nope', finishIds: ['bogus'] }, settings);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /color/i);
  assert.match(r.errors.join(' '), /bogus/);
});

test('unit conversion', () => {
  assert.equal(Pricing.toMm(2, 'in'), 50.8);
  assert.equal(Pricing.toMm(3, 'cm'), 30);
  assert.equal(Pricing.fromMm(254, 'in'), 10);
});
