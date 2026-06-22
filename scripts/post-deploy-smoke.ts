/**
 * Post-deploy functional smoke — UTV2-991
 *
 * Validates that a deployed Unit Talk API is functionally operational beyond
 * a simple HTTP health ping. Checks: HTTP status, DB connectivity, runtime mode,
 * and queue health.
 *
 * Usage:
 *   tsx scripts/post-deploy-smoke.ts --health-url <url> [--json] [--max-retries <n>] [--retry-interval-ms <ms>]
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed or health URL unreachable
 *   2 — usage error
 */
import { pathToFileURL } from 'node:url';

type SmokeCheckResult = {
  name: string;
  passed: boolean;
  detail?: string;
};

type SmokeResult = {
  verdict: 'PASS' | 'FAIL';
  healthUrl: string;
  httpStatus: number | null;
  checks: SmokeCheckResult[];
  failure?: {
    endpoint: string;
    httpStatus: number | null;
    bodyPreview: string;
  };
  smokedAt: string;
};

type ApiHealthResponse = {
  status?: string;
  dbReachable?: boolean;
  runtimeMode?: string;
  persistenceMode?: string;
  queueHealth?: { status?: string; alerts?: unknown[] } | null;
};

type CliOptions = {
  healthUrl: string | null;
  maxRetries: number;
  retryIntervalMs: number;
  json: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { healthUrl: null, maxRetries: 3, retryIntervalMs: 5000, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--health-url') { opts.healthUrl = argv[++i] ?? null; }
    else if (a === '--max-retries') { opts.maxRetries = Number(argv[++i]) || 3; }
    else if (a === '--retry-interval-ms') { opts.retryIntervalMs = Number(argv[++i]) || 5000; }
    else if (a === '--json') { opts.json = true; }
  }
  return opts;
}

async function fetchWithRetry(
  url: string,
  maxRetries: number,
  intervalMs: number,
): Promise<{ status: number; body: unknown; bodyPreview: string } | { error: string }> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      const text = await res.text();
      const bodyPreview = previewBody(text);
      const body = parseJsonBody(text);
      return { status: res.status, body, bodyPreview };
    } catch (err: unknown) {
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, intervalMs));
      } else {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }
  }
  return { error: 'max retries exceeded' };
}

export async function runSmoke(healthUrl: string, maxRetries = 3, retryIntervalMs = 5000): Promise<SmokeResult> {
  const checks: SmokeCheckResult[] = [];
  let httpStatus: number | null = null;

  const response = await fetchWithRetry(healthUrl, maxRetries, retryIntervalMs);

  if ('error' in response) {
    checks.push({ name: 'health endpoint reachable', passed: false, detail: response.error });
    return {
      verdict: 'FAIL',
      healthUrl,
      httpStatus: null,
      checks,
      failure: {
        endpoint: healthUrl,
        httpStatus: null,
        bodyPreview: '',
      },
      smokedAt: new Date().toISOString(),
    };
  }

  httpStatus = response.status;
  const body = response.body as ApiHealthResponse | null;

  checks.push(
    response.status === 200
      ? { name: 'health endpoint HTTP 200', passed: true }
      : { name: 'health endpoint HTTP 200', passed: false, detail: `got HTTP ${response.status}` },
  );

  if (!body || typeof body !== 'object') {
    checks.push({
      name: 'health response is JSON',
      passed: false,
      detail: `endpoint=${healthUrl} status=${response.status} bodyPreview=${formatPreviewForDetail(response.bodyPreview)}`,
    });
    return buildResult(healthUrl, httpStatus, checks, {
      endpoint: healthUrl,
      httpStatus,
      bodyPreview: response.bodyPreview,
    });
  }

  checks.push({ name: 'health response is JSON', passed: true });

  checks.push(
    body.dbReachable === true
      ? { name: 'DB connectivity (dbReachable)', passed: true }
      : { name: 'DB connectivity (dbReachable)', passed: false, detail: `dbReachable=${body.dbReachable ?? 'missing'}` },
  );

  checks.push(
    body.runtimeMode === 'fail_closed'
      ? { name: 'runtimeMode is fail_closed', passed: true }
      : { name: 'runtimeMode is fail_closed', passed: false, detail: `runtimeMode="${body.runtimeMode ?? 'missing'}"` },
  );

  const apiStatus = body.status ?? '';
  checks.push(
    apiStatus !== 'down'
      ? { name: 'API status not down', passed: true }
      : { name: 'API status not down', passed: false, detail: 'API reports status=down' },
  );

  if (body.queueHealth !== undefined && body.queueHealth !== null) {
    const queueStatus = body.queueHealth.status ?? 'unknown';
    checks.push(
      queueStatus !== 'down'
        ? { name: 'queue health not down', passed: true }
        : { name: 'queue health not down', passed: false, detail: 'queueHealth.status=down' },
    );
  }

  if (body.persistenceMode !== undefined) {
    checks.push(
      body.persistenceMode === 'database'
        ? { name: 'persistenceMode is database', passed: true }
        : { name: 'persistenceMode is database', passed: false, detail: `persistenceMode="${body.persistenceMode}"` },
    );
  }

  return buildResult(healthUrl, httpStatus, checks);
}

function buildResult(
  healthUrl: string,
  httpStatus: number | null,
  checks: SmokeCheckResult[],
  failure?: SmokeResult['failure'],
): SmokeResult {
  return {
    verdict: checks.every(c => c.passed) ? 'PASS' : 'FAIL',
    healthUrl,
    httpStatus,
    checks,
    ...(failure ? { failure } : {}),
    smokedAt: new Date().toISOString(),
  };
}

function parseJsonBody(text: string): unknown {
  if (text.trim() === '') {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function previewBody(text: string): string {
  return text.slice(0, 500);
}

function formatPreviewForDetail(preview: string): string {
  return preview === '' ? '<empty>' : JSON.stringify(preview);
}

function printHumanReadable(result: SmokeResult): void {
  console.log(`Post-deploy smoke: ${result.healthUrl}`);
  console.log(`HTTP status: ${result.httpStatus ?? 'unreachable'}`);
  for (const check of result.checks) {
    const status = check.passed ? 'PASS' : 'FAIL';
    const detail = check.detail ? ` — ${check.detail}` : '';
    console.log(`  [${status}] ${check.name}${detail}`);
  }
  console.log(`\nVerdict: ${result.verdict}`);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.healthUrl) {
    process.stderr.write('usage: tsx scripts/post-deploy-smoke.ts --health-url <url> [--json] [--max-retries <n>] [--retry-interval-ms <ms>]\n');
    process.exit(2);
  }

  const result = await runSmoke(opts.healthUrl, opts.maxRetries, opts.retryIntervalMs);

  if (opts.json) {
    console.log(JSON.stringify(result));
  } else {
    printHumanReadable(result);
  }

  process.exitCode = result.verdict === 'PASS' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
