// Minimal in-memory Firestore double for handler-level tests.
// It implements only the surface the template-center handler touches
// (collection/doc get/set/create, batch, runTransaction) so we can exercise
// the real handler code paths without the Firestore emulator.

class DocSnapshot {
  constructor(id, data) {
    this.id = id;
    this._data = data;
    this.exists = data !== undefined;
  }

  data() {
    return this._data;
  }
}

class DocRef {
  constructor(store, path) {
    this.store = store;
    this.path = path;
  }

  async get() {
    return new DocSnapshot(this.path, this.store.get(this.path));
  }

  async set(data, options = {}) {
    const current = this.store.get(this.path);
    this.store.set(this.path, options.merge && current ? { ...current, ...data } : { ...data });
  }

  async create(data) {
    if (this.store.has(this.path)) {
      const error = new Error('already exists');
      error.code = 6;
      throw error;
    }
    this.store.set(this.path, { ...data });
  }

  async delete() {
    this.store.delete(this.path);
  }
}

class CollectionRef {
  constructor(store, name) {
    this.store = store;
    this.name = name;
  }

  doc(id = `auto-${Math.random().toString(36).slice(2, 10)}`) {
    return new DocRef(this.store, `${this.name}/${id}`);
  }

  async get() {
    const docs = [];
    for (const [path, data] of this.store.entries()) {
      if (path.startsWith(`${this.name}/`)) docs.push(new DocSnapshot(path, data));
    }
    return { docs, empty: docs.length === 0, size: docs.length };
  }
}

export function createFakeFirestore(seed = {}) {
  const store = new Map(Object.entries(seed));
  const db = {
    _store: store,
    collection(name) {
      return new CollectionRef(store, name);
    },
    batch() {
      const ops = [];
      return {
        set: (ref, data, options) => ops.push(() => ref.set(data, options)),
        create: (ref, data) => ops.push(() => ref.create(data)),
        delete: (ref) => ops.push(() => ref.delete()),
        commit: async () => { for (const op of ops) await op(); },
      };
    },
    async runTransaction(callback) {
      const tx = {
        get: (ref) => ref.get(),
        set: (ref, data, options) => { store.set(ref.path, options?.merge && store.get(ref.path) ? { ...store.get(ref.path), ...data } : { ...data }); },
        create: (ref, data) => { if (store.has(ref.path)) { const e = new Error('exists'); e.code = 6; throw e; } store.set(ref.path, { ...data }); },
        delete: (ref) => { store.delete(ref.path); },
      };
      return callback(tx);
    },
  };
  return db;
}

/** Minimal Express-like res double that records the last response. */
export function createRes() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}
