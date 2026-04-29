import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseClientFromConnection,
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
} from '@unit-talk/db';
import { computeRecapSummary, getRecapWindow } from '../../apps/api/src/recap-service.js';

interface ProofSummary {
  representativePickId: string;
  receiptCount: number;
  settlementRecordId: string;
  correctionChainDepth: number;
  lifecycleStates: string[];
  clvStatus: string | null;
  clvPercent: number | null;
  profitLossUnits: number | null;
  recapPeriod: 'daily' | 'weekly' | 'monthly' | null;
  latestGradingRun: {
    startedAt: string | null;
    status: string | null;
    skipped: number | null;
    errors: number | null;
    actionableReasons: string[];
  };
  auditActions: string[];
}

function readPayloadNumber(payload: unknown, key: string): number | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readPayloadString(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

async function main() {
  const env = loadEnvironment();
  const connection = createServiceRoleDatabaseConnectionConfig(env);
  const db = createDatabaseClientFromConnection(connection);
  const repositories = createDatabaseRepositoryBundle(connection);

  const { data: settlementRows, error: settlementError } = await db
    .from('settlement_records')
    .select('id, pick_id, corrects_id, payload, created_at, status, result')
    .eq('status', 'settled')
    .order('created_at', { ascending: false })
    .limit(250);

  if (settlementError) {
    throw new Error(`Settlement query failed: ${settlementError.message}`);
  }

  const representative = (settlementRows ?? []).find((row) => {
    const payload = row.payload as Record<string, unknown> | null;
    return typeof row.pick_id === 'string' && (
      typeof payload?.['clvPercent'] === 'number' ||
      typeof payload?.['clvStatus'] === 'string' ||
      typeof payload?.['clvUnavailableReason'] === 'string'
    );
  });

  if (!representative) {
    throw new Error('No representative settled pick with CLV diagnostics was found.');
  }

  const pickId = representative.pick_id as string;
  const [{ data: outboxRows, error: outboxError }, { data: auditRows, error: auditError }, { data: lifecycleRows, error: lifecycleError }, { data: gradingRuns, error: gradingError }] = await Promise.all([
    db
      .from('distribution_outbox')
      .select('id, status, created_at')
      .eq('pick_id', pickId)
      .order('created_at', { ascending: false }),
    db
      .from('audit_log')
      .select('action, created_at')
      .eq('entity_ref', pickId)
      .order('created_at', { ascending: false }),
    db
      .from('pick_lifecycle')
      .select('to_state, created_at')
      .eq('pick_id', pickId)
      .order('created_at', { ascending: true }),
    db
      .from('system_runs')
      .select('status, started_at, details')
      .eq('run_type', 'grading.run')
      .order('started_at', { ascending: false })
      .limit(1),
  ]);

  if (outboxError) throw new Error(`Outbox query failed: ${outboxError.message}`);
  if (auditError) throw new Error(`Audit query failed: ${auditError.message}`);
  if (lifecycleError) throw new Error(`Lifecycle query failed: ${lifecycleError.message}`);
  if (gradingError) throw new Error(`Grading run query failed: ${gradingError.message}`);

  const outboxIds = (outboxRows ?? []).map((row) => row.id as string);
  const { data: receiptRows, error: receiptError } = outboxIds.length === 0
    ? { data: [], error: null }
    : await db
        .from('distribution_receipts')
        .select('id, status, outbox_id, recorded_at')
        .in('outbox_id', outboxIds)
        .order('recorded_at', { ascending: false });

  if (receiptError) {
    throw new Error(`Receipt query failed: ${receiptError.message}`);
  }

  const periods: Array<'daily' | 'weekly' | 'monthly'> = ['daily', 'weekly', 'monthly'];
  let recapPeriod: ProofSummary['recapPeriod'] = null;
  for (const period of periods) {
    const window = getRecapWindow(period);
    if (
      representative.created_at < window.startsAt ||
      representative.created_at >= window.endsAt
    ) {
      continue;
    }

    const recap = await computeRecapSummary(period, repositories);
    if (recap && recap.totalPicks > 0) {
      recapPeriod = period;
      break;
    }
  }

  const gradingDetails = gradingRuns?.[0]?.details as Record<string, unknown> | null;
  const actionableReasons = Array.isArray(gradingDetails?.['details'])
    ? (gradingDetails?.['details'] as Array<Record<string, unknown>>)
        .map((detail) => detail?.['reason'])
        .filter((reason): reason is string => typeof reason === 'string' && reason.length > 0)
        .slice(0, 5)
    : [];

  const summary: ProofSummary = {
    representativePickId: pickId,
    receiptCount: (receiptRows ?? []).length,
    settlementRecordId: representative.id as string,
    correctionChainDepth: (settlementRows ?? []).filter((row) => row.pick_id === pickId).length,
    lifecycleStates: (lifecycleRows ?? [])
      .map((row) => row.to_state)
      .filter((state): state is string => typeof state === 'string'),
    clvStatus:
      readPayloadString(representative.payload, 'clvStatus') ??
      readPayloadString(representative.payload, 'clvUnavailableReason'),
    clvPercent: readPayloadNumber(representative.payload, 'clvPercent'),
    profitLossUnits: readPayloadNumber(representative.payload, 'profitLossUnits'),
    recapPeriod,
    latestGradingRun: {
      startedAt: typeof gradingRuns?.[0]?.started_at === 'string' ? gradingRuns[0].started_at : null,
      status: typeof gradingRuns?.[0]?.status === 'string' ? gradingRuns[0].status : null,
      skipped: readPayloadNumber(gradingDetails, 'skipped'),
      errors: readPayloadNumber(gradingDetails, 'errors'),
      actionableReasons,
    },
    auditActions: (auditRows ?? [])
      .map((row) => row.action)
      .filter((action): action is string => typeof action === 'string')
      .slice(0, 10),
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
