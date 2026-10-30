/**
 * Aggregate non-secret WhatsApp status for one network (admin UI).
 */
import { DELIVERY_OPS_COLLECTION } from './deliveryOperations.js';
import { QUEUE_COLLECTION } from './deliveryQueue.js';
import { NETWORK_SECRETS_COLLECTION } from './networkTokenStore.js';
import { SMS_DEVICE_TASKS_COLLECTION } from './smsDeviceTaskContract.js';
import { readNetworkWhatsappConfig } from './networkConfig.js';

export async function collectNetworkWhatsappStatus(db, networkId) {
  if (!networkId) return { ok: false, error: 'network_id_required' };

  const netSnap = await db.collection('networks').doc(networkId).get();
  if (!netSnap.exists) return { ok: false, error: 'network_not_found' };
  const config = readNetworkWhatsappConfig(netSnap.data() || {});

  let hasAccessToken = false;
  try {
    const sec = await db.collection(NETWORK_SECRETS_COLLECTION).doc(networkId).get();
    hasAccessToken = sec.exists && Boolean(sec.data()?.whatsappAccessTokenEnc);
  } catch {
    hasAccessToken = false;
  }

  const counts = {
    deliveryTotal: 0,
    sent: 0,
    delivered: 0,
    read: 0,
    failed: 0,
    smsSent: 0,
    smsUnknown: 0,
    queueQueued: 0,
    queueProcessing: 0,
    deviceTasksQueued: 0,
  };

  const scan = (pathPrefix, onRow) => {
    if (!(db._store instanceof Map)) return;
    for (const [path, data] of db._store.entries()) {
      if (path.startsWith(pathPrefix) && data) onRow(data);
    }
  };

  if (db._store instanceof Map) {
    scan(`${DELIVERY_OPS_COLLECTION}/`, (data) => {
      if (data.networkId !== networkId) return;
      counts.deliveryTotal += 1;
      if (data.status === 'sent') counts.sent += 1;
      if (data.status === 'delivered' || data.status === 'delivered_late_after_sms') counts.delivered += 1;
      if (data.status === 'read') counts.read += 1;
      if (data.status === 'failed') counts.failed += 1;
      if (data.status === 'sms_sent') counts.smsSent += 1;
      if (data.smsOutcomeUnknown) counts.smsUnknown += 1;
    });
    scan(`${QUEUE_COLLECTION}/`, (data) => {
      if (data.networkId !== networkId) return;
      if (data.status === 'queued') counts.queueQueued += 1;
      if (data.status === 'processing') counts.queueProcessing += 1;
    });
    scan(`${SMS_DEVICE_TASKS_COLLECTION}/`, (data) => {
      if (data.networkId !== networkId) return;
      if (data.status === 'queued') counts.deviceTasksQueued += 1;
    });
  } else {
    // Production: bounded queries (may need indexes)
    try {
      const ops = await db.collection(DELIVERY_OPS_COLLECTION).where('networkId', '==', networkId).limit(200).get();
      for (const doc of ops.docs || []) {
        const data = doc.data() || {};
        counts.deliveryTotal += 1;
        if (data.status === 'sent') counts.sent += 1;
        if (data.status === 'delivered' || data.status === 'delivered_late_after_sms') counts.delivered += 1;
        if (data.status === 'read') counts.read += 1;
        if (data.status === 'failed') counts.failed += 1;
        if (data.status === 'sms_sent') counts.smsSent += 1;
        if (data.smsOutcomeUnknown) counts.smsUnknown += 1;
      }
    } catch { /* index missing */ }
  }

  return {
    ok: true,
    networkId,
    cloud: {
      provider: config.whatsappPrimaryProvider,
      linkStatus: config.whatsappCloudLinkStatus,
      phoneNumberId: config.whatsappPhoneNumberId,
      wabaId: config.whatsappWabaId,
      displayHint: config.whatsappDisplayHint,
      hasAccessToken,
      // token validity cannot be known without live Meta call — report presence only
      tokenPresence: hasAccessToken ? 'sealed_present' : 'missing',
    },
    counts,
    webhook: {
      note: 'Inbound webhook path exists in code; live Meta subscription is external',
    },
  };
}
