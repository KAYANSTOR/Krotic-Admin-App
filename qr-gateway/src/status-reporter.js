import { postGatewayStatus } from './status-signature.js';
import { SecureJsonStore, sha256Hex } from './secure-store.js';

const ALLOWED = new Set(['unlinked', 'qr_pending', 'linking', 'linked', 'disconnected', 'relink_required', 'error', 'unknown']);

export class StatusReporter {
  #store;
  #tails = new Map();

  constructor({ url, secret, dataDir, vaultKey, fetch = globalThis.fetch, now = Date.now, onError = null }) {
    this.url = url;
    this.secret = secret;
    this.#store = new SecureJsonStore(dataDir, vaultKey);
    this.fetch = fetch;
    this.now = now;
    this.onError = onError;
  }

  async #withNetworkLock(networkId, operation) {
    const lockKey = sha256Hex(networkId);
    const previous = this.#tails.get(lockKey) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const tail = previous.then(() => gate);
    this.#tails.set(lockKey, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#tails.get(lockKey) === tail) this.#tails.delete(lockKey);
    }
  }

  async report(networkId, status, fields = {}) {
    if (!ALLOWED.has(status)) return { ok: false, error: 'status_invalid' };
    return this.#withNetworkLock(networkId, async () => {
      const sequenceKey = `status-updated-at:${sha256Hex(networkId)}`;
      const prior = await this.#store.readJson(sequenceKey).catch(() => null);
      const previousTimestamp = Number.isSafeInteger(prior?.updatedAtMs) ? prior.updatedAtMs : 0;
      const updatedAtMs = Math.max(this.now(), previousTimestamp + 1);
      await this.#store.writeJson(sequenceKey, { updatedAtMs });

      const payload = {
        networkId,
        status,
        lastSeenAtMs: Number.isSafeInteger(fields.lastSeenAtMs) ? fields.lastSeenAtMs : null,
        reasonCode: typeof fields.reasonCode === 'string' ? fields.reasonCode.slice(0, 64) : null,
        deviceName: typeof fields.deviceName === 'string' ? fields.deviceName.slice(0, 64) : null,
        linkedAtMs: Number.isSafeInteger(fields.linkedAtMs) ? fields.linkedAtMs : null,
        updatedAtMs,
        engineVersion: typeof fields.engineVersion === 'string' ? fields.engineVersion.slice(0, 32) : 'baileys-6.7.24',
      };
      const result = await postGatewayStatus({
        url: this.url,
        secret: this.secret,
        payload,
        fetch: this.fetch,
        now: updatedAtMs,
      });
      if (!result.ok) {
        const code = result.error || 'callback_failed';
        if (typeof this.onError === 'function') this.onError(code, sha256Hex(networkId).slice(0, 12));
      }
      return result;
    });
  }
}
