import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiRuntimeDependencies } from '../server.js';
import { getAlertStatus, getRecentAlerts } from '../alert-query-service.js';
import { writeJson, readOptionalInteger } from '../http-utils.js';

export async function handleAlertsRecent(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const limit = readOptionalInteger(url.searchParams.get('limit'));
  const minTier = url.searchParams.get('minTier');
  const body = await getRecentAlerts(runtime.repositories.alertDetections, {
    limit,
    minTier: minTier === 'alert-worthy' ? 'alert-worthy' : 'notable',
  });
  writeJson(response, 200, body);
}

export async function handleAlertsStatus(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
): Promise<void> {
  const body = await getAlertStatus(runtime.repositories.alertDetections, process.env);
  writeJson(response, 200, body);
}
