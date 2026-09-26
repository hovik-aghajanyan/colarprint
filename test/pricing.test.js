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
  pricePerSqft: 10,
  minUnitPrice: 0,
  setupFee: 0,
  minQuantity: 1,
  minWidth: 1, maxWidth: 120, minHeight: 1, maxHeight: 120,
  colorOptions: [
    { id: 'bw', name: 'B/W', multiplier: 1 },
    { id: 'color', name: 'Color', multiplier: 2 },
  ],
  materials: [
    { id: 'std', name: 'Standard', pricePerSqft: 0 },
    { id: 'premium', name: 'Premium', pricePerSqft: 5 },
  ],
  sides: [
    { id: 'single', name: 'Single', multiplier: 1 },
    { id: 'double', name: 'Double', multiplier: 1.5 },
  ],
  finishes: [
    { id: 'lam', name: 'Laminate', perUnit: 0, perSqft: 1, flat: 0 },
    { id: 'setup', name: 'Die', perUnit: 1, perSqft: 0, flat: 20 },
  ],
  quantityTiers: [
    { minQty: 10, discountPct: 10 },
    { minQty: 100, discountPct: 20 },
  ],
};

// 12 × 12 in = 1 sq ft
const base = { width: 12, height: 12, quantity: 1 };

test('price scales with area', () => {
  const one = Pricing.calculate(product, base, settings);
  const half = Pricing.calculate(product, { ...base, height: 6 }, settings);
  assert.equal(one.ok, true);
  assert.equal(one.breakdown.areaSqft, 1);
  assert.equal(one.breakdown.total, 10);
  assert.equal(half.breakdown.total, 5);
});

test('color, material and sides modify the print cost', () => {
  const r = Pricing.calculate(product, { ...base, colorId: 'color', materialId: 'premium', sideId: 'double' }, settings);
  // 1 sq ft × (10 + 5) × 2 × 1.5
  assert.equal(r.breakdown.unitPrice, 45);
});

test('minimum piece price applies to tiny prints', () => {
  const r = Pricing.calculate({ ...product, minUnitPrice: 5 }, { ...base, width: 1, height: 1 }, settings);
  assert.equal(r.breakdown.unitPrice, 5);
  assert.equal(r.breakdown.minUnitPriceApplied, true);
});

test('quantity tiers pick the highest reached tier', () => {
  assert.equal(Pricing.calculate(product, { ...base, quantity: 9 }, settings).breakdown.discountPct, 0);
  assert.equal(Pricing.calculate(product, { ...base, quantity: 10 }, settings).breakdown.discountPct, 10);
  const r = Pricing.calculate(product, { ...base, quantity: 150 }, settings);
  assert.equal(r.breakdown.discountPct, 20);
  assert.equal(r.breakdown.total, 150 * 10 * 0.8);
});

test('finishes add per-piece, per-sq-ft and flat fees', () => {
  const r = Pricing.calculate(product, { ...base, quantity: 2, finishIds: ['lam', 'setup'] }, settings);
  // unit = 10 + 1 (lam) + 1 = 12; ×2 = 24; + 20 flat
  assert.equal(r.breakdown.unitPrice, 12);
  assert.equal(r.breakdown.total, 44);
});

test('turnaround, setup fee and tax', () => {
  const r = Pricing.calculate({ ...product, setupFee: 10 }, { ...base, turnaroundId: 'express' }, { ...settings, taxRate: 10 });
  // 10 + 5 rush + 10 setup = 25, +10% tax
  assert.equal(r.breakdown.rushFee, 5);
  assert.equal(r.breakdown.net, 25);
  assert.equal(r.breakdown.total, 27.5);
});

test('rejects sizes outside the limits and too-small quantities', () => {
  const r = Pricing.calculate({ ...product, minQuantity: 5 }, { width: 500, height: 0.5, quantity: 1 }, settings);
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 3);
});

test('rejects unknown options', () => {
  const r = Pricing.calculate(product, { ...base, colorId: 'nope', finishIds: ['bogus'] }, settings);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /color/i);
  assert.match(r.errors.join(' '), /bogus/);
});

test('unit conversion and formatting', () => {
  assert.equal(Pricing.toInches(3, 'ft'), 36);
  assert.equal(Pricing.toInches(8.5, 'in'), 8.5);
  assert.equal(Pricing.fromInches(72, 'ft'), 6);
  assert.equal(Pricing.formatSize(8.5, 11), '8.5 × 11 in');
  assert.equal(Pricing.formatSize(72, 36, 'ft'), '6 × 3 ft');
});
