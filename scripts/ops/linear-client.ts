/**
 * Shared thin Linear GraphQL client for ops scripts.
 *
 * No dependency on @unit-talk/config — callers pass the token explicitly so
 * this module can be imported without triggering environment validation.
 *
 * Used by: stale-lane-alerter, daily-digest
 */

const LINEAR_ENDPOINT = 'https://api.linear.app/graphql';
const DEFAULT_TIMEOUT_MS = 10_000;

export interface LinearQueryOptions {
  token: string;
  userAgent?: string;
  timeoutMs?: number;
}

export interface LinearQueryResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

/**
 * Execute a raw Linear GraphQL query.
 * Returns `{ ok: false, error }` on any failure — never throws.
 */
export async function linearQuery<T>(
  query: string,
  variables: Record<string, unknown> = {},
  options: LinearQueryOptions,
): Promise<LinearQueryResult<T>> {
  const {
    token,
    userAgent = 'unit-talk-ops',
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  if (!token) {
    return { ok: false, error: 'LINEAR_API_TOKEN not set' };
  }

  try {
    const response = await fetch(LINEAR_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
        'User-Agent': userAgent,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      return { ok: false, error: `Linear HTTP ${response.status} ${response.statusText}` };
    }

    const payload = (await response.json()) as {
      data?: T;
      errors?: Array<{ message?: string }>;
    };

    if (payload.errors?.length) {
      return {
        ok: false,
        error: payload.errors.map((e) => e.message ?? 'unknown').join('; '),
      };
    }

    if (!payload.data) {
      return { ok: false, error: 'Linear returned no data' };
    }

    return { ok: true, data: payload.data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
