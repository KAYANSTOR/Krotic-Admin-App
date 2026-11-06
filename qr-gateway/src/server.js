import { BufferJSON, DisconnectReason, makeCacheableSignalKeyStore, default as makeWASocket } from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { createGatewayApp } from './app.js';
import { MessageLedger } from './message-ledger.js';
import { parseVaultKey } from './secure-store.js';
import { SessionManager } from './session-manager.js';
import { StatusReporter } from './status-reporter.js';

function requiredSecret(name, value, minLength = 32) {
  const secret = String(value || '').trim();
  if (secret.length < minLength) throw new Error(`${name}_invalid`);
  return secret;
}

function validateCallbackUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('GATEWAY_STATUS_CALLBACK_URL_missing');
  let url;
  try { url = new URL(raw); } catch { throw new Error('GATEWAY_STATUS_CALLBACK_URL_invalid'); }
  if (!(url.protocol === 'https:' || (['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol === 'http:'))) {
    throw new Error('GATEWAY_STATUS_CALLBACK_URL_must_be_https');
  }
  return url.toString();
}

export function readGatewayConfig(env = process.env) {
  const dataDir = String(env.GATEWAY_DATA_DIR || '').trim();
  if (!dataDir || !dataDir.startsWith('/')) throw new Error('GATEWAY_DATA_DIR_must_be_absolute');
  const serviceToken = requiredSecret('GATEWAY_SERVICE_TOKEN', env.GATEWAY_SERVICE_TOKEN);
  const vaultKey = parseVaultKey(env.GATEWAY_VAULT_KEY_BASE64);
  const callbackUrl = validateCallbackUrl(env.GATEWAY_STATUS_CALLBACK_URL);
  const maxSessions = Number(env.GATEWAY_MAX_SESSIONS || 1);
  if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 50) throw new Error('GATEWAY_MAX_SESSIONS_invalid');
  return { dataDir, serviceToken, vaultKey, callbackUrl, maxSessions };
}

export function buildGateway(config = readGatewayConfig()) {
  const logger = pino({ level: 'silent' });
  const ledger = new MessageLedger(config.dataDir, config.vaultKey);
  const statusReporter = new StatusReporter({
    url: config.callbackUrl,
    secret: config.serviceToken,
    dataDir: config.dataDir,
    vaultKey: config.vaultKey,
    onError: (code, networkHash) => console.error('whatsapp gateway status callback failed', { code, networkHash }),
  });
  const manager = new SessionManager({
    dataDir: config.dataDir,
    vaultKey: config.vaultKey,
    maxSessions: config.maxSessions,
    ledger,
    statusReporter,
    disconnectReasons: DisconnectReason,
    makeSocket: ({ auth }) => makeWASocket({
      auth: {
        creds: auth.creds,
        keys: makeCacheableSignalKeyStore(auth.keys, logger),
      },
      logger,
      markOnlineOnConnect: false,
      syncFullHistory: false,
    }),
    encodeQr: (value) => QRCode.toBuffer(value, { type: 'png', errorCorrectionLevel: 'M', margin: 1, width: 256 }),
  });
  return { manager, statusReporter, app: createGatewayApp({ manager, serviceToken: config.serviceToken, statusSecret: config.serviceToken, statusReporter }) };
}

async function main() {
  const config = readGatewayConfig();
  const { app, manager } = buildGateway(config);
  await manager.init();
  const port = Number(process.env.PORT) || 3000;
  const server = app.listen(port, '0.0.0.0', () => {
    console.log('whatsapp qr gateway listening', { port, maxSessions: config.maxSessions });
  });

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await manager.close();
    await new Promise((resolve) => server.close(resolve));
    process.exit(0);
  };
  process.on('SIGTERM', () => { void close(); });
  process.on('SIGINT', () => { void close(); });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    const code = typeof error?.message === 'string' && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'gateway_configuration_invalid';
    console.error('whatsapp qr gateway failed to start', { code });
    process.exit(1);
  });
}
