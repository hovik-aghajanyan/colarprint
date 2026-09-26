/*
 * Normalisers for admin and order input. They coerce types, drop unknown
 * fields and throw a ValidationError with a readable message on bad input.
 * Shared by the server and the static (GitHub Pages) build.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Validate = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class ValidationError extends Error {}

  function str(value, field, { required = false, max = 500 } = {}) {
    if (value === undefined || value === null) value = '';
    if (typeof value !== 'string' && typeof value !== 'number') throw new ValidationError(`${field} must be text`);
    value = String(value).trim();
    if (required && !value) throw new ValidationError(`${field} is required`);
    if (value.length > max) throw new ValidationError(`${field} is too long (max ${max})`);
    return value;
  }

  function num(value, field, { min = 0, max = Infinity, def = 0 } = {}) {
    if (value === undefined || value === null || value === '') return def;
    const n = Number(value);
    if (!Number.isFinite(n)) throw new ValidationError(`${field} must be a number`);
    if (n < min || n > max) throw new ValidationError(`${field} must be between ${min} and ${max}`);
    return n;
  }

  function slug(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }

  function id(value, fallbackName) {
    const s = slug(value) || slug(fallbackName);
    return s || Math.random().toString(36).slice(2, 10);
  }

  function list(value, field, mapItem) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new ValidationError(`${field} must be a list`);
    const seen = new Set();
    return value.map((item, i) => {
      const out = mapItem(item || {}, `${field} #${i + 1}`);
      if (out.id !== undefined) {
        if (seen.has(out.id)) throw new ValidationError(`${field}: duplicate id "${out.id}"`);
        seen.add(out.id);
      }
      return out;
    });
  }

  const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
  function color(value, field, def = '#000000') {
    if (!value) return def;
    if (!COLOR_RE.test(String(value))) throw new ValidationError(`${field} must be a hex color like #ff0000`);
    return String(value);
  }

  function normalizeProduct(input, existingId) {
    const name = str(input.name, 'Name', { required: true, max: 120 });
    const product = {
      id: existingId || id(input.id, name),
      name,
      icon: str(input.icon, 'Icon', { max: 8 }),
      description: str(input.description, 'Description', { max: 2000 }),
      active: input.active !== false,
      pricePerSqm: num(input.pricePerSqm, 'Price per m²'),
      minUnitPrice: num(input.minUnitPrice, 'Minimum price per piece'),
      setupFee: num(input.setupFee, 'Setup fee'),
      minQuantity: Math.floor(num(input.minQuantity, 'Minimum quantity', { min: 1, def: 1 })),
      minWidth: num(input.minWidth, 'Min width', { def: 1 }),
      maxWidth: num(input.maxWidth, 'Max width', { def: 10000 }),
      minHeight: num(input.minHeight, 'Min height', { def: 1 }),
      maxHeight: num(input.maxHeight, 'Max height', { def: 10000 }),
      allowCustomSize: input.allowCustomSize !== false,
      sizePresets: list(input.sizePresets, 'Size preset', (p, f) => ({
        id: id(p.id, p.name),
        name: str(p.name, `${f} name`, { required: true, max: 120 }),
        width: num(p.width, `${f} width`, { min: 1 }),
        height: num(p.height, `${f} height`, { min: 1 }),
      })),
      colorOptions: list(input.colorOptions, 'Color option', (c, f) => ({
        id: id(c.id, c.name),
        name: str(c.name, `${f} name`, { required: true, max: 120 }),
        multiplier: num(c.multiplier, `${f} multiplier`, { min: 0, def: 1 }),
      })),
      materials: list(input.materials, 'Material', (m, f) => ({
        id: id(m.id, m.name),
        name: str(m.name, `${f} name`, { required: true, max: 120 }),
        pricePerSqm: num(m.pricePerSqm, `${f} extra price per m²`, { min: -1e6 }),
      })),
      sides: list(input.sides, 'Sides option', (s, f) => ({
        id: id(s.id, s.name),
        name: str(s.name, `${f} name`, { required: true, max: 120 }),
        multiplier: num(s.multiplier, `${f} multiplier`, { min: 0, def: 1 }),
      })),
      finishes: list(input.finishes, 'Finish', (x, f) => ({
        id: id(x.id, x.name),
        name: str(x.name, `${f} name`, { required: true, max: 120 }),
        perUnit: num(x.perUnit, `${f} price per piece`),
        perSqm: num(x.perSqm, `${f} price per m²`),
        flat: num(x.flat, `${f} flat fee`),
      })),
      quantityTiers: list(input.quantityTiers, 'Quantity tier', (t, f) => ({
        minQty: Math.floor(num(t.minQty, `${f} min quantity`, { min: 1, def: 1 })),
        discountPct: num(t.discountPct, `${f} discount %`, { min: 0, max: 100 }),
      })).sort((a, b) => a.minQty - b.minQty),
    };
    if (product.minWidth > product.maxWidth) throw new ValidationError('Min width cannot exceed max width');
    if (product.minHeight > product.maxHeight) throw new ValidationError('Min height cannot exceed max height');
    if (!product.sizePresets.length && !product.allowCustomSize) {
      throw new ValidationError('Add at least one size preset or allow custom sizes');
    }
    return product;
  }

  function normalizeElement(el, f) {
    const type = el.type;
    const base = { id: id(el.id, type), type };
    if (type === 'text') {
      return {
        ...base,
        label: str(el.label, `${f} label`, { max: 60 }) || 'Text',
        text: str(el.text, `${f} text`, { max: 1000 }),
        x: num(el.x, `${f} x`, { min: -100, max: 200 }),
        y: num(el.y, `${f} y`, { min: -100, max: 200 }),
        size: num(el.size, `${f} size`, { min: 0.1, max: 200, def: 5 }),
        color: color(el.color, `${f} color`),
        weight: el.weight === 'bold' ? 'bold' : 'normal',
        align: ['start', 'middle', 'end'].includes(el.align) ? el.align : 'start',
        font: str(el.font, `${f} font`, { max: 60 }) || undefined,
        editable: el.editable !== false,
      };
    }
    if (type === 'rect') {
      return {
        ...base,
        x: num(el.x, `${f} x`, { min: -100, max: 200 }),
        y: num(el.y, `${f} y`, { min: -100, max: 200 }),
        w: num(el.w, `${f} width`, { min: 0, max: 300, def: 10 }),
        h: num(el.h, `${f} height`, { min: 0, max: 300, def: 10 }),
        rx: num(el.rx, `${f} corner radius`, { min: 0, max: 100 }),
        fill: color(el.fill, `${f} fill`),
      };
    }
    if (type === 'circle') {
      return {
        ...base,
        cx: num(el.cx, `${f} center x`, { min: -100, max: 200 }),
        cy: num(el.cy, `${f} center y`, { min: -100, max: 200 }),
        r: num(el.r, `${f} radius`, { min: 0, max: 300, def: 10 }),
        fill: color(el.fill, `${f} fill`),
      };
    }
    if (type === 'image') {
      const href = str(el.href, `${f} image`, { max: 8_000_000 });
      if (href && !/^data:image\/(png|jpeg|gif|webp);base64,/.test(href)) {
        throw new ValidationError(`${f} image must be a PNG, JPEG, GIF or WebP upload`);
      }
      return {
        ...base,
        label: str(el.label, `${f} label`, { max: 60 }) || 'Image',
        href,
        x: num(el.x, `${f} x`, { min: -100, max: 200 }),
        y: num(el.y, `${f} y`, { min: -100, max: 200 }),
        w: num(el.w, `${f} width`, { min: 0, max: 300, def: 20 }),
        h: num(el.h, `${f} height`, { min: 0, max: 300, def: 20 }),
        editable: el.editable !== false,
      };
    }
    throw new ValidationError(`${f}: unknown element type "${type}"`);
  }

  function normalizeElements(elements) {
    return list(elements, 'Element', normalizeElement);
  }

  function normalizeTemplate(input, existingId, productIds) {
    const name = str(input.name, 'Name', { required: true, max: 120 });
    const ids = Array.isArray(input.productIds) ? input.productIds.map(String) : [];
    const unknown = ids.filter((p) => !productIds.includes(p));
    if (unknown.length) throw new ValidationError(`Unknown product(s): ${unknown.join(', ')}`);
    return {
      id: existingId || id(input.id, name),
      name,
      category: str(input.category, 'Category', { max: 60 }) || 'General',
      productIds: ids,
      width: num(input.width, 'Width', { min: 1, def: 100 }),
      height: num(input.height, 'Height', { min: 1, def: 100 }),
      background: color(input.background, 'Background', '#ffffff'),
      tags: (Array.isArray(input.tags) ? input.tags : String(input.tags || '').split(','))
        .map((t) => String(t).trim())
        .filter(Boolean)
        .slice(0, 20),
      elements: normalizeElements(input.elements),
    };
  }

  function normalizeSettings(input) {
    const currency = str(input.currency, 'Currency', { required: true, max: 3 }).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new ValidationError('Currency must be a 3-letter ISO code, e.g. USD');
    return {
      companyName: str(input.companyName, 'Company name', { required: true, max: 120 }),
      tagline: str(input.tagline, 'Tagline', { max: 300 }),
      currency,
      taxRate: num(input.taxRate, 'Tax rate', { min: 0, max: 100 }),
      contactEmail: str(input.contactEmail, 'Contact email', { max: 200 }),
      contactPhone: str(input.contactPhone, 'Contact phone', { max: 50 }),
      turnarounds: list(input.turnarounds, 'Turnaround', (t, f) => ({
        id: id(t.id, t.name),
        name: str(t.name, `${f} name`, { required: true, max: 60 }),
        days: Math.floor(num(t.days, `${f} days`, { min: 0, max: 365 })),
        multiplier: num(t.multiplier, `${f} multiplier`, { min: 0, def: 1 }),
      })),
    };
  }

  function normalizeCustomer(input) {
    input = input || {};
    const email = str(input.email, 'Email', { required: true, max: 200 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError('Please enter a valid email');
    return {
      name: str(input.name, 'Name', { required: true, max: 120 }),
      email,
      phone: str(input.phone, 'Phone', { max: 50 }),
      address: str(input.address, 'Address', { max: 500 }),
      notes: str(input.notes, 'Notes', { max: 2000 }),
    };
  }

  return {
    ValidationError,
    normalizeProduct,
    normalizeTemplate,
    normalizeSettings,
    normalizeCustomer,
    normalizeElements,
  };
});
