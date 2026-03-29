import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiRouteDependencies } from '../server.js';
import { writeJson, readJsonBody } from '../http-utils.js';
import { postRecapSummary } from '../recap-service.js';

export async function handleRecapPostRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: ApiRouteDependencies,
): Promise<void> {
  const body = await readJsonBody(request, deps.bodyLimitBytes);
  const period = body.period;
  const channel = typeof body.channel === 'string' ? body.channel : undefined;

  if (period !== 'daily' && period !== 'weekly' && period !== 'monthly') {
    writeJson(response, 400, {
      ok: false,
      error: {
        code: 'INVALID_RECAP_PERIOD',
        message: 'period must be one of daily, weekly, or monthly',
      },
    });
    return;
  }

  const result = await postRecapSummary(period, deps.repositories, {
    ...(channel ? { channel } : {}),
  });
  if (!result.ok) {
    writeJson(response, 200, result);
    return;
  }

  writeJson(response, 200, {
    ok: true,
    postsCount: result.postsCount,
    channel: result.channel,
  });
}
