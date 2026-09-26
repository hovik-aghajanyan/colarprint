// Default data written to the database on first start. The catalog lives in
// public/data/catalog.json so the static GitHub Pages build uses the same data.
// All sizes are in millimetres, prices in the configured currency.
const fs = require('fs');
const path = require('path');

const CATALOG_FILE = path.join(__dirname, '..', 'public', 'data', 'catalog.json');

function createSeed() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
  return {
    settings: catalog.settings,
    products: catalog.products,
    templates: catalog.templates,
    orders: [],
  };
}

module.exports = { createSeed };
