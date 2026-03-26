/**
 * Typed API client for apps/api.
 *
 * All command handlers receive an ApiClient - they do not construct raw
 * fetch() calls inline. This ensures the base URL, timeout, and error
 * handling are consistent and testable across all commands.
 *
 * Boundary rules (enforced here, not just in docs):
 *   - DB access is prohibited - no Supabase imports, no direct DB calls
 *   - All mutations go through POST /api/submissions or other ratified routes
 *   - Override authority (applyPromotionOverride) is prohibited from the bot
 */
export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
}

export type FetchImpl = typeof fetch;

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

/**
 * Creates an ApiClient bound to the given base URL.
 * Accepts an optional fetchImpl for testing (defaults to global fetch).
 */
export function createApiClient(baseUrl: string, fetchImpl: FetchImpl = fetch): ApiClient {
  const normalizedBase = baseUrl.replace(/\/$/u, '');

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${normalizedBase}${path}`;
    const resp = await fetchImpl(url, init);

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      const detail = text ? ` — ${text}` : "";
      throw new ApiClientError(
        `API request failed: ${init?.method ?? "GET"} ${path} => ${resp.status}${detail}`,
        resp.status,
        text || undefined,
      );
    }

    return resp.json() as Promise<T>;
  }

  return {
    get<T>(path: string): Promise<T> {
      return request<T>(path);
    },
    post<T>(path: string, body: unknown): Promise<T> {
      return request<T>(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
  };
}
