import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, chmod } from 'node:fs/promises';
import path from 'node:path';

export function parseVaultKey(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('vault_key_missing');
  let key;
  try { key = Buffer.from(raw, 'base64'); } catch { throw new Error('vault_key_invalid'); }
  if (key.length !== 32 || key.toString('base64').replace(/=+$/, '') !== raw.replace(/=+$/, '')) {
    throw new Error('vault_key_invalid');
  }
  return key;
}

export function sha256Hex(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export class SecureJsonStore {
  #directory;
  #key;
  #locks = new Map();

  constructor(directory, key) {
    if (!path.isAbsolute(directory)) throw new Error('data_dir_must_be_absolute');
    if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('vault_key_invalid');
    this.#directory = directory;
    this.#key = Buffer.from(key);
  }

  async init() {
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    await chmod(this.#directory, 0o700).catch(() => {});
  }

  #file(resourceId) {
    const id = String(resourceId || '');
    if (!id || id.length > 512) throw new Error('secure_store_id_invalid');
    return path.join(this.#directory, `${sha256Hex(id)}.enc`);
  }

  async #locked(resourceId, operation) {
    const prior = this.#locks.get(resourceId) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const tail = prior.then(() => gate);
    this.#locks.set(resourceId, tail);
    await prior;
    try {
      return await operation();
    } finally {
      release();
      if (this.#locks.get(resourceId) === tail) this.#locks.delete(resourceId);
    }
  }

  async readJson(resourceId, { reviver } = {}) {
    await this.init();
    return this.#locked(resourceId, async () => {
      let envelopeText;
      try {
        envelopeText = await readFile(this.#file(resourceId), 'utf8');
      } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw new Error('secure_store_read_failed');
      }

      try {
        const envelope = JSON.parse(envelopeText);
        if (envelope?.v !== 1 || typeof envelope.iv !== 'string' || typeof envelope.tag !== 'string' || typeof envelope.ciphertext !== 'string') {
          throw new Error('envelope_invalid');
        }
        const iv = Buffer.from(envelope.iv, 'base64');
        const tag = Buffer.from(envelope.tag, 'base64');
        const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
        if (iv.length !== 12 || tag.length !== 16 || ciphertext.length > 32 * 1024 * 1024) throw new Error('envelope_invalid');
        const decipher = createDecipheriv('aes-256-gcm', this.#key, iv);
        decipher.setAAD(Buffer.from(String(resourceId), 'utf8'));
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
        return JSON.parse(plaintext, reviver);
      } catch {
        throw new Error('secure_store_integrity_failure');
      }
    });
  }

  async writeJson(resourceId, value, { replacer } = {}) {
    await this.init();
    return this.#locked(resourceId, async () => {
      const plaintext = Buffer.from(JSON.stringify(value, replacer), 'utf8');
      if (plaintext.length > 32 * 1024 * 1024) throw new Error('secure_store_value_too_large');
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
      cipher.setAAD(Buffer.from(String(resourceId), 'utf8'));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const envelope = JSON.stringify({
        v: 1,
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64'),
      });
      const destination = this.#file(resourceId);
      const temporary = `${destination}.${randomBytes(8).toString('hex')}.tmp`;
      let handle;
      try {
        handle = await open(temporary, 'wx', 0o600);
        await handle.writeFile(envelope, 'utf8');
        await handle.sync();
        await handle.close();
        handle = null;
        await rename(temporary, destination);
        await chmod(destination, 0o600).catch(() => {});
      } catch {
        if (handle) await handle.close().catch(() => {});
        await unlink(temporary).catch(() => {});
        throw new Error('secure_store_write_failed');
      }
    });
  }

  async delete(resourceId) {
    await this.init();
    return this.#locked(resourceId, async () => {
      try { await unlink(this.#file(resourceId)); } catch (error) {
        if (error?.code !== 'ENOENT') throw new Error('secure_store_delete_failed');
      }
    });
  }
}
