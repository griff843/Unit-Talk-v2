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
  getPicksByStatus?(statuses: string[], limit?: number): Promise<PicksQueryResponse>;
  getRecentSettlements?(limit?: number): Promise<SettlementsRecentResponse>;
  getRecentAlerts?(
    limit?: number,
    minTier?: 'notable' | 'alert-worthy',
  ): Promise<AlertsRecentResponse>;
  getAlertStatus?(): Promise<AlertStatusResponse>;
  syncMemberTier?(params: {
    discord_id: string;
    tier: string;
    action: 'activate' | 'deactivate';
    source: 'discord-role';
  }): Promise<void>;
}

export type FetchImpl = typeof fetch;

export interface AlertsRecentResponse {
  detections: Array<{
    id: string;
    eventId: string;
    marketKey: string;
    bookmakerKey: string;
    marketType: 'spread' | 'total' | 'moneyline' | 'player_prop';
    direction: 'up' | 'down';
    tier: 'notable' | 'alert-worthy';
    oldLine: number;
    newLine: number;
    lineChange: number;
    lineChangeAbs: number;
    velocity: number | null;
    timeElapsedMinutes: number;
    currentSnapshotAt: string;
    notified: boolean;
    cooldownExpiresAt: string | null;
  }>;
  total: number;
}

export interface AlertStatusResponse {
  enabled: boolean;
  dryRun: boolean;
  minTier: string;
  lookbackMinutes: number;
  last1h: {
    notable: number;
    alertWorthy: number;
    notified: number;
  };
  lastDetectedAt: string | null;
}

export interface PicksQueryResponse {
  picks: QueriedPick[];
  count: number;
}

export interface QueriedPick {
  id: string;
  market: string;
  selection: string;
  odds: number | null;
  stake_units: number | null;
  status: string;
  source: string;
  created_at: string;
  promotion_status: string;
  promotion_target: string | null;
  metadata: Record<string, unknown> | null;
}

export interface SettlementsRecentResponse {
  settlements: RecentSettlement[];
  count: number;
}

export interface RecentSettlement {
  id: string;
  pick_id: string;
  status: string;
  result: string | null;
  settled_at: string;
  created_at: string;
  payload: Record<string, unknown> | null;
}

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
    getRecentAlerts(
      limit = 5,
      minTier: 'notable' | 'alert-worthy' = 'notable',
    ): Promise<AlertsRecentResponse> {
      const params = new URLSearchParams({
        limit: String(limit),
        minTier,
      });
      return request<AlertsRecentResponse>(`/api/alerts/recent?${params.toString()}`);
    },
    getAlertStatus(): Promise<AlertStatusResponse> {
      return request<AlertStatusResponse>('/api/alerts/status');
    },
    getPicksByStatus(
      statuses: string[],
      limit = 50,
    ): Promise<PicksQueryResponse> {
      const params = new URLSearchParams({
        status: statuses.join(','),
        limit: String(limit),
      });
      return request<PicksQueryResponse>(`/api/picks?${params.toString()}`);
    },
    getRecentSettlements(limit = 50): Promise<SettlementsRecentResponse> {
      const params = new URLSearchParams({
        limit: String(limit),
      });
      return request<SettlementsRecentResponse>(`/api/settlements/recent?${params.toString()}`);
    },
    async syncMemberTier(params: {
      discord_id: string;
      tier: string;
      action: 'activate' | 'deactivate';
      source: 'discord-role';
    }): Promise<void> {
      try {
        await request<unknown>('/api/member-tiers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        });
      } catch (err) {
        console.warn(
          '[api-client] syncMemberTier failed (swallowed):',
          err instanceof Error ? err.message : String(err),
        );
      }
    },
  };
}
