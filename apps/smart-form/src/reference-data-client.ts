/**
 * Smart Form — Reference Data Client
 *
 * Single import point for reference data in the smart form.
 * Fetches from API with 5-minute cache, falls back to static V1_REFERENCE_DATA.
 */

export {
  V1_REFERENCE_DATA,
  getSportById,
  getStatTypesForSport,
  getTeamsForSport,
  getMarketTypesForSport,
  getEnabledTicketTypes,
  isValidCapper,
  isValidSportsbook,
  isValidSportId,
  isValidTeamForSport,
  isValidStatTypeForSport,
  type ReferenceDataCatalog,
  type SportDefinition,
  type SportsbookDefinition,
  type TicketTypeDefinition,
  type MarketTypeId,
} from '@unit-talk/contracts';

import { V1_REFERENCE_DATA, type ReferenceDataCatalog } from '@unit-talk/contracts';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let cachedCatalog: ReferenceDataCatalog | undefined;
let cachedAt = 0;

export interface ReferenceDataClientOptions {
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
}

let clientOptions: ReferenceDataClientOptions | undefined;

export function configureReferenceDataClient(options: ReferenceDataClientOptions): void {
  clientOptions = options;
  cachedCatalog = undefined;
  cachedAt = 0;
}

export async function getFormReferenceData(): Promise<ReferenceDataCatalog> {
  const now = Date.now();
  if (cachedCatalog && now - cachedAt < CACHE_TTL_MS) {
    return cachedCatalog;
  }

  if (!clientOptions) {
    return V1_REFERENCE_DATA;
  }

  try {
    const response = await clientOptions.fetchImpl(
      `${clientOptions.apiBaseUrl}/api/reference-data/catalog`,
      { headers: { accept: 'application/json' } },
    );

    if (!response.ok) {
      return cachedCatalog ?? V1_REFERENCE_DATA;
    }

    const body = (await response.json()) as { ok: boolean; data?: ReferenceDataCatalog };
    if (body.ok && body.data && isValidCatalogShape(body.data)) {
      cachedCatalog = body.data;
      cachedAt = now;
      return cachedCatalog;
    }
  } catch {
    // API unreachable — use cache or static fallback
  }

  return cachedCatalog ?? V1_REFERENCE_DATA;
}

export function getFormReferenceDataSync(): ReferenceDataCatalog {
  return cachedCatalog ?? V1_REFERENCE_DATA;
}

export function resetReferenceDataCache(): void {
  cachedCatalog = undefined;
  cachedAt = 0;
  clientOptions = undefined;
}

function isValidCatalogShape(data: unknown): data is ReferenceDataCatalog {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  return Array.isArray(obj.sports) && Array.isArray(obj.sportsbooks) && Array.isArray(obj.cappers);
}
