// Minimal JSON-file database. Good enough for a small print shop; swap for a
// real database if order volume grows.
const fs = require('fs');
const path = require('path');
const { createSeed } = require('./seed');

class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = null;
  }

  load() {
    if (this.filePath && fs.existsSync(this.filePath)) {
      this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } else {
      this.data = createSeed();
      this.save();
    }
    for (const key of ['products', 'templates', 'orders']) {
      if (!Array.isArray(this.data[key])) this.data[key] = [];
    }
    if (!this.data.settings) this.data.settings = createSeed().settings;
    return this;
  }

  save() {
    if (!this.filePath) return; // in-memory mode (tests)
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.filePath);
  }

  get settings() {
    return this.data.settings;
  }

  set settings(value) {
    this.data.settings = value;
    this.save();
  }

  list(collection) {
    return this.data[collection];
  }

  get(collection, id) {
    return this.data[collection].find((item) => item.id === id);
  }

  insert(collection, item) {
    this.data[collection].push(item);
    this.save();
    return item;
  }

  replace(collection, id, item) {
    const idx = this.data[collection].findIndex((x) => x.id === id);
    if (idx === -1) return null;
    this.data[collection][idx] = item;
    this.save();
    return item;
  }

  remove(collection, id) {
    const idx = this.data[collection].findIndex((x) => x.id === id);
    if (idx === -1) return false;
    this.data[collection].splice(idx, 1);
    this.save();
    return true;
  }
}

module.exports = { Store };
