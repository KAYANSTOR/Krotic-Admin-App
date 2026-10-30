import whatsappRetentionPurgeHandler from '../../../server/_lib/whatsapp/retentionPurgeHandler.js';

export default async function handler(req, res) {
  return whatsappRetentionPurgeHandler(req, res);
}
