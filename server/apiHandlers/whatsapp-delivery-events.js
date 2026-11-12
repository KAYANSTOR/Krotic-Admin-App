// ============================================================
// Routed via api/router.js (__router=whatsapp-delivery-events):
//   POST /api/whatsapp/delivery-events          — Railway → Vercel signed delivery events (contract §5.3)
//   GET  /api/admin/whatsapp-deliveries         — admin delivery report (§4.4, §9)  (__apiRoute=admin)
// ============================================================

import { adminDeliveriesHandler, deliveryEventsHandler } from '../_lib/whatsappDeliveryApi.js';

export default async function handler(req, res, dependencies = {}) {
  const v = req.query?.__apiRoute;
  const route = Array.isArray(v) ? v[0] : v;
  if (route === 'admin') return adminDeliveriesHandler(req, res, dependencies);
  if (route == null || route === 'events') return deliveryEventsHandler(req, res, dependencies);
  return res.status(404).json({ success: false, error: 'api_route_not_found' });
}
