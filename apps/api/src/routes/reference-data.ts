import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiRouteDependencies } from '../server.js';
import { writeJson, readOptionalInteger } from '../http-utils.js';
import {
  handleGetCatalog,
  handleListEvents,
  handleSearchPlayers,
  handleSearchTeams,
} from '../handlers/index.js';

export async function handleReferenceDataCatalogRequest(
  _request: IncomingMessage,
  response: ServerResponse,
  deps: ApiRouteDependencies,
): Promise<void> {
  const apiResponse = await handleGetCatalog(deps.repositories.referenceData);
  writeJson(response, apiResponse.status, apiResponse.body);
}

export async function handleReferenceDataSearchTeamsRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: ApiRouteDependencies,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const sport = url.searchParams.get('sport');
  const q = url.searchParams.get('q');
  const apiResponse = await handleSearchTeams(
    { ...(sport ? { sport } : {}), ...(q ? { q } : {}) },
    deps.repositories.referenceData,
  );
  writeJson(response, apiResponse.status, apiResponse.body);
}

export async function handleReferenceDataSearchPlayersRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: ApiRouteDependencies,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const sport = url.searchParams.get('sport');
  const q = url.searchParams.get('q');
  const apiResponse = await handleSearchPlayers(
    { ...(sport ? { sport } : {}), ...(q ? { q } : {}) },
    deps.repositories.referenceData,
  );
  writeJson(response, apiResponse.status, apiResponse.body);
}

export async function handleReferenceDataListEventsRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: ApiRouteDependencies,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const sport = url.searchParams.get('sport');
  const date = url.searchParams.get('date');
  const apiResponse = await handleListEvents(
    { ...(sport ? { sport } : {}), ...(date ? { date } : {}) },
    deps.repositories.referenceData,
  );
  writeJson(response, apiResponse.status, apiResponse.body);
}

// re-export readOptionalInteger to avoid circular deps
export { readOptionalInteger };
