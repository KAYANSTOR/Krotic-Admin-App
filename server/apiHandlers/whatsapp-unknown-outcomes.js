import whatsappUnknownOutcomeHandler from '../_lib/whatsapp/unknownOutcomeApi.js';

export default async function handler(req, res) {
  return whatsappUnknownOutcomeHandler(req, res);
}
