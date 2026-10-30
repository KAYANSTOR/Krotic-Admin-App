import whatsappDispatchHandler from '../../../server/_lib/whatsapp/dispatchHandler.js';

export default async function handler(req, res) {
  return whatsappDispatchHandler(req, res);
}
