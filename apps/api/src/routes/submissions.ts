import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiRuntimeDependencies } from '../server.js';
import { handleSubmitPick } from '../handlers/index.js';
import { readJsonBody } from '../server.js';
import { writeJson } from '../http-utils.js';
import type { Logger } from '@unit-talk/observability';

export async function handleSubmissions(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
  requestLogger: Logger,
): Promise<void> {
  const rateLimitResult = consumeSubmissionRateLimit(request, response, runtime);
  if (rateLimitResult.exceeded) {
    requestLogger.warn('submission rate limit exceeded', {
      limit: rateLimitResult.limit,
      remaining: rateLimitResult.remaining,
      resetAt: new Date(rateLimitResult.resetAt).toISOString(),
    });
    writeJson(response, 429, {
      ok: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Submission rate limit exceeded. Try again shortly.',
      },
    });
    return;
  }

  const body = await readJsonBody(request, runtime.bodyLimitBytes);
  const apiResponse = await handleSubmitPick({ body }, runtime.repositories);
  writeJson(response, apiResponse.status, apiResponse.body);
}

function consumeSubmissionRateLimit(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
) {
  const key = buildSubmissionRateLimitKey(request);
  const result = runtime.rateLimitStore.consume(
    key,
    runtime.submissionRateLimit,
    runtime.now(),
  );

  response.setHeader('X-RateLimit-Limit', String(result.limit));
  response.setHeader('X-RateLimit-Remaining', String(result.remaining));
  response.setHeader('X-RateLimit-Reset', new Date(result.resetAt).toISOString());

  if (result.exceeded) {
    response.setHeader(
      'Retry-After',
      String(Math.max(Math.ceil((result.resetAt - runtime.now()) / 1000), 0)),
    );
  }

  return result;
}

function buildSubmissionRateLimitKey(request: IncomingMessage) {
  const forwardedFor = request.headers['x-forwarded-for'];
  const clientId =
    typeof forwardedFor === 'string'
      ? forwardedFor.split(',')[0]?.trim()
      : request.socket.remoteAddress ?? 'unknown';

  return `submission:${clientId ?? 'unknown'}`;
}
