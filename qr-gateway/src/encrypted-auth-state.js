import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { SecureJsonStore, sha256Hex } from './secure-store.js';

export function networkAuthDirectory(dataDir, networkId) {
  return path.join(dataDir, 'auth', sha256Hex(networkId));
}

export async function createEncryptedAuthState(dataDir, networkId, vaultKey) {
  const directory = networkAuthDirectory(dataDir, networkId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const store = new SecureJsonStore(directory, vaultKey);
  await store.init();
  const creds = (await store.readJson('creds.json', { reviver: BufferJSON.reviver })) || initAuthCreds();

  const keys = {
    async get(type, ids) {
      const entries = await Promise.all(ids.map(async (id) => {
        const fileId = `key:${type}:${id}`;
        let value = await store.readJson(fileId, { reviver: BufferJSON.reviver });
        if (type === 'app-state-sync-key' && value) {
          value = proto.Message.AppStateSyncKeyData.fromObject(value);
        }
        return [id, value];
      }));
      return Object.fromEntries(entries);
    },
    async set(data) {
      const writes = [];
      for (const [type, values] of Object.entries(data || {})) {
        for (const [id, value] of Object.entries(values || {})) {
          const fileId = `key:${type}:${id}`;
          writes.push(value == null
            ? store.delete(fileId)
            : store.writeJson(fileId, value, { replacer: BufferJSON.replacer }));
        }
      }
      await Promise.all(writes);
    },
    async clear() {
      await removeNetworkAuthState(dataDir, networkId);
    },
  };

  return {
    state: { creds, keys },
    saveCreds: () => store.writeJson('creds.json', creds, { replacer: BufferJSON.replacer }),
  };
}

export async function removeNetworkAuthState(dataDir, networkId) {
  const directory = networkAuthDirectory(dataDir, networkId);
  await rm(directory, { recursive: true, force: true });
}
