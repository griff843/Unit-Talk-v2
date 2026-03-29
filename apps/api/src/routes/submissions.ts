import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiRateLimitStore, ApiRouteDependencies, ApiSubmissionRateLimit } from '../server.js';
import { writeJson, readJsonBody } from '../http-utils.js';
import { handleSubmitPick } from '../handlers/index.js';

export async function handleSubmissionsRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: ApiRouteDependencies,
): Promise<void> {
  const rateLimitResult = consumeSubmissionRateLimit(request, response, deps);
  if (rateLimitResult.exceeded) {
    deps.requestLogger.warn('submission rate limit exceeded', {
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

  const body = await readJsonBody(request, deps.bodyLimitBytes);
  const apiResponse = await handleSubmitPick({ body }, deps.repositories);
  writeJson(response, apiResponse.status, apiResponse.body);
}

function consumeSubmissionRateLimit(
  request: IncomingMessage,
  response: ServerResponse,
  deps: { rateLimitStore: ApiRateLimitStore; submissionRateLimit: ApiSubmissionRateLimit; now: () => number },
) {
  const key = buildSubmissionRateLimitKey(request);
  const result = deps.rateLimitStore.consume(
    key,
    deps.submissionRateLimit,
    deps.now(),
  );

  response.setHeader('X-RateLimit-Limit', String(result.limit));
  response.setHeader('X-RateLimit-Remaining', String(result.remaining));
  response.setHeader('X-RateLimit-Reset', new Date(result.resetAt).toISOString());

  if (result.exceeded) {
    response.setHeader(
      'Retry-After',
      String(Math.max(Math.ceil((result.resetAt - deps.now()) / 1000), 0)),
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
