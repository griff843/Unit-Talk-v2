import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiRouteDependencies } from '../server.js';
import { writeJson, readOptionalInteger } from '../http-utils.js';
import { getAlertStatus, getRecentAlerts } from '../alert-query-service.js';

export async function handleAlertsRecentRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: ApiRouteDependencies,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const limit = readOptionalInteger(url.searchParams.get('limit'));
  const minTier = url.searchParams.get('minTier');
  const body = await getRecentAlerts(deps.repositories.alertDetections, {
    limit,
    minTier: minTier === 'alert-worthy' ? 'alert-worthy' : 'notable',
  });
  writeJson(response, 200, body);
}

export async function handleAlertsStatusRequest(
  _request: IncomingMessage,
  response: ServerResponse,
  deps: ApiRouteDependencies,
): Promise<void> {
  const body = await getAlertStatus(deps.repositories.alertDetections, process.env);
  writeJson(response, 200, body);
}
