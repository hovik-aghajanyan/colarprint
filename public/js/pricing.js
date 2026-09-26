/*
 * Shared pricing engine. Loaded in the browser (window.Pricing) for live quotes
 * and in Node (require) so the server can recompute the authoritative price.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Pricing = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const UNIT_TO_MM = { mm: 1, cm: 10, in: 25.4 };

  function toMm(value, unit) {
    const factor = UNIT_TO_MM[unit] || 1;
    return Number(value) * factor;
  }

  function fromMm(valueMm, unit) {
    const factor = UNIT_TO_MM[unit] || 1;
    return Number(valueMm) / factor;
  }

  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  function findById(list, id) {
    return (list || []).find((item) => item.id === id);
  }

  // Picks the best quantity tier: the one with the highest minQty <= quantity.
  function tierFor(tiers, quantity) {
    let best = null;
    for (const tier of tiers || []) {
      if (quantity >= Number(tier.minQty) && (!best || Number(tier.minQty) > Number(best.minQty))) {
        best = tier;
      }
    }
    return best;
  }

  /**
   * Calculates a price quote.
   *
   * @param {object} product  product definition (see src/seed.js)
   * @param {object} options  { widthMm, heightMm, quantity, colorId, materialId, sideId, finishIds, turnaroundId }
   * @param {object} settings { taxRate, turnarounds }
   * @returns {{ ok: boolean, errors: string[], breakdown: object|null }}
   */
  function calculate(product, options, settings) {
    const errors = [];
    settings = settings || {};
    options = options || {};

    if (!product) {
      return { ok: false, errors: ['Unknown product'], breakdown: null };
    }

    const widthMm = Number(options.widthMm);
    const heightMm = Number(options.heightMm);
    const quantity = Math.floor(Number(options.quantity));

    if (!(widthMm > 0) || !(heightMm > 0)) {
      errors.push('Width and height must be positive numbers');
    } else {
      if (product.minWidth && widthMm < product.minWidth) errors.push(`Width must be at least ${product.minWidth} mm`);
      if (product.maxWidth && widthMm > product.maxWidth) errors.push(`Width must be at most ${product.maxWidth} mm`);
      if (product.minHeight && heightMm < product.minHeight) errors.push(`Height must be at least ${product.minHeight} mm`);
      if (product.maxHeight && heightMm > product.maxHeight) errors.push(`Height must be at most ${product.maxHeight} mm`);
    }

    const minQty = Math.max(1, Number(product.minQuantity) || 1);
    if (!(quantity >= minQty)) errors.push(`Quantity must be at least ${minQty}`);

    const color = options.colorId ? findById(product.colorOptions, options.colorId) : (product.colorOptions || [])[0];
    if (!color && (product.colorOptions || []).length) errors.push('Unknown color option');

    const material = options.materialId ? findById(product.materials, options.materialId) : (product.materials || [])[0];
    if (!material && (product.materials || []).length) errors.push('Unknown material');

    const side = options.sideId ? findById(product.sides, options.sideId) : (product.sides || [])[0];
    if (!side && (product.sides || []).length) errors.push('Unknown sides option');

    const finishIds = Array.isArray(options.finishIds) ? options.finishIds : [];
    const finishes = [];
    for (const id of finishIds) {
      const f = findById(product.finishes, id);
      if (f) finishes.push(f);
      else errors.push(`Unknown finish: ${id}`);
    }

    const turnarounds = settings.turnarounds || [];
    const turnaround = options.turnaroundId ? findById(turnarounds, options.turnaroundId) : turnarounds[0];
    if (!turnaround && options.turnaroundId) errors.push('Unknown turnaround option');

    if (errors.length) return { ok: false, errors, breakdown: null };

    const areaSqm = (widthMm * heightMm) / 1e6;
    const ratePerSqm = Number(product.pricePerSqm || 0) + Number((material && material.pricePerSqm) || 0);
    const colorMultiplier = Number((color && color.multiplier) || 1);
    const sideMultiplier = Number((side && side.multiplier) || 1);

    const rawPrintCost = areaSqm * ratePerSqm * colorMultiplier * sideMultiplier;
    const minUnitPrice = Number(product.minUnitPrice || 0);
    const unitPrint = Math.max(rawPrintCost, minUnitPrice);

    let finishPerUnit = 0;
    let finishFlat = 0;
    const finishLines = finishes.map((f) => {
      const perUnit = Number(f.perUnit || 0) + Number(f.perSqm || 0) * areaSqm;
      const flat = Number(f.flat || 0);
      finishPerUnit += perUnit;
      finishFlat += flat;
      return { id: f.id, name: f.name, perUnit: round2(perUnit), flat: round2(flat) };
    });

    const unitPrice = unitPrint + finishPerUnit;
    const subtotal = unitPrice * quantity;

    const tier = tierFor(product.quantityTiers, quantity);
    const discountPct = tier ? Number(tier.discountPct || 0) : 0;
    const discount = (subtotal * discountPct) / 100;

    const turnaroundMultiplier = Number((turnaround && turnaround.multiplier) || 1);
    const rushFee = (subtotal - discount) * (turnaroundMultiplier - 1);

    const setupFee = Number(product.setupFee || 0);
    const net = subtotal - discount + rushFee + setupFee + finishFlat;
    const taxRate = Number(settings.taxRate || 0);
    const tax = (net * taxRate) / 100;
    const total = net + tax;

    return {
      ok: true,
      errors: [],
      breakdown: {
        widthMm,
        heightMm,
        quantity,
        areaSqm: Math.round(areaSqm * 10000) / 10000,
        totalAreaSqm: Math.round(areaSqm * quantity * 10000) / 10000,
        ratePerSqm: round2(ratePerSqm),
        color: color ? { id: color.id, name: color.name, multiplier: colorMultiplier } : null,
        material: material ? { id: material.id, name: material.name, pricePerSqm: Number(material.pricePerSqm || 0) } : null,
        side: side ? { id: side.id, name: side.name, multiplier: sideMultiplier } : null,
        turnaround: turnaround
          ? { id: turnaround.id, name: turnaround.name, days: turnaround.days, multiplier: turnaroundMultiplier }
          : null,
        finishes: finishLines,
        minUnitPriceApplied: rawPrintCost < minUnitPrice,
        unitPrice: round2(unitPrice),
        subtotal: round2(subtotal),
        discountPct,
        discount: round2(discount),
        rushFee: round2(rushFee),
        setupFee: round2(setupFee),
        finishFlat: round2(finishFlat),
        net: round2(net),
        taxRate,
        tax: round2(tax),
        total: round2(total),
        perPiece: round2(total / quantity),
      },
    };
  }

  function formatMoney(amount, settings) {
    const currency = (settings && settings.currency) || 'USD';
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
    } catch (e) {
      return `${currency} ${Number(amount).toFixed(2)}`;
    }
  }

  return { calculate, toMm, fromMm, round2, tierFor, formatMoney, UNIT_TO_MM };
});
