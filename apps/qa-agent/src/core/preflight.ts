import type { QAPreflightCheck, QAPreflightContext, QAPreflightResult } from './types.js';

export async function runPreflightChecks(
  checks: readonly QAPreflightCheck[] | undefined,
  context: QAPreflightContext,
  skipPreflight: boolean,
): Promise<QAPreflightResult[]> {
  if (!checks || checks.length === 0) return [];
  if (skipPreflight) {
    return checks.map((check) => ({
      id: check.id,
      status: 'skipped',
      required: check.required,
      message: 'Skipped by --skip-preflight.',
    }));
  }

  const results: QAPreflightResult[] = [];
  for (const check of checks) {
    try {
      const result = await check.run(context);
      results.push({ ...result, id: check.id, required: check.required });
    } catch (error) {
      results.push({
        id: check.id,
        status: 'failed',
        required: check.required,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

export async function fetchStatus(url: string, timeoutMs = 8_000): Promise<{
  url: string;
  status: number;
  location?: string | null;
  error?: string;
}> {
  try {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return {
      url,
      status: response.status,
      location: response.headers.get('location'),
    };
  } catch (error) {
    return {
      url,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function httpPreflight(
  id: string,
  url: string,
  label: string,
  required: boolean,
): Promise<QAPreflightResult> {
  const evidence = await fetchStatus(url);
  if (evidence.error) {
    return {
      id,
      status: 'failed',
      required,
      message: `${label} unavailable: ${evidence.error}.`,
      evidence,
    };
  }
  if (evidence.status >= 500) {
    return {
      id,
      status: 'failed',
      required,
      message: `${label} returned HTTP ${evidence.status}.`,
      evidence,
    };
  }
  return {
    id,
    status: 'passed',
    required,
    message: `${label} returned HTTP ${evidence.status}.`,
    evidence,
  };
}
