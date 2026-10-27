import type { ServerResponse } from 'node:http';
import type { ApiRuntimeDependencies } from '../server.js';
import { handleGetParticipantMedia } from '../handlers/participant-media.js';
import { writeJson } from '../http-utils.js';

export async function handleParticipantMediaRoute(
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
  participantId: string,
): Promise<void> {
  const result = await handleGetParticipantMedia(participantId, runtime.repositories.participants);
  writeJson(response, result.status, result.body);
}
