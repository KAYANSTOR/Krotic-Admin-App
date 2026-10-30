import whatsappWebhookHandler from '../../../server/_lib/whatsapp/webhookHandler.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

/** Read raw body for signature verification when bodyParser is disabled. */
async function readRawBody(req) {
  if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks.length ? chunks : [Buffer.alloc(0)]);
}

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      const raw = await readRawBody(req);
      const rawStr = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
      let parsed = {};
      try { parsed = rawStr ? JSON.parse(rawStr) : {}; } catch { parsed = {}; }
      req.body = parsed;
      return whatsappWebhookHandler(req, res, { rawBody: rawStr });
    } catch (error) {
      console.error('whatsapp webhook read failed', error?.message);
      return res.status(400).json({ success: false, error: 'invalid_body' });
    }
  }
  return whatsappWebhookHandler(req, res);
}
