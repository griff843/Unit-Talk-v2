import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { loadEnvironment, type AppEnv } from '@unit-talk/config';
import {
  createDatabaseRepositoryBundle,
  createInMemoryRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  type RepositoryBundle,
} from '@unit-talk/db';
import {
  createLogger,
  createRequestLogFields,
  getOrCreateCorrelationId,
  type Logger,
} from '@unit-talk/observability';
import {
  handleGetCatalog,
  handleListEvents,
  handleSearchPlayers,
  handleSearchTeams,
  handleSettlePick,
  handleSubmitPick,
} from './handlers/index.js';
import { getAlertStatus, getRecentAlerts } from './alert-query-service.js';
import { requeuePickController } from './controllers/requeue-controller.js';
import { runGradingPass } from './grading-service.js';
import { postRecapSummary } from './recap-service.js';

export interface ApiServerOptions {
  repositories?: RepositoryBundle;
  runtime?: ApiRuntimeDependencies;
  environment?: AppEnv;
  logger?: Logger;
  now?: () => number;
  rateLimitStore?: ApiRateLimitStore;
}

export type ApiRuntimeMode = 'fail_open' | 'fail_closed';

export interface ApiSubmissionRateLimit {
  maxRequests: number;
  windowMs: number;
}

export interface ApiRuntimeDependencies {
  repositories: RepositoryBundle;
  persistenceMode: 'database' | 'in_memory';
  runtimeMode: ApiRuntimeMode;
  bodyLimitBytes: number;
  submissionRateLimit: ApiSubmissionRateLimit;
  logger: Logger;
  now: () => number;
  rateLimitStore: ApiRateLimitStore;
}

export interface ApiHealthResponse {
  ok: true;
  service: 'api';
  persistenceMode: ApiRuntimeDependencies['persistenceMode'];
  runtimeMode: ApiRuntimeMode;
}

export interface ApiRateLimitResult {
  exceeded: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

export interface ApiRateLimitStore {
  consume(
    key: string,
    limit: ApiSubmissionRateLimit,
    now: number,
  ): ApiRateLimitResult;
}

const DEFAULT_BODY_LIMIT_BYTES = 64 * 1024;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 10;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? '*';

export function createApiRuntimeDependencies(
  options: ApiServerOptions = {},
): ApiRuntimeDependencies {
  const environment = options.environment ?? loadEnvironment();
  const runtimeMode = readApiRuntimeMode(environment);
  const logger =
    options.logger ??
    createLogger({
      service: 'api',
      fields: { runtimeMode },
    });

  if (options.repositories) {
    return {
      repositories: options.repositories,
      persistenceMode: 'in_memory',
      runtimeMode,
      bodyLimitBytes: readBodyLimitBytes(environment),
      submissionRateLimit: readSubmissionRateLimit(environment),
      logger,
      now: options.now ?? Date.now,
      rateLimitStore: options.rateLimitStore ?? new InMemoryApiRateLimitStore(),
    };
  }

  try {
    const connection = createServiceRoleDatabaseConnectionConfig(environment);

    return {
      repositories: createDatabaseRepositoryBundle(connection),
      persistenceMode: 'database',
      runtimeMode,
      bodyLimitBytes: readBodyLimitBytes(environment),
      submissionRateLimit: readSubmissionRateLimit(environment),
      logger,
      now: options.now ?? Date.now,
      rateLimitStore: options.rateLimitStore ?? new InMemoryApiRateLimitStore(),
    };
  } catch (error) {
    if (runtimeMode === 'fail_closed') {
      throw new Error(
        'API runtime mode is fail_closed and database configuration could not be loaded.',
        { cause: error },
      );
    }

    logger.warn('falling back to in-memory api runtime', {
      persistenceMode: 'in_memory',
      reason: error instanceof Error ? error.message : String(error),
    });

    return {
      repositories: createInMemoryRepositoryBundle(),
      persistenceMode: 'in_memory',
      runtimeMode,
      bodyLimitBytes: readBodyLimitBytes(environment),
      submissionRateLimit: readSubmissionRateLimit(environment),
      logger,
      now: options.now ?? Date.now,
      rateLimitStore: options.rateLimitStore ?? new InMemoryApiRateLimitStore(),
    };
  }
}

export function createApiServer(options: ApiServerOptions = {}) {
  const runtime = options.runtime ?? createApiRuntimeDependencies(options);

  return http.createServer(async (request, response) => {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const correlationId = getOrCreateCorrelationId(request.headers);
    const requestLogger = runtime.logger.child(
      createRequestLogFields({
        correlationId,
        method,
        path: url.pathname,
        ...(request.socket.remoteAddress
          ? { remoteAddress: request.socket.remoteAddress }
          : {}),
      }),
    );
    const startedAt = runtime.now();

    response.setHeader('X-Correlation-Id', correlationId);

    try {
      await routeRequest(request, response, runtime, requestLogger);
      requestLogger.info('request completed', {
        statusCode: response.statusCode,
        durationMs: Math.max(runtime.now() - startedAt, 0),
      });
    } catch (error) {
      const failure = toApiFailure(error);

      if (!response.headersSent) {
        writeJson(response, failure.status, failure.body);
      }

      requestLogger.error('request failed', error, {
        statusCode: failure.status,
        durationMs: Math.max(runtime.now() - startedAt, 0),
      });
    }
  });
}

export async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
  requestLogger: Logger = runtime.logger,
) {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');

  if (method === 'OPTIONS') {
    setCorsHeaders(response);
    response.setHeader('Access-Control-Max-Age', '86400');
    response.statusCode = 204;
    response.end();
    return;
  }

  if (method === 'GET' && url.pathname === '/health') {
    return writeJson(response, 200, {
      ok: true,
      service: 'api',
      persistenceMode: runtime.persistenceMode,
      runtimeMode: runtime.runtimeMode,
    } satisfies ApiHealthResponse);
  }

  if (method === 'GET' && url.pathname === '/api/reference-data/catalog') {
    const apiResponse = await handleGetCatalog(runtime.repositories.referenceData);
    return writeJson(response, apiResponse.status, apiResponse.body);
  }

  if (method === 'GET' && url.pathname === '/api/reference-data/search/teams') {
    const sport = url.searchParams.get('sport');
    const q = url.searchParams.get('q');
    const apiResponse = await handleSearchTeams(
      { ...(sport ? { sport } : {}), ...(q ? { q } : {}) },
      runtime.repositories.referenceData,
    );
    return writeJson(response, apiResponse.status, apiResponse.body);
  }

  if (method === 'GET' && url.pathname === '/api/reference-data/search/players') {
    const sport = url.searchParams.get('sport');
    const q = url.searchParams.get('q');
    const apiResponse = await handleSearchPlayers(
      { ...(sport ? { sport } : {}), ...(q ? { q } : {}) },
      runtime.repositories.referenceData,
    );
    return writeJson(response, apiResponse.status, apiResponse.body);
  }

  if (method === 'GET' && url.pathname === '/api/reference-data/events') {
    const sport = url.searchParams.get('sport');
    const date = url.searchParams.get('date');
    const apiResponse = await handleListEvents(
      { ...(sport ? { sport } : {}), ...(date ? { date } : {}) },
      runtime.repositories.referenceData,
    );
    return writeJson(response, apiResponse.status, apiResponse.body);
  }

  if (method === 'GET' && url.pathname === '/api/alerts/recent') {
    const limit = readOptionalInteger(url.searchParams.get('limit'));
    const minTier = url.searchParams.get('minTier');
    const body = await getRecentAlerts(runtime.repositories.alertDetections, {
      limit,
      minTier: minTier === 'alert-worthy' ? 'alert-worthy' : 'notable',
    });
    return writeJson(response, 200, body);
  }

  if (method === 'GET' && url.pathname === '/api/alerts/status') {
    const body = await getAlertStatus(runtime.repositories.alertDetections, process.env);
    return writeJson(response, 200, body);
  }

  if (method === 'POST' && url.pathname === '/api/submissions') {
    const rateLimitResult = consumeSubmissionRateLimit(request, response, runtime);
    if (rateLimitResult.exceeded) {
      requestLogger.warn('submission rate limit exceeded', {
        limit: rateLimitResult.limit,
        remaining: rateLimitResult.remaining,
        resetAt: new Date(rateLimitResult.resetAt).toISOString(),
      });
      return writeJson(response, 429, {
        ok: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Submission rate limit exceeded. Try again shortly.',
        },
      });
    }

    const body = await readJsonBody(request, runtime.bodyLimitBytes);
    const apiResponse = await handleSubmitPick({ body }, runtime.repositories);
    return writeJson(response, apiResponse.status, apiResponse.body);
  }

  const settleMatch =
    method === 'POST'
      ? /^\/api\/picks\/([^/]+)\/settle$/.exec(url.pathname)
      : null;

  if (settleMatch) {
    const body = await readJsonBody(request, runtime.bodyLimitBytes);
    const apiResponse = await handleSettlePick(
      {
        params: {
          pickId: settleMatch[1] ?? '',
        },
        body,
      },
      runtime.repositories,
    );
    return writeJson(response, apiResponse.status, apiResponse.body);
  }

  const requeueMatch =
    method === 'POST'
      ? /^\/api\/picks\/([^/]+)\/requeue$/.exec(url.pathname)
      : null;

  if (requeueMatch) {
    const apiResponse = await requeuePickController(
      requeueMatch[1] ?? '',
      runtime.repositories,
    );
    return writeJson(response, apiResponse.status, apiResponse.body);
  }

  if (method === 'POST' && url.pathname === '/api/grading/run') {
    const result = await runGradingPass(runtime.repositories);
    return writeJson(response, 200, { ok: true, result });
  }

  if (method === 'POST' && url.pathname === '/api/recap/post') {
    const body = await readJsonBody(request, runtime.bodyLimitBytes);
    const period = body.period;
    const channel = typeof body.channel === 'string' ? body.channel : undefined;

    if (period !== 'daily' && period !== 'weekly' && period !== 'monthly') {
      return writeJson(response, 400, {
        ok: false,
        error: {
          code: 'INVALID_RECAP_PERIOD',
          message: 'period must be one of daily, weekly, or monthly',
        },
      });
    }

    const result = await postRecapSummary(period, runtime.repositories, {
      ...(channel ? { channel } : {}),
    });
    if (!result.ok) {
      return writeJson(response, 200, result);
    }

    return writeJson(response, 200, {
      ok: true,
      postsCount: result.postsCount,
      channel: result.channel,
    });
  }

  return writeJson(response, 404, {
    ok: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route not found: ${method} ${url.pathname}`,
    },
  });
}

export async function readJsonBody(
  request: IncomingMessage,
  bodyLimitBytes = DEFAULT_BODY_LIMIT_BYTES,
) {
  const declaredContentLength = Number.parseInt(request.headers['content-length'] ?? '', 10);
  if (Number.isFinite(declaredContentLength) && declaredContentLength > bodyLimitBytes) {
    throw new ApiRequestError(
      413,
      'REQUEST_BODY_TOO_LARGE',
      `Request body exceeds ${bodyLimitBytes} bytes.`,
    );
  }

  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    size += buffer.byteLength;

    if (size > bodyLimitBytes) {
      throw new ApiRequestError(
        413,
        'REQUEST_BODY_TOO_LARGE',
        `Request body exceeds ${bodyLimitBytes} bytes.`,
      );
    }

    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  const rawBody = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    throw new ApiRequestError(400, 'INVALID_JSON_BODY', 'Request body must be valid JSON.');
  }
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

function readApiRuntimeMode(environment: AppEnv): ApiRuntimeMode {
  const configured = environment.UNIT_TALK_API_RUNTIME_MODE?.trim().toLowerCase();

  if (configured === 'fail_closed') {
    return 'fail_closed';
  }

  if (configured === 'fail_open') {
    return 'fail_open';
  }

  return environment.UNIT_TALK_APP_ENV === 'local' ? 'fail_open' : 'fail_closed';
}

function readBodyLimitBytes(environment: AppEnv) {
  const parsed = Number.parseInt(environment.UNIT_TALK_API_BODY_LIMIT_BYTES ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BODY_LIMIT_BYTES;
}

function readSubmissionRateLimit(environment: AppEnv): ApiSubmissionRateLimit {
  const maxRequests = Number.parseInt(
    environment.UNIT_TALK_API_SUBMISSION_RATE_LIMIT_MAX ?? '',
    10,
  );
  const windowMs = Number.parseInt(
    environment.UNIT_TALK_API_SUBMISSION_RATE_LIMIT_WINDOW_MS ?? '',
    10,
  );

  return {
    maxRequests:
      Number.isFinite(maxRequests) && maxRequests > 0
        ? maxRequests
        : DEFAULT_RATE_LIMIT_MAX_REQUESTS,
    windowMs:
      Number.isFinite(windowMs) && windowMs > 0
        ? windowMs
        : DEFAULT_RATE_LIMIT_WINDOW_MS,
  };
}

function setCorsHeaders(response: ServerResponse) {
  response.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Correlation-Id, X-Request-Id');
}

function writeJson(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  setCorsHeaders(response);
  response.end(JSON.stringify(body));
}

function readOptionalInteger(rawValue: string | null) {
  if (!rawValue) {
    return undefined;
  }

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toApiFailure(error: unknown) {
  if (error instanceof ApiRequestError) {
    return {
      status: error.status,
      body: {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      ok: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred.',
      },
    },
  };
}

class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

class InMemoryApiRateLimitStore implements ApiRateLimitStore {
  #buckets = new Map<string, { count: number; resetAt: number }>();

  consume(key: string, limit: ApiSubmissionRateLimit, now: number): ApiRateLimitResult {
    const existing = this.#buckets.get(key);
    const bucket =
      existing && existing.resetAt > now
        ? existing
        : { count: 0, resetAt: now + limit.windowMs };

    bucket.count += 1;
    this.#buckets.set(key, bucket);

    if (bucket.resetAt <= now) {
      bucket.resetAt = now + limit.windowMs;
    }

    const exceeded = bucket.count > limit.maxRequests;

    return {
      exceeded,
      limit: limit.maxRequests,
      remaining: Math.max(limit.maxRequests - bucket.count, 0),
      resetAt: bucket.resetAt,
    };
  }
}
