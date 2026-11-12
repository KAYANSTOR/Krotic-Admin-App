// Minimal in-memory Firestore double for handler-level tests.
// It implements only the surface the template-center handler touches
// (collection/doc get/set/create, batch, runTransaction) so we can exercise
// the real handler code paths without the Firestore emulator.

class DocSnapshot {
  constructor(id, data) {
    this.id = String(id).split('/').pop();
    this.path = id;
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

  collection(name) {
    return new CollectionRef(this.store, `${this.path}/${name}`);
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

  limit() { return this; }
  where() { return this; }
  orderBy() { return this; }
  startAfter() { return this; }

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

class CollectionGroupRef {
  constructor(store, collectionName) {
    this.store = store;
    this.collectionName = collectionName;
  }

  limit() { return this; }
  orderBy() { return this; }
  where() { return this; }

  async get() {
    const docs = [];
    for (const [path, data] of this.store.entries()) {
      const segments = path.split('/');
      if (segments.length >= 4 && segments.at(-2) === this.collectionName) {
        docs.push(new DocSnapshot(path, data));
      }
    }
    return { docs, empty: docs.length === 0, size: docs.length };
  }
}

/**
 * @param {object} seed path -> data
 * @param {{ strictTransactions?: boolean }} options strictTransactions: Firestore-like optimistic
 *   transactions — writes are buffered until the callback resolves; if any document read inside the
 *   transaction changed meanwhile, the callback is retried (up to 5 times) with fresh reads. Lets tests
 *   exercise real interleavings (a receipt and a fallback decision racing on one record).
 */
export function createFakeFirestore(seed = {}, { strictTransactions = false } = {}) {
  const store = new Map(Object.entries(seed));
  const versions = new Map();
  const bump = (path) => versions.set(path, (versions.get(path) || 0) + 1);
  const db = {
    _store: store,
    collection(name) {
      return new CollectionRef(store, name);
    },
    collectionGroup(name) {
      return new CollectionGroupRef(store, name);
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
      if (strictTransactions) {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const reads = new Map();
          const writes = [];
          const tx = {
            get: async (ref) => {
              reads.set(ref.path, versions.get(ref.path) || 0);
              return new DocSnapshot(ref.path, store.get(ref.path));
            },
            set: (ref, data, options) => writes.push(() => {
              store.set(ref.path, options?.merge && store.get(ref.path) ? { ...store.get(ref.path), ...data } : { ...data });
              bump(ref.path);
            }),
            create: (ref, data) => writes.push(() => {
              if (store.has(ref.path)) { const e = new Error('exists'); e.code = 6; throw e; }
              store.set(ref.path, { ...data });
              bump(ref.path);
            }),
            delete: (ref) => writes.push(() => { store.delete(ref.path); bump(ref.path); }),
          };
          const result = await callback(tx);
          // Commit is synchronous (atomic in this single-threaded double): validate, then apply.
          const conflicted = [...reads].some(([path, version]) => (versions.get(path) || 0) !== version);
          if (conflicted) { db.transactionRetries = (db.transactionRetries || 0) + 1; continue; }
          for (const write of writes) write();
          return result;
        }
        const error = new Error('transaction contention');
        error.code = 10;
        throw error;
      }
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
