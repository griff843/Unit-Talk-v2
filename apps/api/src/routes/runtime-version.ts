import type { IncomingMessage, ServerResponse } from 'node:http';
import { authenticateRequest } from '../auth.js';
import { writeJson } from '../http-utils.js';
import type { ApiRuntimeDependencies } from '../server.js';

export interface ApiRuntimeVersionResponse {
  service: 'api';
  persistenceMode: ApiRuntimeDependencies['persistenceMode'];
  runtimeMode: ApiRuntimeDependencies['runtimeMode'];
  build: {
    gitSha: string | null;
    gitShaShort: string | null;
    buildTimestamp: string | null;
    deploymentIdentifier: string | null;
    metadataComplete: boolean;
    missingFields: string[];
  };
  scorer: {
    runtimeVersion: string;
    systemRunType: 'candidate.scoring';
    cadenceMs: number;
    executionPath: string;
  };
  runtimeInstance: string | null;
}

const CANDIDATE_SCORING_CADENCE_MS = 5 * 60 * 1000;
const CANDIDATE_SCORING_EXECUTION_PATH =
  'api.scheduler -> CandidateScoringService.run -> pickCandidates.updateModelScoreBatch';

export async function handleRuntimeVersion(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
): Promise<void> {
  const auth = await authenticateRequest(request, runtime.authConfig);
  if (!auth || auth.role !== 'operator') {
    writeJson(response, 401, {
      ok: false,
      error: { code: 'UNAUTHORIZED', message: 'operator role required' },
    });
    return;
  }

  writeJson(response, 200, {
    service: 'api',
    persistenceMode: runtime.persistenceMode,
    runtimeMode: runtime.runtimeMode,
    build: {
      gitSha: runtime.versionInfo.gitSha,
      gitShaShort: runtime.versionInfo.gitShaShort,
      buildTimestamp: runtime.versionInfo.buildTimestamp,
      deploymentIdentifier: runtime.versionInfo.deploymentIdentifier,
      metadataComplete: runtime.versionInfo.metadataComplete,
      missingFields: runtime.versionInfo.missingFields,
    },
    scorer: {
      runtimeVersion: runtime.versionInfo.scorerRuntimeVersion,
      systemRunType: 'candidate.scoring',
      cadenceMs: CANDIDATE_SCORING_CADENCE_MS,
      executionPath: CANDIDATE_SCORING_EXECUTION_PATH,
    },
    runtimeInstance: runtime.versionInfo.runtimeInstance,
  } satisfies ApiRuntimeVersionResponse);
}
