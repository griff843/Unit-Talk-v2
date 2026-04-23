import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AlertLevel, ModelHealthSnapshotCreateInput, ModelHealthSnapshotRecord } from '@unit-talk/db';
import type { ApiRuntimeDependencies } from '../server.js';
import { readJsonBody } from '../server.js';
import { writeJson } from '../http-utils.js';

type ModelHealthDecisionAction = 'acknowledge' | 'demote' | 'retire';

interface ModelHealthDecisionRequest {
  modelId: string;
  action: ModelHealthDecisionAction;
  reason: string;
  actor: string;
}

const DECISION_ACTIONS = new Set<ModelHealthDecisionAction>(['acknowledge', 'demote', 'retire']);
const ALERT_LEVELS = new Set<AlertLevel>(['none', 'warning', 'critical']);

export async function handleModelHealthAlerts(
  _request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
): Promise<void> {
  const snapshots = runtime.repositories.modelHealthSnapshots;
  if (!snapshots) {
    writeJson(response, 503, {
      ok: false,
      error: {
        code: 'MODEL_HEALTH_REPOSITORY_UNAVAILABLE',
        message: 'Model health snapshots repository is not configured.',
      },
    });
    return;
  }

  const records = await snapshots.listAlerted();
  writeJson(response, 200, records);
}

export async function handleModelHealthDecision(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
): Promise<void> {
  const snapshots = runtime.repositories.modelHealthSnapshots;
  if (!snapshots) {
    writeJson(response, 503, {
      ok: false,
      error: {
        code: 'MODEL_HEALTH_REPOSITORY_UNAVAILABLE',
        message: 'Model health snapshots repository is not configured.',
      },
    });
    return;
  }

  const body = await readJsonBody(request, runtime.bodyLimitBytes);
  const payload = readDecisionPayload(body);
  if (!payload.ok) {
    writeJson(response, 400, {
      ok: false,
      error: {
        code: payload.code,
        message: payload.message,
      },
    });
    return;
  }

  const { modelId, action, reason, actor } = payload.value;

  await runtime.repositories.audit.record({
    entityType: 'model',
    entityId: modelId,
    entityRef: modelId,
    action: `model_health.${action}`,
    actor,
    payload: { action, reason },
  });

  const latest = await snapshots.findLatestByModel(modelId);
  if (latest && requiresOperatorDecision(latest)) {
    await snapshots.create(copySnapshotWithDecisionCleared(latest));
  }

  writeJson(response, 200, { ok: true });
}

function readDecisionPayload(
  body: Record<string, unknown>,
): { ok: true; value: ModelHealthDecisionRequest } | { ok: false; code: string; message: string } {
  const modelId = typeof body.modelId === 'string' ? body.modelId.trim() : '';
  const action = typeof body.action === 'string' ? body.action : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const actor = typeof body.actor === 'string' ? body.actor.trim() : '';

  if (!modelId) {
    return { ok: false, code: 'MODEL_ID_REQUIRED', message: 'modelId is required.' };
  }
  if (!DECISION_ACTIONS.has(action as ModelHealthDecisionAction)) {
    return {
      ok: false,
      code: 'INVALID_MODEL_HEALTH_ACTION',
      message: 'action must be acknowledge, demote, or retire.',
    };
  }
  if (!reason) {
    return { ok: false, code: 'REASON_REQUIRED', message: 'reason is required.' };
  }
  if (!actor) {
    return { ok: false, code: 'ACTOR_REQUIRED', message: 'actor is required.' };
  }

  return {
    ok: true,
    value: {
      modelId,
      action: action as ModelHealthDecisionAction,
      reason,
      actor,
    },
  };
}

function requiresOperatorDecision(snapshot: ModelHealthSnapshotRecord): boolean {
  if (
    'requiresOperatorDecision' in snapshot &&
    (snapshot as ModelHealthSnapshotRecord & { requiresOperatorDecision?: unknown }).requiresOperatorDecision === true
  ) {
    return true;
  }

  const metadata = readRecord(snapshot.metadata);
  return metadata['requiresOperatorDecision'] === true;
}

function copySnapshotWithDecisionCleared(
  snapshot: ModelHealthSnapshotRecord,
): ModelHealthSnapshotCreateInput {
  const metadata = {
    ...readRecord(snapshot.metadata),
    requiresOperatorDecision: false,
  };
  const input: ModelHealthSnapshotCreateInput = {
    modelId: snapshot.model_id,
    sport: snapshot.sport,
    marketFamily: snapshot.market_family,
    sampleSize: snapshot.sample_size,
    alertLevel: readAlertLevel(snapshot.alert_level),
    metadata,
  };

  if (snapshot.win_rate !== null) input.winRate = snapshot.win_rate;
  if (snapshot.roi !== null) input.roi = snapshot.roi;
  if (snapshot.drift_score !== null) input.driftScore = snapshot.drift_score;
  if (snapshot.calibration_score !== null) input.calibrationScore = snapshot.calibration_score;

  return input;
}

function readAlertLevel(value: string): AlertLevel {
  return ALERT_LEVELS.has(value as AlertLevel) ? value as AlertLevel : 'none';
}

function readRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
