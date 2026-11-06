import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { SecureJsonStore, sha256Hex } from './secure-store.js';
import { createEncryptedAuthState, removeNetworkAuthState } from './encrypted-auth-state.js';

const VALID_NETWORK_ID = /^[A-Za-z0-9_-]{6,128}$/;
const ENGINE_VERSION = 'baileys-6.7.24';

function safeNetworkId(value) {
  return typeof value === 'string' && VALID_NETWORK_ID.test(value) ? value : null;
}

function statusFields(record) {
  return {
    lastSeenAtMs: Number.isSafeInteger(record.lastSeenAtMs) ? record.lastSeenAtMs : null,
    reasonCode: record.reasonCode || null,
    deviceName: record.deviceName || null,
    linkedAtMs: Number.isSafeInteger(record.linkedAtMs) ? record.linkedAtMs : null,
    engineVersion: ENGINE_VERSION,
  };
}

export class SessionManager {
  constructor({
    dataDir,
    vaultKey,
    maxSessions = 1,
    makeSocket,
    encodeQr,
    statusReporter,
    ledger,
    disconnectReasons = {},
    now = Date.now,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    reconnectBaseMs = 1_000,
    reconnectMaxMs = 30_000,
    qrTtlMs = 90_000,
  }) {
    if (!path.isAbsolute(dataDir)) throw new Error('data_dir_must_be_absolute');
    if (typeof makeSocket !== 'function' || typeof encodeQr !== 'function') throw new Error('gateway_engine_missing');
    this.dataDir = dataDir;
    this.vaultKey = vaultKey;
    this.maxSessions = Math.min(50, Math.max(1, Number(maxSessions) || 1));
    this.makeSocket = makeSocket;
    this.encodeQr = encodeQr;
    this.statusReporter = statusReporter;
    this.ledger = ledger;
    this.disconnectReasons = disconnectReasons;
    this.now = now;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.reconnectBaseMs = reconnectBaseMs;
    this.reconnectMaxMs = reconnectMaxMs;
    this.qrTtlMs = qrTtlMs;
    this.sessions = new Map();
    this.knownNetworkIds = new Set();
    this.indexStore = new SecureJsonStore(dataDir, vaultKey);
  }

  async init() {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    const index = await this.indexStore.readJson('network-index');
    if (Array.isArray(index)) {
      for (const id of index) if (safeNetworkId(id)) this.knownNetworkIds.add(id);
    }
    await this.ledger?.init(this.now());
    const toRestore = [...this.knownNetworkIds].slice(0, this.maxSessions);
    for (const networkId of toRestore) {
      void this.start(networkId, { restoring: true }).catch(() => {
        this.#emitError('restore_failed', networkId);
      });
    }
  }

  #emitError(code, networkId) {
    console.error('whatsapp gateway operation failed', {
      code,
      networkHash: sha256Hex(networkId || 'unknown').slice(0, 12),
    });
  }

  async #saveIndex() {
    const ids = [...this.knownNetworkIds].sort();
    await this.indexStore.writeJson('network-index', ids);
  }

  #report(record, status = record.status) {
    if (!this.statusReporter) return;
    void this.statusReporter.report(record.networkId, status, statusFields(record)).catch(() => {
      this.#emitError('status_callback_failed', record.networkId);
    });
  }

  #newRecord(networkId) {
    return {
      networkId,
      status: 'unlinked',
      reasonCode: null,
      deviceName: 'WhatsApp Web',
      linkedAtMs: null,
      lastSeenAtMs: null,
      qrImageBase64: null,
      qrExpiresAtMs: null,
      socket: null,
      auth: null,
      connectPromise: null,
      reconnectTimer: null,
      heartbeatTimer: null,
      qrTimer: null,
      qrWaiters: new Set(),
      intentionalStop: false,
      reconnectAttempt: 0,
      lastQrNonce: 0,
    };
  }

  async start(rawNetworkId, { restoring = false } = {}) {
    const networkId = safeNetworkId(rawNetworkId);
    if (!networkId) return { ok: false, error: 'network_id_invalid' };
    let record = this.sessions.get(networkId);
    if (record?.status === 'linked' && record.socket) return { ok: true, status: 'linked' };
    if (record?.connectPromise) return record.connectPromise;
    if (record?.socket && ['qr_pending', 'linking'].includes(record.status)) return { ok: true, status: record.status };
    if (!record) {
      if (this.sessions.size >= this.maxSessions) return { ok: false, error: 'session_limit_reached' };
      record = this.#newRecord(networkId);
      this.sessions.set(networkId, record);
    }
    record.intentionalStop = false;
    if (record.reconnectTimer) this.clearTimeoutFn(record.reconnectTimer);
    record.reconnectTimer = null;
    record.connectPromise = this.#connect(record, { restoring }).finally(() => {
      record.connectPromise = null;
    });
    return record.connectPromise;
  }

  async #connect(record, { restoring }) {
    const networkId = record.networkId;
    try {
      record.auth = await createEncryptedAuthState(this.dataDir, networkId, this.vaultKey);
      const hasCredentials = Boolean(record.auth.state.creds?.registered);
      record.status = hasCredentials || restoring ? 'linking' : 'qr_pending';
      record.reasonCode = null;
      record.qrImageBase64 = null;
      record.qrExpiresAtMs = null;
      this.knownNetworkIds.add(networkId);
      await this.#saveIndex();
      this.#report(record);

      const socket = this.makeSocket({ auth: record.auth.state, networkId });
      if (!socket?.ev || typeof socket.sendMessage !== 'function') throw new Error('socket_unavailable');
      record.socket = socket;
      socket.ev.on('creds.update', () => {
        void record.auth.saveCreds().catch(() => this.#handleFatal(record, socket, 'auth_store_failed'));
      });
      socket.ev.on('connection.update', (update) => {
        void this.#onConnectionUpdate(record, socket, update || {}).catch(() => {
          this.#handleFatal(record, socket, 'connection_update_failed');
        });
      });
      socket.ev.on('message-receipt.update', (updates) => {
        void this.#onReceiptUpdates(record, updates).catch(() => this.#emitError('receipt_update_failed', networkId));
      });
      socket.ev.on('messages.update', (updates) => {
        void this.#onMessageUpdates(record, updates).catch(() => this.#emitError('message_update_failed', networkId));
      });
      socket.ev.on('messages.upsert', (event) => this.#captureInbound(record, event));
      return { ok: true, status: record.status };
    } catch (error) {
      record.status = 'error';
      record.reasonCode = error?.message === 'secure_store_integrity_failure' ? 'auth_store_integrity_failure' : 'engine_start_failed';
      record.socket = null;
      this.#report(record);
      this.#emitError('engine_start_failed', networkId);
      return { ok: false, error: 'engine_start_failed' };
    }
  }

  async #onConnectionUpdate(record, socket, update) {
    if (record.socket !== socket || record.intentionalStop) return;
    if (typeof update.qr === 'string' && update.qr.length <= 16_384) {
      const nonce = ++record.lastQrNonce;
      try {
        const image = await this.encodeQr(update.qr);
        if (record.socket !== socket || nonce !== record.lastQrNonce || record.intentionalStop) return;
        record.qrImageBase64 = Buffer.from(image).toString('base64');
        record.qrExpiresAtMs = this.now() + this.qrTtlMs;
        record.status = 'qr_pending';
        record.reasonCode = null;
        this.#report(record);
        for (const resolve of record.qrWaiters) resolve({ ok: true, qrImageBase64: record.qrImageBase64, qrExpiresAtMs: record.qrExpiresAtMs });
        record.qrWaiters.clear();
        if (record.qrTimer) this.clearTimeoutFn(record.qrTimer);
        record.qrTimer = this.setTimeoutFn(() => {
          if (record.lastQrNonce === nonce && record.qrExpiresAtMs <= this.now()) {
            record.qrImageBase64 = null;
            record.qrExpiresAtMs = null;
          }
        }, this.qrTtlMs);
      } catch {
        record.status = 'error';
        record.reasonCode = 'qr_render_failed';
        this.#report(record);
        this.#emitError('qr_render_failed', record.networkId);
      }
    }

    if (update.connection === 'open') {
      record.status = 'linked';
      record.reasonCode = null;
      record.linkedAtMs ||= this.now();
      record.lastSeenAtMs = this.now();
      record.deviceName = 'WhatsApp Web';
      record.qrImageBase64 = null;
      record.qrExpiresAtMs = null;
      record.reconnectAttempt = 0;
      this.#startHeartbeat(record);
      this.#report(record);
      for (const resolve of record.qrWaiters) resolve({ ok: false, status: 'linked' });
      record.qrWaiters.clear();
      return;
    }

    if (update.connection === 'connecting' && record.status !== 'qr_pending') {
      record.status = 'linking';
      record.lastSeenAtMs = this.now();
      this.#report(record);
    }

    if (update.connection === 'close') {
      this.#stopHeartbeat(record);
      record.socket = null;
      record.qrImageBase64 = null;
      record.qrExpiresAtMs = null;
      const code = update.lastDisconnect?.error?.output?.statusCode;
      if (code === this.disconnectReasons.loggedOut) {
        record.status = 'relink_required';
        record.reasonCode = 'logged_out';
        this.#report(record);
        return;
      }
      record.status = 'disconnected';
      record.reasonCode = code === this.disconnectReasons.restartRequired ? 'server_restart_required' : 'connection_lost';
      this.#report(record);
      this.#scheduleReconnect(record, code === this.disconnectReasons.restartRequired ? 0 : undefined);
    }
  }

  #scheduleReconnect(record, delayOverride) {
    if (record.intentionalStop || record.reconnectTimer || record.status === 'relink_required') return;
    const delay = delayOverride ?? Math.min(this.reconnectMaxMs, this.reconnectBaseMs * (2 ** Math.min(record.reconnectAttempt, 8)));
    record.reconnectAttempt += 1;
    record.reconnectTimer = this.setTimeoutFn(() => {
      record.reconnectTimer = null;
      void this.start(record.networkId, { restoring: true });
    }, delay);
  }

  #startHeartbeat(record) {
    this.#stopHeartbeat(record);
    const tick = () => {
      if (record.status !== 'linked' || !record.socket || record.intentionalStop) return;
      record.lastSeenAtMs = this.now();
      this.#report(record);
      record.heartbeatTimer = this.setTimeoutFn(tick, 60_000);
    };
    record.heartbeatTimer = this.setTimeoutFn(tick, 60_000);
  }

  #stopHeartbeat(record) {
    if (record.heartbeatTimer) this.clearTimeoutFn(record.heartbeatTimer);
    record.heartbeatTimer = null;
  }

  async #handleFatal(record, socket, code) {
    if (record.socket !== socket) return;
    record.status = 'error';
    record.reasonCode = code;
    record.socket = null;
    this.#stopHeartbeat(record);
    this.#report(record);
    this.#emitError(code, record.networkId);
    this.#scheduleReconnect(record);
  }

  async #onReceiptUpdates(record, updates) {
    for (const item of Array.isArray(updates) ? updates : []) {
      const providerMessageId = item?.key?.id;
      const type = item?.receipt?.type;
      if (typeof providerMessageId !== 'string') continue;
      const status = type === 'read' || type === 'played' ? 'delivered' : (type === 'delivery' ? 'delivered' : null);
      if (status) await this.ledger?.updateByProviderMessageId(record.networkId, providerMessageId, status, this.now());
    }
  }

  async #onMessageUpdates(record, updates) {
    for (const item of Array.isArray(updates) ? updates : []) {
      const providerMessageId = item?.key?.id;
      if (typeof providerMessageId !== 'string') continue;
      const value = item?.update?.status;
      const status = value === 3 || value === 4 || value === 'READ' || value === 'PLAYED' ? 'delivered'
        : (value === 2 || value === 'DELIVERY_ACK' ? 'delivered' : null);
      if (status) await this.ledger?.updateByProviderMessageId(record.networkId, providerMessageId, status, this.now());
    }
  }

  #captureInbound(record, event) {
    if (!event || event.type !== 'notify' || !Array.isArray(event.messages)) return;
    if (!record.inbound) record.inbound = [];
    for (const item of event.messages) {
      if (item?.key?.fromMe || !item?.key?.id) continue;
      const message = item.message || {};
      const text = message.conversation || message.extendedTextMessage?.text || '';
      record.inbound.unshift({
        messageId: String(item.key.id).slice(0, 128),
        receivedAtMs: this.now(),
        ...(typeof item.key.remoteJid === 'string' ? { senderJid: item.key.remoteJid.slice(0, 128) } : {}),
        ...(typeof text === 'string' && text.length <= 4096 ? { text } : {}),
      });
    }
    record.inbound = record.inbound.slice(0, 100);
  }

  async waitForQr(rawNetworkId, timeoutMs = 8_000) {
    const networkId = safeNetworkId(rawNetworkId);
    if (!networkId) return { ok: false, error: 'network_id_invalid' };
    let record = this.sessions.get(networkId);
    if (!record) {
      const started = await this.start(networkId);
      if (!started.ok) return started;
      record = this.sessions.get(networkId);
    }
    if (record.status === 'linked') return { ok: false, status: 'linked' };
    if (record.qrImageBase64 && record.qrExpiresAtMs > this.now()) {
      return { ok: true, qrImageBase64: record.qrImageBase64, qrExpiresAtMs: record.qrExpiresAtMs };
    }
    return new Promise((resolve) => {
      let finished = false;
      const finish = (value) => {
        if (finished) return;
        finished = true;
        this.clearTimeoutFn(timer);
        record.qrWaiters.delete(finish);
        resolve(value);
      };
      const timer = this.setTimeoutFn(() => finish({ ok: false, error: 'qr_not_ready' }), timeoutMs);
      record.qrWaiters.add(finish);
      if (record.qrImageBase64 && record.qrExpiresAtMs > this.now()) {
        finish({ ok: true, qrImageBase64: record.qrImageBase64, qrExpiresAtMs: record.qrExpiresAtMs });
      }
    });
  }

  getStatus(rawNetworkId) {
    const networkId = safeNetworkId(rawNetworkId);
    if (!networkId) return { ok: false, error: 'network_id_invalid' };
    const record = this.sessions.get(networkId);
    if (!record) return { ok: true, session: { status: 'unlinked', engineVersion: ENGINE_VERSION } };
    return {
      ok: true,
      session: {
        status: record.status,
        ...(record.deviceName ? { deviceName: record.deviceName } : {}),
        ...(record.linkedAtMs ? { linkedAtMs: record.linkedAtMs } : {}),
        ...(record.lastSeenAtMs ? { lastSeenAtMs: record.lastSeenAtMs } : {}),
        ...(record.reasonCode ? { reasonCode: record.reasonCode } : {}),
        engineVersion: ENGINE_VERSION,
      },
    };
  }

  async disconnect(rawNetworkId) {
    const networkId = safeNetworkId(rawNetworkId);
    if (!networkId) return { ok: false, error: 'network_id_invalid' };
    const record = this.sessions.get(networkId);
    if (!record) return { ok: true };
    record.intentionalStop = true;
    this.#stopTimers(record);
    const socket = record.socket;
    record.socket = null;
    try { socket?.end?.(new Error('manual_disconnect')); } catch {}
    record.status = 'disconnected';
    record.reasonCode = 'manual_disconnect';
    this.#report(record);
    return { ok: true };
  }

  async relink(rawNetworkId) {
    const networkId = safeNetworkId(rawNetworkId);
    if (!networkId) return { ok: false, error: 'network_id_invalid' };
    const record = this.sessions.get(networkId);
    if (record) {
      record.intentionalStop = true;
      this.#stopTimers(record);
      try { record.socket?.end?.(new Error('manual_relink')); } catch {}
      this.sessions.delete(networkId);
    }
    await removeNetworkAuthState(this.dataDir, networkId);
    this.knownNetworkIds.delete(networkId);
    await this.#saveIndex();
    return this.start(networkId);
  }

  async unlink(rawNetworkId) {
    const networkId = safeNetworkId(rawNetworkId);
    if (!networkId) return { ok: false, error: 'network_id_invalid' };
    const record = this.sessions.get(networkId);
    if (record) {
      record.intentionalStop = true;
      this.#stopTimers(record);
      const socket = record.socket;
      record.socket = null;
      try { await socket?.logout?.(); } catch {}
      try { socket?.end?.(new Error('manual_unlink')); } catch {}
      this.sessions.delete(networkId);
    }
    await removeNetworkAuthState(this.dataDir, networkId);
    this.knownNetworkIds.delete(networkId);
    await this.#saveIndex();
    const cleared = this.#newRecord(networkId);
    cleared.status = 'unlinked';
    cleared.reasonCode = 'manual_unlink';
    this.#report(cleared);
    return { ok: true };
  }

  #stopTimers(record) {
    this.#stopHeartbeat(record);
    for (const key of ['reconnectTimer', 'qrTimer']) {
      if (record[key]) this.clearTimeoutFn(record[key]);
      record[key] = null;
    }
    record.qrImageBase64 = null;
    record.qrExpiresAtMs = null;
    for (const resolve of record.qrWaiters) resolve({ ok: false, error: 'session_stopped' });
    record.qrWaiters.clear();
  }

  async sendText({ networkId: rawNetworkId, deliveryId, destination, body }) {
    const networkId = safeNetworkId(rawNetworkId);
    if (!networkId) return { httpStatus: 400, data: { ok: false, error: 'network_id_invalid' } };
    if (typeof deliveryId !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(deliveryId)) {
      return { httpStatus: 400, data: { ok: false, error: 'delivery_id_invalid' } };
    }
    if (typeof destination !== 'string' || !/^\+?[0-9]{8,15}$/.test(destination)) {
      return { httpStatus: 400, data: { ok: false, error: 'destination_invalid' } };
    }
    if (typeof body !== 'string' || !body.trim() || body.length > 4096) {
      return { httpStatus: 400, data: { ok: false, error: 'message_body_invalid' } };
    }

    return this.ledger.withDeliveryLock(networkId, deliveryId, async () => {
      let claim;
      try {
        claim = await this.ledger.claim({ networkId, deliveryId, destination, body: body.trim(), now: this.now() });
      } catch {
        return { httpStatus: 503, data: { ok: false, error: 'message_ledger_unavailable', uncertain: false } };
      }
      if (!claim.ok) {
        const full = claim.error === 'ledger_capacity';
        return { httpStatus: full ? 503 : 409, data: { ok: false, error: claim.error, ...(full ? { uncertain: false } : {}) } };
      }
      if (claim.duplicate) {
        if (claim.record.status === 'sent' || claim.record.status === 'delivered') {
          return { httpStatus: 200, data: { ok: true, providerMessageId: claim.record.providerMessageId, duplicate: true, status: claim.record.status } };
        }
        return { httpStatus: 502, data: { ok: false, error: 'delivery_outcome_unknown', uncertain: true, status: 'unknown' } };
      }

      const record = this.sessions.get(networkId);
      if (!record || record.status !== 'linked' || !record.socket) {
        await this.ledger.update({ networkId, deliveryId, status: 'failed', reasonCode: 'session_not_linked', now: this.now() });
        return { httpStatus: 409, data: { ok: false, error: 'qr_session_not_linked' } };
      }

      const jid = `${destination.replace(/^\+/, '')}@s.whatsapp.net`;
      try {
        const result = await record.socket.sendMessage(jid, { text: body.trim() });
        const providerMessageId = result?.key?.id;
        if (typeof providerMessageId !== 'string' || !providerMessageId.trim()) throw new Error('send_ack_missing');
        await this.ledger.update({ networkId, deliveryId, status: 'sent', providerMessageId, now: this.now() });
        return { httpStatus: 200, data: { ok: true, providerMessageId: providerMessageId.trim(), status: 'sent' } };
      } catch {
        await this.ledger.update({ networkId, deliveryId, status: 'unknown', reasonCode: 'provider_ack_uncertain', now: this.now() }).catch(() => {});
        this.#emitError('provider_send_uncertain', networkId);
        return { httpStatus: 502, data: { ok: false, error: 'delivery_outcome_unknown', uncertain: true, status: 'unknown' } };
      }
    });
  }

  listMessages(networkId, limit) {
    return this.ledger.list(networkId, limit);
  }

  getMessage(networkId, deliveryId) {
    return this.ledger.find(networkId, deliveryId);
  }

  listInbound(networkId, limit = 100) {
    const record = this.sessions.get(safeNetworkId(networkId));
    return Array.isArray(record?.inbound) ? record.inbound.slice(0, Math.min(100, Math.max(1, Number(limit) || 100))) : [];
  }

  async close() {
    const records = [...this.sessions.values()];
    for (const record of records) {
      record.intentionalStop = true;
      this.#stopTimers(record);
      const socket = record.socket;
      record.socket = null;
      try { socket?.end?.(new Error('service_shutdown')); } catch {}
      if (record.status === 'linked') {
        record.status = 'disconnected';
        record.reasonCode = 'service_restart';
        this.#report(record);
      }
    }
  }
}
