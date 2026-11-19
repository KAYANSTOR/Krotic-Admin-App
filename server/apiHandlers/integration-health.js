import crypto from 'node:crypto';

export default function integrationHealth(req, res) {
  if (req.method === 'GET') return res.status(200).json({ ok: true, service: 'krotic-admin', capabilities: ['health', 'capabilities', 'revalidate'], timestamp: new Date().toISOString() });
  if (req.method !== 'POST') return res.status(405).setHeader('Allow', 'GET, POST').json({ error: 'method_not_allowed' });
  const secret = process.env.HUB_INTEGRATION_SECRET;
  const signature = req.headers['x-hub-signature'];
  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  const expected = secret ? crypto.createHmac('sha256', secret).update(raw).digest('hex') : '';
  const valid = Boolean(secret) && typeof signature === 'string' && signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) return res.status(401).json({ error: 'invalid_hub_signature' });
  if (req.body?.command !== 'revalidate') return res.status(400).json({ error: 'unsupported_command' });
  return res.status(202).json({ ok: true, accepted: true, command: 'revalidate', timestamp: new Date().toISOString() });
}
