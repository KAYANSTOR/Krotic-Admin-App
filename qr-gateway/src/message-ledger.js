import { SecureJsonStore, sha256Hex } from './secure-store.js';

const ACTIVE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_RECORDS = 5_000;
const STATUS_RANK = Object.freeze({ accepted: 0, unknown: 0, sent: 1, delivered: 2, failed: 1 });

export class MessageLedger {
  #store;
  #entries = {};
  #writeTail = Promise.resolve();
  #deliveryLocks = new Map();

  constructor(dataDir, vaultKey) {
    this.#store = new SecureJsonStore(dataDir, vaultKey);
  }

  async init(now = Date.now()) {
    const saved = await this.#store.readJson('message-ledger');
    this.#entries = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    let changed = false;
    for (const entry of Object.values(this.#entries)) {
      if (entry?.status === 'accepted') {
        entry.status = 'unknown';
        entry.reasonCode = 'gateway_restarted_during_send';
        entry.updatedAtMs = now;
        changed = true;
      }
    }
    this.#prune(now);
    if (changed) await this.#persist();
  }

  #key(networkId, deliveryId) {
    return sha256Hex(`${networkId}\0${deliveryId}`);
  }

  #networkHash(networkId) {
    return sha256Hex(networkId);
  }

  #prune(now) {
    const cutoff = now - ACTIVE_RETENTION_MS;
    for (const [key, entry] of Object.entries(this.#entries)) {
      if (!entry || !Number.isSafeInteger(entry.updatedAtMs) || entry.updatedAtMs < cutoff) {
        delete this.#entries[key];
      }
    }
  }

  async #mutate(operation) {
    const previous = this.#writeTail;
    let release;
    this.#writeTail = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      const result = await operation();
      return result;
    } finally {
      release();
    }
  }

  async #persist() {
    await this.#store.writeJson('message-ledger', this.#entries);
  }

  async withDeliveryLock(networkId, deliveryId, operation) {
    const key = this.#key(networkId, deliveryId);
    const previous = this.#deliveryLocks.get(key) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const tail = previous.then(() => gate);
    this.#deliveryLocks.set(key, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#deliveryLocks.get(key) === tail) this.#deliveryLocks.delete(key);
    }
  }

  async claim({ networkId, deliveryId, destination, body, now = Date.now() }) {
    return this.#mutate(async () => {
      const key = this.#key(networkId, deliveryId);
      const fingerprint = sha256Hex(`${destination}\0${body}`);
      const existing = this.#entries[key];
      if (existing) {
        if (existing.fingerprint !== fingerprint) return { ok: false, error: 'delivery_id_conflict' };
        return { ok: true, duplicate: true, record: this.#safeRecord(existing) };
      }

      this.#prune(now);
      if (Object.keys(this.#entries).length >= MAX_RECORDS) {
        return { ok: false, error: 'ledger_capacity' };
      }

      const entry = {
        networkHash: this.#networkHash(networkId),
        deliveryHash: sha256Hex(deliveryId),
        fingerprint,
        status: 'accepted',
        providerMessageId: null,
        reasonCode: null,
        createdAtMs: now,
        updatedAtMs: now,
      };
      this.#entries[key] = entry;
      this.#prune(now);
      await this.#persist();
      return { ok: true, duplicate: false, record: this.#safeRecord(entry) };
    });
  }

  async update({ networkId, deliveryId, status, providerMessageId = null, reasonCode = null, now = Date.now() }) {
    return this.#mutate(async () => {
      const key = this.#key(networkId, deliveryId);
      const entry = this.#entries[key];
      if (!entry) return { ok: false, error: 'delivery_not_found' };
      if (!Object.hasOwn(STATUS_RANK, status)) return { ok: false, error: 'status_invalid' };
      if (STATUS_RANK[status] < STATUS_RANK[entry.status]) return { ok: true, record: this.#safeRecord(entry) };
      entry.status = status;
      if (typeof providerMessageId === 'string' && providerMessageId.length <= 256) entry.providerMessageId = providerMessageId;
      entry.reasonCode = typeof reasonCode === 'string' ? reasonCode.slice(0, 64) : null;
      entry.updatedAtMs = now;
      await this.#persist();
      return { ok: true, record: this.#safeRecord(entry) };
    });
  }

  async updateByProviderMessageId(networkId, providerMessageId, status, now = Date.now()) {
    return this.#mutate(async () => {
      const networkHash = this.#networkHash(networkId);
      const entry = Object.values(this.#entries).find((candidate) => candidate.networkHash === networkHash && candidate.providerMessageId === providerMessageId);
      if (!entry || !Object.hasOwn(STATUS_RANK, status)) return { ok: false, error: 'delivery_not_found' };
      if (STATUS_RANK[status] >= STATUS_RANK[entry.status]) {
        entry.status = status;
        entry.updatedAtMs = now;
        await this.#persist();
      }
      return { ok: true, record: this.#safeRecord(entry) };
    });
  }

  async find(networkId, deliveryId) {
    const entry = this.#entries[this.#key(networkId, deliveryId)];
    return entry ? this.#safeRecord(entry) : null;
  }

  async list(networkId, limit = 100) {
    const networkHash = this.#networkHash(networkId);
    return Object.values(this.#entries)
      .filter((entry) => entry.networkHash === networkHash)
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
      .slice(0, Math.min(200, Math.max(1, Number(limit) || 100)))
      .map((entry) => this.#safeRecord(entry));
  }

  #safeRecord(entry) {
    return {
      status: entry.status,
      ...(entry.providerMessageId ? { providerMessageId: entry.providerMessageId } : {}),
      ...(entry.reasonCode ? { reasonCode: entry.reasonCode } : {}),
      createdAtMs: entry.createdAtMs,
      updatedAtMs: entry.updatedAtMs,
    };
  }
}
