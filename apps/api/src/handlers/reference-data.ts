import type { ReferenceDataCatalog } from '@unit-talk/contracts';
import type {
  BrowseSearchResult,
  EventBrowseResult,
  EventSearchResult,
  LeagueBrowseResult,
  MatchupBrowseResult,
  PlayerSearchResult,
  ReferenceDataRepository,
  TeamSearchResult,
} from '@unit-talk/db';
import { normalizeApiError } from '../errors.js';
import type { ApiResponse } from '../http.js';
import { errorResponse, successResponse } from '../http.js';

export async function handleGetCatalog(
  repository: ReferenceDataRepository,
): Promise<ApiResponse<ReferenceDataCatalog>> {
  try {
    const catalog = await repository.getCatalog();
    return successResponse(200, catalog);
  } catch (error) {
    const apiError = normalizeApiError(error);
    return errorResponse(apiError.status, apiError.code, apiError.message);
  }
}

export async function handleSearchTeams(
  params: { sport?: string; q?: string },
  repository: ReferenceDataRepository,
): Promise<ApiResponse<TeamSearchResult[]>> {
  if (!params.sport) {
    return errorResponse(400, 'MISSING_PARAM', 'Query parameter "sport" is required');
  }
  if (!params.q || params.q.length < 2) {
    return errorResponse(400, 'QUERY_TOO_SHORT', 'Query parameter "q" must be at least 2 characters');
  }

  try {
    const results = await repository.searchTeams(params.sport, params.q);
    return successResponse(200, results);
  } catch (error) {
    const apiError = normalizeApiError(error);
    return errorResponse(apiError.status, apiError.code, apiError.message);
  }
}

export async function handleSearchPlayers(
  params: { sport?: string; q?: string },
  repository: ReferenceDataRepository,
): Promise<ApiResponse<PlayerSearchResult[]>> {
  if (!params.sport) {
    return errorResponse(400, 'MISSING_PARAM', 'Query parameter "sport" is required');
  }
  if (!params.q || params.q.length < 2) {
    return errorResponse(400, 'QUERY_TOO_SHORT', 'Query parameter "q" must be at least 2 characters');
  }

  try {
    const results = await repository.searchPlayers(params.sport, params.q);
    return successResponse(200, results);
  } catch (error) {
    const apiError = normalizeApiError(error);
    return errorResponse(apiError.status, apiError.code, apiError.message);
  }
}

export async function handleSearchBrowse(
  params: { sport?: string; date?: string; q?: string },
  repository: ReferenceDataRepository,
): Promise<ApiResponse<BrowseSearchResult[]>> {
  if (!params.sport) {
    return errorResponse(400, 'MISSING_PARAM', 'Query parameter "sport" is required');
  }
  if (!params.date) {
    return errorResponse(400, 'MISSING_PARAM', 'Query parameter "date" is required');
  }
  if (!params.q || params.q.length < 2) {
    return errorResponse(400, 'QUERY_TOO_SHORT', 'Query parameter "q" must be at least 2 characters');
  }

  try {
    const results = await repository.searchBrowse(params.sport, params.date, params.q);
    return successResponse(200, results);
  } catch (error) {
    const apiError = normalizeApiError(error);
    return errorResponse(apiError.status, apiError.code, apiError.message);
  }
}

export async function handleListLeagues(
  params: { sport?: string },
  repository: ReferenceDataRepository,
): Promise<ApiResponse<LeagueBrowseResult[]>> {
  if (!params.sport) {
    return errorResponse(400, 'MISSING_PARAM', 'Query parameter "sport" is required');
  }

  try {
    const results = await repository.listLeagues(params.sport);
    return successResponse(200, results);
  } catch (error) {
    const apiError = normalizeApiError(error);
    return errorResponse(apiError.status, apiError.code, apiError.message);
  }
}

export async function handleListMatchups(
  params: { sport?: string; date?: string },
  repository: ReferenceDataRepository,
): Promise<ApiResponse<MatchupBrowseResult[]>> {
  if (!params.sport) {
    return errorResponse(400, 'MISSING_PARAM', 'Query parameter "sport" is required');
  }
  if (!params.date) {
    return errorResponse(400, 'MISSING_PARAM', 'Query parameter "date" is required');
  }

  try {
    const results = await repository.listMatchups(params.sport, params.date);
    return successResponse(200, results);
  } catch (error) {
    const apiError = normalizeApiError(error);
    return errorResponse(apiError.status, apiError.code, apiError.message);
  }
}

export async function handleGetEventBrowse(
  params: { eventId?: string },
  repository: ReferenceDataRepository,
): Promise<ApiResponse<EventBrowseResult>> {
  if (!params.eventId) {
    return errorResponse(400, 'MISSING_PARAM', 'Route parameter "eventId" is required');
  }

  try {
    const result = await repository.getEventBrowse(params.eventId);
    if (!result) {
      return errorResponse(404, 'EVENT_NOT_FOUND', `Event not found: ${params.eventId}`);
    }
    return successResponse(200, result);
  } catch (error) {
    const apiError = normalizeApiError(error);
    return errorResponse(apiError.status, apiError.code, apiError.message);
  }
}

export async function handleListEvents(
  params: { sport?: string; date?: string },
  repository: ReferenceDataRepository,
): Promise<ApiResponse<EventSearchResult[]>> {
  if (!params.sport) {
    return errorResponse(400, 'MISSING_PARAM', 'Query parameter "sport" is required');
  }
  if (!params.date) {
    return errorResponse(400, 'MISSING_PARAM', 'Query parameter "date" is required');
  }

  try {
    const results = await repository.listEvents(params.sport, params.date);
    return successResponse(200, results);
  } catch (error) {
    const apiError = normalizeApiError(error);
    return errorResponse(apiError.status, apiError.code, apiError.message);
  }
}
