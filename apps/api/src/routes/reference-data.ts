import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiRuntimeDependencies } from '../server.js';
import {
  handleGetCatalog,
  handleListEvents,
  handleSearchPlayers,
  handleSearchTeams,
} from '../handlers/index.js';
import { writeJson } from '../http-utils.js';

export async function handleReferenceDataCatalog(
  _request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
): Promise<void> {
  const apiResponse = await handleGetCatalog(runtime.repositories.referenceData);
  writeJson(response, apiResponse.status, apiResponse.body);
}

export async function handleReferenceDataSearchTeams(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const sport = url.searchParams.get('sport');
  const q = url.searchParams.get('q');
  const apiResponse = await handleSearchTeams(
    { ...(sport ? { sport } : {}), ...(q ? { q } : {}) },
    runtime.repositories.referenceData,
  );
  writeJson(response, apiResponse.status, apiResponse.body);
}

export async function handleReferenceDataSearchPlayers(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const sport = url.searchParams.get('sport');
  const q = url.searchParams.get('q');
  const apiResponse = await handleSearchPlayers(
    { ...(sport ? { sport } : {}), ...(q ? { q } : {}) },
    runtime.repositories.referenceData,
  );
  writeJson(response, apiResponse.status, apiResponse.body);
}

export async function handleReferenceDataEvents(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const sport = url.searchParams.get('sport');
  const date = url.searchParams.get('date');
  const apiResponse = await handleListEvents(
    { ...(sport ? { sport } : {}), ...(date ? { date } : {}) },
    runtime.repositories.referenceData,
  );
  writeJson(response, apiResponse.status, apiResponse.body);
}
