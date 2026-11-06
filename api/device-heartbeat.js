/**
 * POST /api/device-heartbeat  — device telemetry (server/_lib/deviceHeartbeat.js)
 * GET  /api/device-heartbeats — admin list, rewritten here with __apiRoute=list
 *
 * One implementation per concern; this file only routes.
 */
import deviceHeartbeatHandler from '../server/_lib/deviceHeartbeat.js';
import deviceHeartbeatsAdminHandler from '../server/_lib/deviceHeartbeatsApi.js';

export { validateHeartbeat } from '../server/_lib/deviceHeartbeat.js';

export default async function handler(req, res, dependencies = {}) {
  if (req.query?.__apiRoute === 'list') {
    return deviceHeartbeatsAdminHandler(req, res, dependencies);
  }
  return deviceHeartbeatHandler(req, res, dependencies);
}
