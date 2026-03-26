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

export function createApiClient(baseUrl: string, fetchImpl: FetchImpl = fetch): ApiClient {
  const normalizedBase = baseUrl.replace(/\/$/u, '');

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetchImpl(`${normalizedBase}${path}`, init);
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ApiClientError(
        `API request failed: ${init?.method ?? 'GET'} ${path} => ${response.status}`,
        response.status,
        detail || undefined,
      );
    }

    return response.json() as Promise<T>;
  }

  return {
    get<T>(path: string) {
      return request<T>(path);
    },
    post<T>(path: string, body: unknown) {
      return request<T>(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
  };
}
