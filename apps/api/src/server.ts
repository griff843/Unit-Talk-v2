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
import { setCorsHeaders, writeJson } from './http-utils.js';
import {
  handleHealth,
  handleAlertsRecent,
  handleAlertsStatus,
  handleSubmissions,
  handleSettlePickRoute,
  handleReviewPickRoute,
  handleRequeuePick,
  handleReferenceDataCatalog,
  handleReferenceDataSearchTeams,
  handleReferenceDataSearchPlayers,
  handleReferenceDataEvents,
  handleGradingRun,
  handleRecapPost,
  handleMemberTiers,
} from './routes/index.js';

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
    return handleHealth(response, runtime);
  }

  if (method === 'GET' && url.pathname === '/api/reference-data/catalog') {
    return handleReferenceDataCatalog(request, response, runtime);
  }

  if (method === 'GET' && url.pathname === '/api/reference-data/search/teams') {
    return handleReferenceDataSearchTeams(request, response, runtime);
  }

  if (method === 'GET' && url.pathname === '/api/reference-data/search/players') {
    return handleReferenceDataSearchPlayers(request, response, runtime);
  }

  if (method === 'GET' && url.pathname === '/api/reference-data/events') {
    return handleReferenceDataEvents(request, response, runtime);
  }

  if (method === 'GET' && url.pathname === '/api/alerts/recent') {
    return handleAlertsRecent(request, response, runtime);
  }

  if (method === 'GET' && url.pathname === '/api/alerts/status') {
    return handleAlertsStatus(request, response, runtime);
  }

  if (method === 'POST' && url.pathname === '/api/submissions') {
    return handleSubmissions(request, response, runtime, requestLogger);
  }

  const settleMatch =
    method === 'POST'
      ? /^\/api\/picks\/([^/]+)\/settle$/.exec(url.pathname)
      : null;

  if (settleMatch) {
    return handleSettlePickRoute(request, response, runtime, settleMatch[1] ?? '');
  }

  const reviewMatch =
    method === 'POST'
      ? /^\/api\/picks\/([^/]+)\/review$/.exec(url.pathname)
      : null;

  if (reviewMatch) {
    return handleReviewPickRoute(request, response, runtime, reviewMatch[1] ?? '');
  }

  const requeueMatch =
    method === 'POST'
      ? /^\/api\/picks\/([^/]+)\/requeue$/.exec(url.pathname)
      : null;

  if (requeueMatch) {
    return handleRequeuePick(request, response, runtime, requeueMatch[1] ?? '');
  }

  if (method === 'POST' && url.pathname === '/api/grading/run') {
    return handleGradingRun(request, response, runtime);
  }

  if (method === 'POST' && url.pathname === '/api/recap/post') {
    return handleRecapPost(request, response, runtime);
  }

  if (method === 'POST' && url.pathname === '/api/member-tiers') {
    return handleMemberTiers(request, response, runtime);
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
  // UNIT_TALK_API_MAX_BODY_BYTES is the canonical name; UNIT_TALK_API_BODY_LIMIT_BYTES is the legacy alias.
  const raw = environment.UNIT_TALK_API_MAX_BODY_BYTES ?? environment.UNIT_TALK_API_BODY_LIMIT_BYTES ?? '';
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BODY_LIMIT_BYTES;
}

function readSubmissionRateLimit(environment: AppEnv): ApiSubmissionRateLimit {
  // UNIT_TALK_RATE_LIMIT_SUBMISSIONS_PER_MINUTE is the canonical name documented in .env.example.
  // UNIT_TALK_API_SUBMISSION_RATE_LIMIT_MAX is accepted as an alias (takes precedence when set).
  const perMinute = Number.parseInt(
    environment.UNIT_TALK_RATE_LIMIT_SUBMISSIONS_PER_MINUTE ?? '',
    10,
  );
  const maxRequestsOverride = Number.parseInt(
    environment.UNIT_TALK_API_SUBMISSION_RATE_LIMIT_MAX ?? '',
    10,
  );
  const windowMsOverride = Number.parseInt(
    environment.UNIT_TALK_API_SUBMISSION_RATE_LIMIT_WINDOW_MS ?? '',
    10,
  );

  const maxRequests = Number.isFinite(maxRequestsOverride) && maxRequestsOverride > 0
    ? maxRequestsOverride
    : Number.isFinite(perMinute) && perMinute > 0
      ? perMinute
      : DEFAULT_RATE_LIMIT_MAX_REQUESTS;

  const windowMs = Number.isFinite(windowMsOverride) && windowMsOverride > 0
    ? windowMsOverride
    : DEFAULT_RATE_LIMIT_WINDOW_MS;

  return { maxRequests, windowMs };
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
