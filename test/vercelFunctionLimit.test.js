import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_ROUTE_HANDLERS } from '../api/router.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiRoot = path.join(root, 'api');

async function listApiFunctions(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const relative = path.posix.join(prefix, entry.name);
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listApiFunctions(fullPath, relative);
    return /\.(js|mjs|cjs)$/.test(entry.name) ? [relative] : [];
  }));
  return nested.flat();
}

async function readVercelConfig() {
  return JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
}

test('Vercel Hobby deployment has exactly four serverless entry points', async () => {
  const functions = (await listApiFunctions(apiRoot)).sort();
  assert.equal(functions.length, 4, \`expected 4 functions, found: \${functions.join(', ')}\`);
  assert.deepEqual(functions, [
    'dispatch-notifications.js',
    'router.js',
    'whatsapp/delivery/dispatch.js',
    'whatsapp/meta/webhook.js',
  ]);
});

test('all previous public API URLs are retained through the shared router', async () => {
  const config = await readVercelConfig();
  const destinations = new Map(config.rewrites.map((rule) => [rule.source, rule.destination]));
  const expected = new Map([
    ['/api/admin-session', '/api/router?__router=admin-session'],
    ['/api/admins', '/api/router?__router=admins'],
    ['/api/device-heartbeat', '/api/router?__router=device-heartbeat'],
    ['/api/device-heartbeats', '/api/router?__router=device-heartbeat&__apiRoute=list'],
    ['/api/inventory/snapshot', '/api/router?__router=inventory-snapshot'],
    ['/api/manage-user-auth', '/api/router?__router=manage-user-auth'],
    ['/api/networks', '/api/router?__router=networks'],
    ['/api/register-network', '/api/router?__router=register-network'],
    ['/api/sales/ingest', '/api/router?__router=sales-ingest'],
    ['/api/send-fcm', '/api/router?__router=send-fcm'],
    ['/api/settings', '/api/router?__router=settings'],
    ['/api/settlement', '/api/router?__router=settlement'],
    ['/api/whatsapp/network-config', '/api/router?__router=whatsapp-network-config'],
    ['/api/whatsapp/retention/purge', '/api/router?__router=whatsapp-retention-purge'],
    ['/api/whatsapp/unknown-outcomes', '/api/router?__router=whatsapp-unknown-outcomes'],
    ['/api/template-center', '/api/router?__router=settings&__apiRoute=template-center'],
    ['/api/admin/account-features', '/api/router?__router=settings&__apiRoute=account-features'],
    ['/api/network-secret', '/api/router?__router=settings&__apiRoute=network-secret'],
    ['/api/migrate', '/api/router?__router=settings&__apiRoute=migrate'],
    ['/api/entitlements/activate', '/api/router?__router=settings&__apiRoute=entitlement-activate'],
    ['/api/entitlements/device-rebind', '/api/router?__router=settings&__apiRoute=entitlement-device-rebind'],
    ['/api/record-payment', '/api/router?__router=settlement&__apiRoute=record-payment'],
    ['/api/request-otp', '/api/router?__router=manage-user-auth&__apiRoute=request-otp'],
    ['/api/verify-otp', '/api/router?__router=manage-user-auth&__apiRoute=verify-otp'],
    ['/api/account-notifications', '/api/router?__router=manage-user-auth&__apiRoute=account-notifications'],
  ]);
  for (const [source, destination] of expected) {
    assert.equal(destinations.get(source), destination, \`\${source} must retain its public contract\`);
  }
});

test('router exposes only the approved original server handlers', () => {
  assert.deepEqual(Object.keys(API_ROUTE_HANDLERS).sort(), [
    'admin-session',
    'admins',
    'device-heartbeat',
    'inventory-snapshot',
    'manage-user-auth',
    'networks',
    'register-network',
    'sales-ingest',
    'send-fcm',
    'settings',
    'settlement',
    'whatsapp-network-config',
    'whatsapp-retention-purge',
    'whatsapp-unknown-outcomes',
  ]);
  for (const [route, handler] of Object.entries(API_ROUTE_HANDLERS)) {
    assert.equal(typeof handler, 'function', \`\${route} must be callable\`);
  }
});

test('Meta webhook, WhatsApp dispatch, and notification cron remain isolated', async () => {
  const config = await readVercelConfig();
  const webhook = await readFile(path.join(apiRoot, 'whatsapp', 'meta', 'webhook.js'), 'utf8');
  const whatsappDispatch = await readFile(path.join(apiRoot, 'whatsapp', 'delivery', 'dispatch.js'), 'utf8');
  const notificationDispatch = await readFile(path.join(apiRoot, 'dispatch-notifications.js'), 'utf8');

  assert.match(webhook, /bodyParser:\s*false/);
  assert.match(webhook, /rawBody/);
  assert.match(whatsappDispatch, /whatsappDispatchHandler/);
  assert.match(notificationDispatch, /isCronSecret/);
  assert.equal(config.crons.some((cron) => cron.path === '/api/dispatch-notifications'), true);
  assert.deepEqual(Object.keys(config.functions).sort(), [
    'api/dispatch-notifications.js',
    'api/router.js',
    'api/whatsapp/delivery/dispatch.js',
    'api/whatsapp/meta/webhook.js',
  ]);
});
