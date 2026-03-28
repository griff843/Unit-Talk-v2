import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseRepositoryBundle,
  createInMemoryRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  type RepositoryBundle,
} from '@unit-talk/db';
import {
  handleGetCatalog,
  handleListEvents,
  handleSearchPlayers,
  handleSearchTeams,
  handleSettlePick,
  handleSubmitPick,
} from './handlers/index.js';
import { listRecentAlertDetections } from './alert-agent-service.js';
import { requeuePickController } from './controllers/requeue-controller.js';
import { runGradingPass } from './grading-service.js';
import { postRecapSummary } from './recap-service.js';

export interface ApiServerOptions {
  repositories?: RepositoryBundle;
  runtime?: ApiRuntimeDependencies;
}

export interface ApiRuntimeDependencies {
  repositories: RepositoryBundle;
  persistenceMode: 'database' | 'in_memory';
}

export interface ApiHealthResponse {
  ok: true;
  service: 'api';
  persistenceMode: ApiRuntimeDependencies['persistenceMode'];
}

export function createApiRuntimeDependencies(
  options: ApiServerOptions = {},
): ApiRuntimeDependencies {
  if (options.repositories) {
    return {
      repositories: options.repositories,
      persistenceMode: 'in_memory',
    };
  }

  try {
    const environment = loadEnvironment();
    const connection = createServiceRoleDatabaseConnectionConfig(environment);

    return {
      repositories: createDatabaseRepositoryBundle(connection),
      persistenceMode: 'database',
    };
  } catch {
    return {
      repositories: createInMemoryRepositoryBundle(),
      persistenceMode: 'in_memory',
    };
  }
}

export function createApiServer(options: ApiServerOptions = {}) {
  const runtime = options.runtime ?? createApiRuntimeDependencies(options);

  return http.createServer(async (request, response) => {
    await routeRequest(request, response, runtime);
  });
}

const CORS_ORIGIN = process.env.CORS_ORIGIN ?? '*';

function setCorsHeaders(response: ServerResponse) {
  response.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
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

  if (method === 'GET' && url.pathname === '/api/alerts/line-movements') {
    const limitParam = url.searchParams.get('limit');

    if (limitParam !== null && !isValidPositiveInteger(limitParam)) {
      return writeJson(response, 400, {
        ok: false,
        error: {
          code: 'INVALID_ALERT_LIMIT',
          message: 'limit must be a positive integer',
        },
      });
    }

    const alerts = await listRecentAlertDetections(runtime.repositories, {
      ...(limitParam ? { limit: Number.parseInt(limitParam, 10) } : {}),
    });

    return writeJson(response, 200, {
      ok: true,
      data: {
        alerts,
      },
    });
  }

  if (method === 'POST' && url.pathname === '/api/submissions') {
    const body = await readJsonBody(request);
    const apiResponse = await handleSubmitPick({ body }, runtime.repositories);
    return writeJson(response, apiResponse.status, apiResponse.body);
  }

  const settleMatch =
    method === 'POST'
      ? /^\/api\/picks\/([^/]+)\/settle$/.exec(url.pathname)
      : null;

  if (settleMatch) {
    const body = await readJsonBody(request);
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
    const body = await readJsonBody(request);
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

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const rawBody = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    throw new Error('Request body must be valid JSON');
  }
}

function writeJson(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  setCorsHeaders(response);
  response.end(JSON.stringify(body));
}

function isValidPositiveInteger(raw: string) {
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0;
}
