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

  // All sizes are stored in inches and priced per square foot (US units).
  const UNIT_TO_IN = { in: 1, ft: 12 };
  const SQ_IN_PER_SQ_FT = 144;

  function toInches(value, unit) {
    const factor = UNIT_TO_IN[unit] || 1;
    return Number(value) * factor;
  }

  function fromInches(inches, unit) {
    const factor = UNIT_TO_IN[unit] || 1;
    return Number(inches) / factor;
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
   * @param {object} options  { width, height (inches), quantity, colorId, materialId, sideId, finishIds, turnaroundId }
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

    const width = Number(options.width);
    const height = Number(options.height);
    const quantity = Math.floor(Number(options.quantity));

    if (!(width > 0) || !(height > 0)) {
      errors.push('Width and height must be positive numbers');
    } else {
      if (product.minWidth && width < product.minWidth) errors.push(`Width must be at least ${product.minWidth} in`);
      if (product.maxWidth && width > product.maxWidth) errors.push(`Width must be at most ${product.maxWidth} in`);
      if (product.minHeight && height < product.minHeight) errors.push(`Height must be at least ${product.minHeight} in`);
      if (product.maxHeight && height > product.maxHeight) errors.push(`Height must be at most ${product.maxHeight} in`);
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

    const areaSqft = (width * height) / SQ_IN_PER_SQ_FT;
    const ratePerSqft = Number(product.pricePerSqft || 0) + Number((material && material.pricePerSqft) || 0);
    const colorMultiplier = Number((color && color.multiplier) || 1);
    const sideMultiplier = Number((side && side.multiplier) || 1);

    const rawPrintCost = areaSqft * ratePerSqft * colorMultiplier * sideMultiplier;
    const minUnitPrice = Number(product.minUnitPrice || 0);
    const unitPrint = Math.max(rawPrintCost, minUnitPrice);

    let finishPerUnit = 0;
    let finishFlat = 0;
    const finishLines = finishes.map((f) => {
      const perUnit = Number(f.perUnit || 0) + Number(f.perSqft || 0) * areaSqft;
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
        width,
        height,
        quantity,
        areaSqft: Math.round(areaSqft * 1000) / 1000,
        totalAreaSqft: Math.round(areaSqft * quantity * 1000) / 1000,
        ratePerSqft: round2(ratePerSqft),
        color: color ? { id: color.id, name: color.name, multiplier: colorMultiplier } : null,
        material: material ? { id: material.id, name: material.name, pricePerSqft: Number(material.pricePerSqft || 0) } : null,
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

    // Formats inches for display: whole numbers stay whole, otherwise up to 3 decimals (e.g. 3.5, 8.5, 0.125).
  function formatInches(inches) {
    return String(Math.round(Number(inches) * 1000) / 1000);
  }

  // "3.5 × 2 in" or, for large prints, "6 × 3 ft".
  function formatSize(width, height, unit) {
    unit = unit || 'in';
    const w = formatInches(fromInches(width, unit));
    const h = formatInches(fromInches(height, unit));
    return `${w} × ${h} ${unit}`;
  }

  // "7 sq in" for small prints, "8 sq ft" for large ones.
  function formatArea(sqft) {
    if (sqft < 1) return `${Math.round(sqft * SQ_IN_PER_SQ_FT * 10) / 10} sq in`;
    return `${Math.round(sqft * 100) / 100} sq ft`;
  }

  return { calculate, toInches, fromInches, formatInches, formatSize, formatArea, round2, tierFor, formatMoney, UNIT_TO_IN, SQ_IN_PER_SQ_FT };
});
