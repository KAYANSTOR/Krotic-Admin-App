import whatsappWebhookHandler from '../../../server/_lib/whatsapp/webhookHandler.js';

const MAX_RAW_BODY_BYTES = 2 * 1024 * 1024;

export const config = {
  api: {
    bodyParser: false,
  },
};

/** Read raw body for signature verification when bodyParser is disabled. */
async function readRawBody(req) {
  if (typeof req.rawBody === 'string' || Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += Buffer.byteLength(chunk);
    if (totalBytes > MAX_RAW_BODY_BYTES) {
      const error = new Error('body_too_large');
      error.code = 'body_too_large';
      throw error;
    }
    chunks.push(chunk);
  }
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
      return res.status(error?.code === 'body_too_large' ? 413 : 400).json({ success: false, error: error?.code === 'body_too_large' ? 'body_too_large' : 'invalid_body' });
    }
  }
  return whatsappWebhookHandler(req, res);
}
