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

  const rateLimitResult = await consumeSubmissionRateLimit(
    request,
    body,
    response,
    runtime,
    auth,
  );
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

async function consumeSubmissionRateLimit(
  request: IncomingMessage,
  body: Record<string, unknown>,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
  auth: AuthContext | null,
) {
  const key = buildSubmissionRateLimitKey(
    request,
    body,
    runtime.submissionRateLimit.keyStrategy,
    auth,
  );
  const result = await runtime.rateLimitStore.consume(
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
 * Key strategy:
 * - authenticated_identity: trusted auth context identity, falling back to IP
 * - submitted_identity: legacy local/dev behavior using request body identity, then IP
 * - ip: client IP only
 */
function buildSubmissionRateLimitKey(
  request: IncomingMessage,
  body: Record<string, unknown>,
  strategy: ApiRuntimeDependencies['submissionRateLimit']['keyStrategy'],
  auth: AuthContext | null,
): string {
  if (strategy === 'authenticated_identity' && auth) {
    return `submission:auth:${auth.identity}`;
  }

  if (strategy === 'submitted_identity') {
    const submittedIdentity = readSubmittedIdentity(body);
    if (submittedIdentity !== null) {
      return `submission:submitted:${submittedIdentity}`;
    }
  }

  return `submission:ip:${readClientIp(request)}`;
}

function readSubmittedIdentity(body: Record<string, unknown>): string | null {
  const discordUserId =
    typeof body['discordUserId'] === 'string' && body['discordUserId'].length > 0
      ? body['discordUserId']
      : typeof body['submittedBy'] === 'string' && body['submittedBy'].length > 0
        ? body['submittedBy']
        : null;

  return discordUserId;
}

function readClientIp(request: IncomingMessage): string {
  const forwardedFor = request.headers['x-forwarded-for'];
  const clientIp =
    typeof forwardedFor === 'string'
      ? forwardedFor.split(',')[0]?.trim()
      : request.socket.remoteAddress ?? 'unknown';

  return clientIp ?? 'unknown';
}
