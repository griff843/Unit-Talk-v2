import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { loadEnvironment } from '@unit-talk/config';
import type { CanonicalPick, SubmissionPayload } from '@unit-talk/contracts';
import { writeJson } from '../http-utils.js';
import type { ApiRuntimeDependencies } from '../server.js';

const QA_PICK_DELIVERY_TARGET = 'discord:qa-pick-delivery';

type QaChannelMap = {
  guildId: string;
  channels: {
    qaPickDelivery: string;
  };
};

type QaSeedEnvironment = ReturnType<typeof loadEnvironment> & {
  UNIT_TALK_QA_SEED_ENABLED?: string;
  DISCORD_QA_CHANNEL_MAP?: string;
};

function loadQaSeedEnvironment(): QaSeedEnvironment {
  return loadEnvironment(process.cwd()) as QaSeedEnvironment;
}

function qaSeedGuardFailure():
  | { status: 501; body: { error: string } }
  | { status: 403; body: { error: string } }
  | null {
  const environment = loadQaSeedEnvironment();

  if (environment.UNIT_TALK_QA_SEED_ENABLED !== 'true') {
    return { status: 501, body: { error: 'QA seed not enabled' } };
  }

  if (process.env['NODE_ENV'] === 'production') {
    return { status: 403, body: { error: 'QA seed forbidden in production' } };
  }

  return null;
}

function loadQaPickDeliveryChannelId(): string {
  const environment = loadQaSeedEnvironment();
  const mapPath = environment.DISCORD_QA_CHANNEL_MAP?.trim();
  if (!mapPath) {
    throw new Error('DISCORD_QA_CHANNEL_MAP must be configured for QA seed routes.');
  }

  const resolvedPath = path.isAbsolute(mapPath) ? mapPath : path.resolve(process.cwd(), mapPath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`DISCORD_QA_CHANNEL_MAP file not found: ${resolvedPath}`);
  }

  const parsed = JSON.parse(readFileSync(resolvedPath, 'utf8')) as Partial<QaChannelMap>;
  if (!parsed.channels?.qaPickDelivery || typeof parsed.channels.qaPickDelivery !== 'string') {
    throw new Error(`DISCORD_QA_CHANNEL_MAP is missing channels.qaPickDelivery at ${resolvedPath}`);
  }

  return parsed.channels.qaPickDelivery;
}

function createQaSeedPick(now: string): CanonicalPick {
  return {
    id: randomUUID(),
    submissionId: randomUUID(),
    market: 'player_points_ou',
    selection: 'Over 42.5',
    line: 42.5,
    odds: -110,
    stakeUnits: 1,
    confidence: 0.75,
    source: 'api',
    submittedBy: 'qa-seed',
    approvalStatus: 'approved',
    promotionStatus: 'not_eligible',
    lifecycleState: 'queued',
    metadata: {
      qaSeed: true,
      qaSeedKind: 'discord-pick-delivery',
      sport: 'NBA',
      embedTitle: 'QA Test Pick — Over 42.5',
      embedOdds: '-110',
      embedUnits: '1',
      embedBook: 'QA Book',
    },
    createdAt: now,
  };
}

function createQaSeedSubmissionPayload(): SubmissionPayload {
  return {
    source: 'api',
    submittedBy: 'qa-seed',
    market: 'player_points_ou',
    selection: 'Over 42.5',
    line: 42.5,
    odds: -110,
    stakeUnits: 1,
    confidence: 0.75,
    eventName: 'QA Sandbox Event',
    metadata: {
      qaSeed: true,
      qaSeedKind: 'discord-pick-delivery',
      sport: 'NBA',
      embedTitle: 'QA Test Pick — Over 42.5',
      embedOdds: '-110',
      embedUnits: '1',
      embedBook: 'QA Book',
    },
  };
}

export async function handleQaSeedPick(
  _request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
): Promise<void> {
  const failure = qaSeedGuardFailure();
  if (failure) {
    writeJson(response, failure.status, failure.body);
    return;
  }

  const channelId = loadQaPickDeliveryChannelId();
  const now = new Date().toISOString();
  const pick = createQaSeedPick(now);

  await runtime.repositories.submissions.saveSubmission({
    id: pick.submissionId,
    payload: createQaSeedSubmissionPayload(),
    receivedAt: now,
  });
  await runtime.repositories.picks.savePick(pick, `qa-seed:${pick.id}`);
  const outbox = await runtime.repositories.outbox.enqueue({
    pickId: pick.id,
    target: QA_PICK_DELIVERY_TARGET,
    payload: {
      qaSeed: true,
      pickId: pick.id,
      channelId,
      title: 'QA Test Pick — Over 42.5',
      odds: '-110',
      units: '1',
      book: 'QA Book',
    },
    idempotencyKey: `qa-seed:${pick.id}:${QA_PICK_DELIVERY_TARGET}`,
  });

  writeJson(response, 200, {
    pickId: pick.id,
    outboxId: outbox.id,
    channelId,
  });
}

export async function handleQaPickStatus(
  _request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
  pickId: string,
): Promise<void> {
  const failure = qaSeedGuardFailure();
  if (failure) {
    writeJson(response, failure.status, failure.body);
    return;
  }

  const pick = await runtime.repositories.picks.findPickById(pickId);
  if (!pick) {
    writeJson(response, 404, { error: 'QA pick not found' });
    return;
  }

  const outbox = await runtime.repositories.outbox.findLatestByPick(pickId, [
    'pending',
    'processing',
    'sent',
    'failed',
    'dead_letter',
  ]);
  writeJson(response, 200, {
    pickId: pick.id,
    status: pick.status,
    outboxId: outbox?.id ?? null,
    outboxStatus: outbox?.status ?? null,
  });
}
