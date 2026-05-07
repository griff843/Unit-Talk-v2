/**
 * T1 pre-merge proof: UTV2-845 canonical stake_units integrity
 *
 * Exercises live Supabase repositories through both:
 * - a human/API request path using snake_case `stake_units`
 * - a machine-generated request path that must persist the explicit 1u default
 *
 * Then settles the human-path pick and verifies the settlement + recap layers
 * preserve stake integrity without hidden fallback math.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseClientFromConnection,
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  type RepositoryBundle,
  type UnitTalkSupabaseClient,
} from '@unit-talk/db';

import { handleSubmitPick } from './handlers/submit-pick.js';
import { transitionPickLifecycle } from './lifecycle-service.js';
import { computeRecapSummary } from './recap-service.js';
import { recordPickSettlement } from './settlement-service.js';

function resolveEnvironmentRoot() {
  const candidates = [
    process.cwd(),
    path.resolve(process.cwd(), '..', '..', '..'),
  ];

  for (const candidate of candidates) {
    const envPath = path.join(candidate, 'local.env');
    const examplePath = path.join(candidate, '.env.example');
    if (fs.existsSync(envPath) || fs.existsSync(examplePath)) {
      return candidate;
    }
  }

  return process.cwd();
}

function getLiveContext():
  | {
      repositories: RepositoryBundle;
      client: UnitTalkSupabaseClient;
    }
  | null {
  try {
    const env = loadEnvironment(resolveEnvironmentRoot());
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      return null;
    }

    const connection = createServiceRoleDatabaseConnectionConfig(env);
    return {
      repositories: createDatabaseRepositoryBundle(connection),
      client: createDatabaseClientFromConnection(connection),
    };
  } catch {
    return null;
  }
}

function nextUtcMidnightAfter(timestamp: string) {
  const settledAt = new Date(timestamp);
  return new Date(Date.UTC(
    settledAt.getUTCFullYear(),
    settledAt.getUTCMonth(),
    settledAt.getUTCDate() + 1,
    0,
    1,
    0,
    0,
  ));
}

const live = getLiveContext();
const skipReason = live
  ? false
  : 'SUPABASE_SERVICE_ROLE_KEY not configured for the active/root workspace; skipping live DB proof';

function requireSuccessData(
  response: Awaited<ReturnType<typeof handleSubmitPick>>,
) {
  assert.equal(response.body.ok, true, 'submission response must be ok');
  return response.body.data;
}

test('UTV2-845 live proof persists canonical stake_units across submit, settlement, and recap paths', { skip: skipReason }, async () => {
  const proofRunId = `utv2-845-${randomUUID()}`;
  const humanEvent = `UTV2-845 proof human ${proofRunId.slice(-8)}`;
  const machineEvent = `UTV2-845 proof machine ${proofRunId.slice(-8)}`;

  const humanResponse = await handleSubmitPick(
    {
      body: {
        source: 'api',
        submittedBy: 'codex',
        market: 'NBA points',
        selection: `UTV2-845 Human Over 21.5 ${proofRunId.slice(-6)}`,
        line: 21.5,
        odds: -110,
        stake_units: 2.5,
        eventName: humanEvent,
        metadata: {
          proofIssue: 'UTV2-845',
          proofRunId,
          submissionPath: 'snake_case_api',
        },
      },
    },
    live!.repositories,
  );

  assert.equal(humanResponse.status, 201, 'snake_case request path must succeed');
  const humanPickId = requireSuccessData(humanResponse).pickId;
  const humanPick = await live!.repositories.picks.findPickById(humanPickId);
  assert.ok(humanPick, 'human-path pick must persist');
  assert.equal(humanPick?.stake_units, 2.5, 'snake_case stake_units must persist canonically');

  const machineResponse = await handleSubmitPick(
    {
      body: {
        source: 'board-construction',
        submittedBy: 'codex',
        market: 'NBA rebounds',
        selection: `UTV2-845 Machine Over 8.5 ${proofRunId.slice(-6)}`,
        line: 8.5,
        odds: -115,
        eventName: machineEvent,
        metadata: {
          proofIssue: 'UTV2-845',
          proofRunId,
          submissionPath: 'system_default_flat_1u',
        },
      },
    },
    live!.repositories,
  );

  assert.equal(machineResponse.status, 201, 'machine-generated request path must succeed');
  const machinePick = await live!.repositories.picks.findPickById(requireSuccessData(machineResponse).pickId);
  assert.ok(machinePick, 'machine-path pick must persist');
  assert.equal(machinePick?.stake_units, 1, 'machine-generated picks must persist explicit 1u');
  assert.equal(
    ((machinePick?.metadata ?? {}) as Record<string, unknown>)['stakeUnitsSource'],
    'system_default_flat_1u',
    'machine-generated default must remain explicit in metadata',
  );

  await transitionPickLifecycle(live!.repositories.picks, humanPickId, 'queued', 'utv2-845 proof queue');
  await transitionPickLifecycle(
    live!.repositories.picks,
    humanPickId,
    'posted',
    'utv2-845 proof post',
    'poster',
  );

  const settlement = await recordPickSettlement(
    humanPickId,
    {
      status: 'settled',
      result: 'win',
      source: 'operator',
      confidence: 'confirmed',
      evidenceRef: `proof://utv2-845/${proofRunId}`,
      settledBy: 'codex',
      notes: 'live DB proof for canonical stake_units integrity',
    },
    live!.repositories,
  );

  const settlementPayload = (settlement.settlementRecord.payload ?? {}) as Record<string, unknown>;
  assert.equal(settlementPayload['stakeUnitsStatus'], 'canonical');
  assert.equal(typeof settlementPayload['profitLossUnits'], 'number');

  const recapNow = nextUtcMidnightAfter(settlement.settlementRecord.created_at);
  const recap = await computeRecapSummary('daily', live!.repositories, recapNow);
  assert.ok(recap, 'daily recap should include the freshly settled proof pick');

  const proofRecapRow = recap!.picks.find((pick) => pick.selection === humanPick?.selection);
  assert.ok(proofRecapRow, 'recap must include the human-path proof pick');
  assert.equal(recap!.unknownStakeCount >= 0, true);
  assert.equal(recap!.knownStakeCount >= 1, true);
  assert.equal(proofRecapRow?.profitLossUnits == null, false, 'recap P/L must stay available for canonical stake rows');

  const historicalWindowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [{ count: recentSettledCount, error: totalError }, { count: recentSettledNullStakeCount, error: nullError }] = await Promise.all([
    live!.client
      .from('picks')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'settled')
      .gte('created_at', historicalWindowStart),
    live!.client
      .from('picks')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'settled')
      .is('stake_units', null)
      .gte('created_at', historicalWindowStart),
  ]);

  assert.equal(totalError, null, `recent settled count query failed: ${JSON.stringify(totalError)}`);
  assert.equal(nullError, null, `recent settled null-stake query failed: ${JSON.stringify(nullError)}`);

  console.log(JSON.stringify({
    issue: 'UTV2-845',
    proofRunId,
    persisted: {
      humanPickId,
      humanStakeUnits: humanPick?.stake_units,
      machinePickId: machinePick?.id,
      machineStakeUnits: machinePick?.stake_units,
      machineStakeUnitsSource: ((machinePick?.metadata ?? {}) as Record<string, unknown>)['stakeUnitsSource'],
    },
    settlement: {
      pickId: humanPickId,
      stakeUnitsStatus: settlementPayload['stakeUnitsStatus'],
      profitLossUnits: settlementPayload['profitLossUnits'],
    },
    recap: {
      knownStakeCount: recap!.knownStakeCount,
      unknownStakeCount: recap!.unknownStakeCount,
      totalRiskedUnits: recap!.totalRiskedUnits,
      roiPercent: recap!.roiPercent,
    },
    recentHistoricalSample: {
      windowStart: historicalWindowStart,
      settledCount: recentSettledCount ?? 0,
      settledNullStakeCount: recentSettledNullStakeCount ?? 0,
    },
  }));
});
