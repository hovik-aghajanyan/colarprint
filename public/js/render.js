/*
 * Renders a template/design into an SVG element. Element coordinates are
 * percentages of the print area; text size is a percentage of its height.
 * Everything is built with DOM APIs (textContent), never innerHTML, so
 * user-provided text cannot inject markup.
 */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';

  function node(name, attrs) {
    const n = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v !== undefined && v !== null) n.setAttribute(k, v);
    }
    return n;
  }

  /**
   * @param {object} design { background, elements }
   * @param {number} width  print width (any unit, used for the aspect ratio)
   * @param {number} height print height
   * @param {object} [opts] { selectedId, onSelect }
   */
  function renderDesign(design, width, height, opts) {
    opts = opts || {};
    // Normalise to a 1000-unit wide canvas so stroke widths etc. look the same at any size.
    const W = 1000;
    const H = (1000 * height) / width;
    const svg = node('svg', {
      viewBox: `0 0 ${W} ${H}`,
      xmlns: NS,
      preserveAspectRatio: 'xMidYMid meet',
      class: 'design-svg',
    });
    const clipId = `clip-${Math.random().toString(36).slice(2, 9)}`;
    const defs = node('defs');
    const clip = node('clipPath', { id: clipId });
    clip.appendChild(node('rect', { x: 0, y: 0, width: W, height: H }));
    defs.appendChild(clip);
    svg.appendChild(defs);

    const g = node('g', { 'clip-path': `url(#${clipId})` });
    g.appendChild(node('rect', { x: 0, y: 0, width: W, height: H, fill: design.background || '#ffffff' }));

    const px = (v) => (Number(v) / 100) * W;
    const py = (v) => (Number(v) / 100) * H;
    const minSide = Math.min(W, H);

    for (const el of design.elements || []) {
      let shape = null;
      if (el.type === 'rect') {
        shape = node('rect', {
          x: px(el.x), y: py(el.y), width: px(el.w), height: py(el.h),
          rx: ((Number(el.rx) || 0) / 100) * minSide,
          fill: el.fill,
        });
      } else if (el.type === 'circle') {
        shape = node('circle', { cx: px(el.cx), cy: py(el.cy), r: ((Number(el.r) || 0) / 100) * minSide, fill: el.fill });
      } else if (el.type === 'image') {
        if (el.href) {
          shape = node('image', {
            x: px(el.x), y: py(el.y), width: px(el.w), height: py(el.h),
            href: el.href, preserveAspectRatio: 'xMidYMid meet',
          });
        } else {
          shape = node('g');
          shape.appendChild(node('rect', {
            x: px(el.x), y: py(el.y), width: px(el.w), height: py(el.h),
            fill: 'rgba(148,163,184,0.25)', stroke: '#94a3b8', 'stroke-dasharray': '8 6', 'stroke-width': 2,
          }));
          const t = node('text', {
            x: px(el.x) + px(el.w) / 2, y: py(el.y) + py(el.h) / 2,
            'text-anchor': 'middle', 'dominant-baseline': 'middle',
            'font-size': Math.min(px(el.w), py(el.h)) / 6, fill: '#64748b', 'font-family': 'sans-serif',
          });
          t.textContent = el.label || 'Your image';
          shape.appendChild(t);
        }
      } else if (el.type === 'text') {
        const fontSize = (Number(el.size) / 100) * H;
        shape = node('text', {
          x: px(el.x), y: py(el.y),
          'font-size': fontSize,
          'font-weight': el.weight || 'normal',
          'font-family': el.font || 'Inter, "Helvetica Neue", Arial, sans-serif',
          fill: el.color || '#000',
          'text-anchor': el.align || 'start',
          'dominant-baseline': 'middle',
        });
        const lines = String(el.text || '').split('\n');
        // Centre multi-line blocks vertically around y.
        const offset = -((lines.length - 1) * 1.15 * fontSize) / 2;
        lines.forEach((line, i) => {
          const span = node('tspan', { x: px(el.x), dy: i === 0 ? offset : 1.15 * fontSize });
          span.textContent = line || ' ';
          shape.appendChild(span);
        });
      }
      if (!shape) continue;
      shape.dataset.id = el.id;
      if (opts.onSelect) {
        shape.style.cursor = 'pointer';
        shape.addEventListener('click', (e) => {
          e.stopPropagation();
          opts.onSelect(el.id);
        });
      }
      if (opts.selectedId === el.id) shape.setAttribute('class', 'is-selected');
      g.appendChild(shape);
    }
    svg.appendChild(g);
    return svg;
  }

  function svgToString(svg) {
    const clone = svg.cloneNode(true);
    clone.removeAttribute('class');
    clone.querySelectorAll('.is-selected').forEach((n) => n.removeAttribute('class'));
    return new XMLSerializer().serializeToString(clone);
  }

  // Rasterises an SVG element to a PNG data URL at the given pixel width.
  function svgToPng(svg, pixelWidth) {
    return new Promise((resolve, reject) => {
      const vb = svg.viewBox.baseVal;
      const w = pixelWidth;
      const h = Math.round((pixelWidth * vb.height) / vb.width);
      const clone = svg.cloneNode(true);
      clone.setAttribute('width', w);
      clone.setAttribute('height', h);
      const blob = new Blob([svgToString(clone)], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e);
      };
      img.src = url;
    });
  }

  root.Render = { renderDesign, svgToString, svgToPng };
})(window);
