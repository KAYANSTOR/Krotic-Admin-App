// بدائل في الذاكرة للقاعدة المحلية (Dexie) تُستخدم لاختبار محرك المزامنة
// دون متصفح أو IndexedDB حقيقي.

class MemoryTable {
  constructor(keyPath) {
    this.keyPath = keyPath;
    this.rows = new Map();
  }

  keyFor(row) {
    if (Array.isArray(this.keyPath)) {
      return JSON.stringify(this.keyPath.map((part) => row[part]));
    }
    return row[this.keyPath];
  }

  async bulkPut(rows) {
    for (const row of rows) this.rows.set(this.keyFor(row), { ...row });
    return rows.length;
  }

  async put(row) {
    this.rows.set(this.keyFor(row), { ...row });
    return row[this.keyPath];
  }

  async get(key) {
    const found = this.rows.get(this.keyPath === 'key' ? key : JSON.stringify(key));
    return found ? { ...found } : undefined;
  }

  async delete(key) {
    const normalized = this.keyPath === 'key' ? key : JSON.stringify(key);
    this.rows.delete(normalized);
  }

  async clear() {
    this.rows.clear();
  }

  async toArray() {
    return [...this.rows.values()].map((row) => ({ ...row }));
  }

  async count() {
    return this.rows.size;
  }
}

export function createMemoryDb() {
  const db = {
    users: new MemoryTable('uid'),
    networks: new MemoryTable('networkId'),
    sales: new MemoryTable(['networkId', 'id']),
    payments: new MemoryTable(['networkId', 'id']),
    aggregates: new MemoryTable('uid'),
    sync_state: new MemoryTable('key'),
    meta: new MemoryTable('key'),
    table(name) {
      if (!this[name]) throw new Error(`unknown table: ${name}`);
      return this[name];
    },
  };
  return db;
}

/** مصدر بيانات تجريبي يحاكي مجموعة على السيرفر. */
export function createFakeSource(key, table, rows, { pageSize = 2 } = {}) {
  const source = {
    key,
    table,
    rows: [...rows].sort((a, b) => (a.updatedAtMs || 0) - (b.updatedAtMs || 0)),
    pageSize,
    sorted() {
      return [...this.rows].sort((a, b) => (a.updatedAtMs || 0) - (b.updatedAtMs || 0));
    },
    async latestMs() {
      const sorted = source.sorted();
      const top = sorted[sorted.length - 1];
      return top ? Number(top.updatedAtMs) || 0 : 0;
    },
    async pullSince(src, cursorMs, onRows) {
      const sorted = src.sorted();
      const pending = sorted.filter((row) => (Number(row.updatedAtMs) || 0) >= cursorMs);
      let maxMs = cursorMs;
      let index = 0;
      while (index < pending.length) {
        const page = pending.slice(index, index + src.pageSize);
        index += page.length;
        await onRows(page.map((row) => ({ ...row })));
        maxMs = Math.max(maxMs, ...page.map((row) => Number(row.updatedAtMs) || 0));
      }
      return maxMs;
    },
  };
  return source;
}
