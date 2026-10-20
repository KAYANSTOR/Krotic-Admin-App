import { createPrivateKey, sign } from 'node:crypto';

const LEASE_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export default function activateEntitlement(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'invalid_json' });
    }
  }

  const { userId, deviceId } = body && typeof body === 'object' ? body : {};
  if (typeof userId !== 'string' || !userId.trim() || userId.length > 256
      || typeof deviceId !== 'string' || !deviceId.trim() || deviceId.length > 256) {
    return res.status(400).json({ error: 'userId_and_deviceId_required' });
  }

  const configuredKey = process.env.ENTITLEMENT_PRIVATE_KEY;
  if (!configuredKey) {
    return res.status(500).json({ error: 'entitlement_signing_not_configured' });
  }

  try {
    const privateKeyPem = configuredKey.replace(/\\n/g, '\n');
    const privateKey = createPrivateKey(privateKeyPem);
    if (privateKey.asymmetricKeyType !== 'ed25519') {
      return res.status(500).json({ error: 'invalid_entitlement_signing_key' });
    }

    const now = Date.now();
    const payload = {
      userId: userId.trim(),
      deviceId: deviceId.trim(),
      serverTime: new Date(now).toISOString(),
      expiry: new Date(now + LEASE_DURATION_MS).toISOString(),
    };
    const signature = sign(null, Buffer.from(JSON.stringify(payload), 'utf8'), privateKey).toString('base64');

    return res.status(200).json({ payload, signature });
  } catch {
    console.error('entitlement signing failed');
    return res.status(500).json({ error: 'entitlement_signing_failed' });
  }
}
