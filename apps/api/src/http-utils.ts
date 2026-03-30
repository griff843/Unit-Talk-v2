import type { ServerResponse } from 'node:http';

const CORS_ORIGIN = process.env.CORS_ORIGIN ?? '*';

export function setCorsHeaders(response: ServerResponse) {
  response.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, X-Correlation-Id, X-Request-Id',
  );
}

export function writeJson(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  setCorsHeaders(response);
  response.end(JSON.stringify(body));
}

export function readOptionalInteger(rawValue: string | null) {
  if (!rawValue) {
    return undefined;
  }

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
