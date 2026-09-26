# ColorPrint

A website for a printing company. Customers choose a size, see the price straight away, start from a suggested template, and place an order. An admin panel controls every price.

## Features

**Storefront**
- **Size-based pricing:** pick a standard size or type a custom one in mm, cm or inches. The price updates as you type.
- Price inputs: print area × price per m², color mode (B/W, CMYK, spot), material, printed sides, finishing (per piece, per m² or flat fee), quantity discounts, turnaround (standard, express, same day) and tax.
- A "Buy more, save more" table shows the price per piece at each quantity tier.
- **Template suggestions:** templates are ranked by how closely their proportions match the size you chose. Each one is previewed at your size.
- **Design studio:** edit the text, colors and sizes, drag elements around, add text or upload a logo or image, change the background, and download a PNG preview. You can also upload your own print-ready artwork instead.
- Checkout. The server recalculates the price, so a price sent by the browser is never trusted.
- Order tracking by order number and email.

**Admin panel** (`/admin`)
- A dashboard with order counts and revenue.
- Orders: search and filter, change the status, view the design, and download it as PNG or SVG along with the original uploaded images.
- Products and pricing: price per m², minimum piece price, setup fee, minimum quantity, size limits, size presets, color options (multipliers), materials (extra per m²), sides, finishes and quantity discount tiers. A **live price tester** shows the effect of your changes before you save them.
- Templates: a visual editor for text, rectangle, circle and image elements, with a live preview. You choose which products each template is offered for.
- Settings: company details, currency, tax/VAT and turnaround options.

## Pricing formula

```
area          = width × height (m²)
piece price   = max(area × (price/m² + material extra) × color multiplier × sides multiplier, min piece price)
              + finishes (per piece + per m² × area)
subtotal      = piece price × quantity
discount      = subtotal × tier %            (highest tier reached)
rush fee      = (subtotal − discount) × (turnaround multiplier − 1)
total         = (subtotal − discount + rush fee + setup fee + finish flat fees) × (1 + tax %)
```

The same engine (`public/js/pricing.js`) runs in the browser for live quotes and on the server for the final price.

## Running

Requires Node.js 18 or later.

```bash
npm install
ADMIN_PASSWORD=choose-a-password npm start
# shop:  http://localhost:3000
# admin: http://localhost:3000/admin
```

| Variable         | Default          | Purpose                       |
|------------------|------------------|-------------------------------|
| `PORT`           | `3000`           | HTTP port                     |
| `ADMIN_PASSWORD` | `admin123`       | Admin login (change it!)      |
| `DATA_FILE`      | `data/db.json`   | Where data is stored          |

On first start, `data/db.json` is filled from `public/data/catalog.json` (the sample products, prices and templates). Delete it to reset to the catalog.

```bash
npm test   # pricing engine + API tests
```

## GitHub Pages (static version)

The site also runs on GitHub Pages without the Node server. In this mode the browser serves everything from `public/data/catalog.json`.

**One-time setup:** in the repository go to **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**. After that, every push to `main` runs the tests, builds the site and publishes it to `https://<user>.github.io/colarprint/`. The workflow is `.github/workflows/pages.yml`.

How the static version differs from the server version:

| | Node server | GitHub Pages |
|---|---|---|
| Prices, products, templates | stored in `data/db.json` | read from `public/data/catalog.json` |
| Admin login | `ADMIN_PASSWORD` | demo password `demo` (shown on the login screen) |
| Admin changes | saved on the server | saved in your browser until published |
| Orders | saved on the server, managed in admin | the customer downloads the design and emails the order to the contact email |

**To publish price or template changes on GitHub Pages:** open `admin.html`, make your changes, go to **Settings → Export catalog.json**, replace `public/data/catalog.json` in the repo with the downloaded file, and commit. The site redeploys automatically. The admin password on Pages is not secret, but nobody can publish anything without commit access to the repository.

Build it locally with `npm run build:pages` (the output goes to `_site/`).

## Project layout

```
server.js            entry point
src/app.js           Express routes (public + admin API)
src/store.js         JSON file storage
src/seed.js          loads the default catalog
scripts/build-pages.js  builds the static GitHub Pages site
public/              storefront, designer and admin (plain HTML/CSS/JS)
  data/catalog.json  products, prices, templates and settings
  js/pricing.js      shared pricing engine
  js/validate.js     input validation (server + static mode)
  js/suggest.js      template suggestions by aspect ratio
  js/static-api.js   in-browser API used on GitHub Pages
  js/render.js       SVG renderer for templates/designs
  js/options.js      product options form + price panel
test/                node:test suites
```
