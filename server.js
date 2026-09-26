const path = require('path');
const { Store } = require('./src/store');
const { createApp } = require('./src/app');

const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

if (!process.env.ADMIN_PASSWORD) {
  console.warn('⚠️  ADMIN_PASSWORD is not set — using the default "admin123". Set it before going live.');
}

const store = new Store(DATA_FILE).load();
const app = createApp(store, { adminPassword: ADMIN_PASSWORD });

app.listen(PORT, () => {
  console.log(`ColorPrint running at http://localhost:${PORT}`);
  console.log(`Admin panel:        http://localhost:${PORT}/admin`);
});
