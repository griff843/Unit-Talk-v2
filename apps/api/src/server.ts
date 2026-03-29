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
import { setCorsHeaders, writeJson, toApiFailure } from './http-utils.js';
import { handleHealthRequest } from './routes/health.js';
import {
  handleReferenceDataCatalogRequest,
  handleReferenceDataListEventsRequest,
  handleReferenceDataSearchPlayersRequest,
  handleReferenceDataSearchTeamsRequest,
} from './routes/reference-data.js';
import { handleAlertsRecentRequest, handleAlertsStatusRequest } from './routes/alerts.js';
import { handleSubmissionsRequest } from './routes/submissions.js';
import { handleSettlementsRequest } from './routes/settlements.js';
import { handleRequeueRequest } from './routes/requeue.js';
import { handleGradingRequest } from './routes/grading.js';
import { handleRecapPostRequest } from './routes/recap.js';

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

export interface ApiRouteDependencies extends ApiRuntimeDependencies {
  requestLogger: Logger;
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
  const deps: ApiRouteDependencies = { ...runtime, requestLogger };

  if (method === 'OPTIONS') {
    setCorsHeaders(response);
    response.setHeader('Access-Control-Max-Age', '86400');
    response.statusCode = 204;
    response.end();
    return;
  }

  if (method === 'GET' && url.pathname === '/health') {
    return handleHealthRequest(request, response, deps);
  }

  if (method === 'GET' && url.pathname === '/api/reference-data/catalog') {
    return handleReferenceDataCatalogRequest(request, response, deps);
  }

  if (method === 'GET' && url.pathname === '/api/reference-data/search/teams') {
    return handleReferenceDataSearchTeamsRequest(request, response, deps);
  }

  if (method === 'GET' && url.pathname === '/api/reference-data/search/players') {
    return handleReferenceDataSearchPlayersRequest(request, response, deps);
  }

  if (method === 'GET' && url.pathname === '/api/reference-data/events') {
    return handleReferenceDataListEventsRequest(request, response, deps);
  }

  if (method === 'GET' && url.pathname === '/api/alerts/recent') {
    return handleAlertsRecentRequest(request, response, deps);
  }

  if (method === 'GET' && url.pathname === '/api/alerts/status') {
    return handleAlertsStatusRequest(request, response, deps);
  }

  if (method === 'POST' && url.pathname === '/api/submissions') {
    return handleSubmissionsRequest(request, response, deps);
  }

  const settleMatch =
    method === 'POST'
      ? /^\/api\/picks\/([^/]+)\/settle$/.exec(url.pathname)
      : null;

  if (settleMatch) {
    return handleSettlementsRequest(request, response, deps, settleMatch[1] ?? '');
  }

  const requeueMatch =
    method === 'POST'
      ? /^\/api\/picks\/([^/]+)\/requeue$/.exec(url.pathname)
      : null;

  if (requeueMatch) {
    return handleRequeueRequest(request, response, deps, requeueMatch[1] ?? '');
  }

  if (method === 'POST' && url.pathname === '/api/grading/run') {
    return handleGradingRequest(request, response, deps);
  }

  if (method === 'POST' && url.pathname === '/api/recap/post') {
    return handleRecapPostRequest(request, response, deps);
  }

  writeJson(response, 404, {
    ok: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route not found: ${method} ${url.pathname}`,
    },
  });
}

// Keep readJsonBody exported from server.ts for backward compatibility (tests use it)
export { readJsonBody } from './http-utils.js';

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
