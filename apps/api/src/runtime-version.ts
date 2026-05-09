import type { AppEnv } from '@unit-talk/config';

export const CURRENT_SCORER_RUNTIME_VERSION = 'candidate-scoring-ownership-v1';

export interface RuntimeVersionInfo {
  gitSha: string | null;
  gitShaShort: string | null;
  buildTimestamp: string | null;
  deploymentIdentifier: string | null;
  scorerRuntimeVersion: string;
  runtimeInstance: string | null;
  metadataComplete: boolean;
  missingFields: Array<'gitSha' | 'buildTimestamp' | 'deploymentIdentifier'>;
}

export function readRuntimeVersionInfo(environment: AppEnv): RuntimeVersionInfo {
  return createRuntimeVersionInfo({
    gitSha: environment.UNIT_TALK_GIT_SHA,
    buildTimestamp: environment.UNIT_TALK_BUILD_TIMESTAMP,
    deploymentIdentifier: environment.UNIT_TALK_DEPLOYMENT_ID,
    scorerRuntimeVersion: environment.UNIT_TALK_SCORER_RUNTIME_VERSION,
    runtimeInstance: process.env['HOSTNAME'],
  });
}

export function readRuntimeVersionInfoFromProcessEnv(environment: NodeJS.ProcessEnv = process.env) {
  return createRuntimeVersionInfo({
    gitSha: environment['UNIT_TALK_GIT_SHA'],
    buildTimestamp: environment['UNIT_TALK_BUILD_TIMESTAMP'],
    deploymentIdentifier: environment['UNIT_TALK_DEPLOYMENT_ID'],
    scorerRuntimeVersion: environment['UNIT_TALK_SCORER_RUNTIME_VERSION'],
    runtimeInstance: environment['HOSTNAME'],
  });
}

function createRuntimeVersionInfo(input: {
  gitSha?: string | undefined;
  buildTimestamp?: string | undefined;
  deploymentIdentifier?: string | undefined;
  scorerRuntimeVersion?: string | undefined;
  runtimeInstance?: string | undefined;
}): RuntimeVersionInfo {
  const gitSha = normalizeOptional(input.gitSha);
  const buildTimestamp = normalizeOptional(input.buildTimestamp);
  const deploymentIdentifier = normalizeOptional(input.deploymentIdentifier);
  const scorerRuntimeVersion =
    normalizeOptional(input.scorerRuntimeVersion)
    ?? CURRENT_SCORER_RUNTIME_VERSION;
  const runtimeInstance = normalizeOptional(input.runtimeInstance);
  const missingFields: RuntimeVersionInfo['missingFields'] = [];

  if (!gitSha) missingFields.push('gitSha');
  if (!buildTimestamp) missingFields.push('buildTimestamp');
  if (!deploymentIdentifier) missingFields.push('deploymentIdentifier');

  return {
    gitSha,
    gitShaShort: gitSha ? gitSha.slice(0, 12) : null,
    buildTimestamp,
    deploymentIdentifier,
    scorerRuntimeVersion,
    runtimeInstance,
    metadataComplete: missingFields.length === 0,
    missingFields,
  };
}

export function toRuntimeVersionLogFields(version: RuntimeVersionInfo) {
  return {
    gitSha: version.gitSha,
    gitShaShort: version.gitShaShort,
    buildTimestamp: version.buildTimestamp,
    deploymentIdentifier: version.deploymentIdentifier,
    scorerRuntimeVersion: version.scorerRuntimeVersion,
    runtimeInstance: version.runtimeInstance,
    metadataComplete: version.metadataComplete,
    missingFields: version.missingFields,
  };
}

function normalizeOptional(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
