'use strict';
/* Lưu dữ liệu vào một file JSON (ghi nguyên tử, có hẹn giờ). */
const fs = require('fs');
const path = require('path');

class Store {
  constructor(file) {
    this.file = file;
    this.dirty = false;
    this.data = { users: {}, sessions: {}, games: [], seq: 1 };
    this.load();
    this.timer = setInterval(() => this.flush(), 2000);
    this.timer.unref();
  }

  load() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!fs.existsSync(this.file)) return;
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = Object.assign(this.data, d);
    } catch (e) {
      const backup = this.file + '.hong-' + Date.now();
      fs.copyFileSync(this.file, backup);
      console.error('Không đọc được dữ liệu, đã sao lưu sang', backup);
    }
  }

  save() { this.dirty = true; }

  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = Store;
