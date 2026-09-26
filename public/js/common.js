/* Small helpers shared by all storefront and admin pages. */
(function (root) {
  'use strict';

  async function api(path, options) {
    options = options || {};
    const headers = { ...(options.headers || {}) };
    let body = options.body;
    if (body !== undefined && typeof body !== 'string') {
      body = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(path, { ...options, headers, body });
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    if (!res.ok) {
      const err = new Error((data && (data.error || (data.errors || []).join('. '))) || `Request failed (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // Tiny hyperscript: h('div', { class: 'x', onclick: fn }, 'text', childNode)
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'selected' || k === 'disabled') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  function qs(name) {
    return new URLSearchParams(location.search).get(name);
  }

  let settingsPromise = null;
  function getSettings() {
    if (!settingsPromise) settingsPromise = api('/api/settings');
    return settingsPromise;
  }

  function fmtNum(n, digits) {
    return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits === undefined ? 2 : digits });
  }

  async function initShell() {
    const settings = await getSettings();
    document.querySelectorAll('[data-company]').forEach((n) => (n.textContent = settings.companyName));
    document.querySelectorAll('[data-tagline]').forEach((n) => (n.textContent = settings.tagline));
    document.querySelectorAll('[data-contact-email]').forEach((n) => (n.textContent = settings.contactEmail));
    document.querySelectorAll('[data-contact-phone]').forEach((n) => (n.textContent = settings.contactPhone));
    document.querySelectorAll('[data-year]').forEach((n) => (n.textContent = new Date().getFullYear()));
    if (document.title.includes('{company}')) document.title = document.title.replace('{company}', settings.companyName);
    return settings;
  }

  function toast(message, type) {
    let box = document.querySelector('.toasts');
    if (!box) {
      box = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(box);
    }
    const t = h('div', { class: `toast ${type || ''}` }, message);
    box.appendChild(t);
    setTimeout(() => t.remove(), 3800);
  }

  root.App = { api, h, qs, getSettings, initShell, toast, fmtNum };
})(window);
