import whatsappNetworkConfigHandler from '../_lib/whatsapp/networkConfigApi.js';

export default async function handler(req, res) {
  return whatsappNetworkConfigHandler(req, res);
}
