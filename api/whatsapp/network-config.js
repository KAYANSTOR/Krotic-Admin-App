import whatsappNetworkConfigHandler from '../../server/_lib/whatsapp/networkConfigApi.js';

export default async function handler(req, res) {
  return whatsappNetworkConfigHandler(req, res);
}
