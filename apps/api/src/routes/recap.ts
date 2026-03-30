import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiRuntimeDependencies } from '../server.js';
import { postRecapSummary } from '../recap-service.js';
import { readJsonBody } from '../server.js';
import { writeJson } from '../http-utils.js';

export async function handleRecapPost(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
): Promise<void> {
  const body = await readJsonBody(request, runtime.bodyLimitBytes);
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

  const result = await postRecapSummary(period, runtime.repositories, {
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
