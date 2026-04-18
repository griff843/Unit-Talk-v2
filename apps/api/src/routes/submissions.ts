import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiRuntimeDependencies } from '../server.js';
import { handleSubmitPick } from '../handlers/index.js';
import { readJsonBody } from '../server.js';
import { writeJson } from '../http-utils.js';
import type { AuthContext } from '../auth.js';
import type { Logger } from '@unit-talk/observability';

export async function handleSubmissions(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
  requestLogger: Logger,
  auth: AuthContext | null = null,
): Promise<void> {
  // Read body first so we can key the rate limiter by Discord user ID when present.
  const body = await readJsonBody(request, runtime.bodyLimitBytes);

  const rateLimitResult = consumeSubmissionRateLimit(request, body, response, runtime);
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

  const apiResponse = await handleSubmitPick({ body, auth }, runtime.repositories);
  writeJson(response, apiResponse.status, apiResponse.body);
}

function consumeSubmissionRateLimit(
  request: IncomingMessage,
  body: Record<string, unknown>,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
) {
  const key = buildSubmissionRateLimitKey(request, body);
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

/**
 * Build the rate-limit key for a submission request.
 *
 * Priority order:
 * 1. `discordUserId` field in the request body (explicit Discord user ID)
 * 2. `submittedBy` field in the request body (capper identity)
 * 3. `x-forwarded-for` header first IP segment (proxy/CDN-forwarded client IP)
 * 4. socket remote address
 * 5. fallback: "unknown"
 */
function buildSubmissionRateLimitKey(
  request: IncomingMessage,
  body: Record<string, unknown>,
): string {
  // Prefer Discord user identity from body so each Discord user gets their own bucket
  // regardless of which IP they're coming from.
  const discordUserId =
    typeof body['discordUserId'] === 'string' && body['discordUserId'].length > 0
      ? body['discordUserId']
      : typeof body['submittedBy'] === 'string' && body['submittedBy'].length > 0
        ? body['submittedBy']
        : null;

  if (discordUserId !== null) {
    return `submission:discord:${discordUserId}`;
  }

  // Fall back to IP address.
  const forwardedFor = request.headers['x-forwarded-for'];
  const clientIp =
    typeof forwardedFor === 'string'
      ? forwardedFor.split(',')[0]?.trim()
      : request.socket.remoteAddress ?? 'unknown';

  return `submission:ip:${clientIp ?? 'unknown'}`;
}
