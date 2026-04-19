import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OperatorRouteDependencies } from '../server.js';
import { writeJson } from '../http-utils.js';

export async function handleRoutingPreviewRequest(
  _request: IncomingMessage,
  response: ServerResponse,
  _deps: OperatorRouteDependencies,
  pickId: string,
): Promise<void> {
  return proxyPreview(response, `/api/picks/${encodeURIComponent(pickId)}/routing-preview`);
}

async function proxyPreview(response: ServerResponse, path: string): Promise<void> {
  try {
    const upstream = await fetch(`${resolveApiBaseUrl()}${path}`, { cache: 'no-store' });
    const payload = await upstream.json() as unknown;
    writeJson(response, upstream.status, payload);
  } catch (error) {
    writeJson(response, 502, {
      ok: false,
      error: {
        code: 'UPSTREAM_UNAVAILABLE',
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

function resolveApiBaseUrl() {
  return process.env.UNIT_TALK_API_URL?.trim() || process.env.API_BASE_URL?.trim() || 'http://localhost:4000';
}
