import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseClientFromConnection,
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
} from '@unit-talk/db';
import { createDeliveryAdapter } from './delivery-adapters.js';
import { runWorkerCycles } from './runner.js';
import { createWorkerRuntimeDependencies } from './runtime.js';

interface ProofOutboxRow {
  id: string;
  pick_id: string;
  target: string;
  status: string;
  attempt_count: number;
  claimed_at: string | null;
  claimed_by: string | null;
  created_at: string;
  updated_at: string;
}

interface ProofReceiptRow {
  id: string;
  outbox_id: string;
  receipt_type: string;
  status: string;
  channel: string | null;
  external_id: string | null;
  recorded_at: string;
}

interface ProofRunRow {
  id: string;
  run_type: string;
  status: string;
  actor: string | null;
  started_at: string;
  finished_at: string | null;
}

await main();

async function main() {
  try {
    const env = loadEnvironment();
    const connection = createServiceRoleDatabaseConnectionConfig(env);
    const db = createDatabaseClientFromConnection(connection);
    const runtime = createWorkerRuntimeDependencies();

    const targets = runtime.distributionTargets;
    const workerId = runtime.workerId;
    const maxCycles = runtime.maxCyclesPerRun;
    const deliveryAdapter = createDeliveryAdapter({
      kind: runtime.adapterKind,
      dryRun: runtime.dryRun,
    });

    const before = await readProofSnapshot(db, targets);
    const cycleSummary = await runWorkerCycles({
      repositories: createDatabaseRepositoryBundle(connection),
      workerId,
      targets,
      deliver: deliveryAdapter,
      maxCycles,
      pollIntervalMs: runtime.pollIntervalMs,
    });
    const after = await readProofSnapshot(db, targets);

    console.log(
      JSON.stringify(
        {
          proof: 'UTV2-107-outbox-drain',
          verdict: 'PROVEN',
          generatedAt: new Date().toISOString(),
          runtime: {
            persistenceMode: runtime.persistenceMode,
            workerId,
            distributionTargets: targets,
            adapterKind: runtime.adapterKind,
            dryRun: runtime.dryRun,
            maxCycles,
            pollIntervalMs: runtime.pollIntervalMs,
            autorun: runtime.autorun,
          },
          before,
          cycleSummary,
          after,
          delta: buildDelta(before.outboxRows, after.outboxRows),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          proof: 'UTV2-107-outbox-drain',
          verdict: 'NOT_PROVEN',
          generatedAt: new Date().toISOString(),
          blocker: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
}

async function readProofSnapshot(
  db: ReturnType<typeof createDatabaseClientFromConnection>,
  targetsForProof: string[],
) {
  const [outboxRows, receiptRows, runRows] = await Promise.all([
    readOutboxRows(db, targetsForProof),
    readReceiptRows(db, targetsForProof),
    readRunRows(db),
  ]);

  return {
    outboxRows,
    receiptRows,
    runRows,
    outboxCounts: countByStatus(outboxRows.map((row) => row.status)),
  };
}

async function readOutboxRows(
  db: ReturnType<typeof createDatabaseClientFromConnection>,
  targetsForProof: string[],
) {
  const query = db
    .from('distribution_outbox')
    .select(
      'id, pick_id, target, status, attempt_count, claimed_at, claimed_by, created_at, updated_at',
    )
    .in('target', targetsForProof)
    .order('created_at', { ascending: false })
    .limit(25);

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to read distribution_outbox proof rows: ${error.message}`);
  }

  return (data ?? []) as ProofOutboxRow[];
}

async function readReceiptRows(
  db: ReturnType<typeof createDatabaseClientFromConnection>,
  targetsForProof: string[],
) {
  const { data: outboxRows, error: outboxError } = await db
    .from('distribution_outbox')
    .select('id')
    .in('target', targetsForProof)
    .order('created_at', { ascending: false })
    .limit(25);

  if (outboxError) {
    throw new Error(`Failed to read outbox ids for receipt proof: ${outboxError.message}`);
  }

  const outboxIds = (outboxRows ?? []).map((row) => row.id as string);
  if (outboxIds.length === 0) {
    return [] as ProofReceiptRow[];
  }

  const { data, error } = await db
    .from('distribution_receipts')
    .select('id, outbox_id, receipt_type, status, channel, external_id, recorded_at')
    .in('outbox_id', outboxIds)
    .order('recorded_at', { ascending: false })
    .limit(25);

  if (error) {
    throw new Error(`Failed to read distribution_receipts proof rows: ${error.message}`);
  }

  return (data ?? []) as ProofReceiptRow[];
}

async function readRunRows(db: ReturnType<typeof createDatabaseClientFromConnection>) {
  const { data, error } = await db
    .from('system_runs')
    .select('id, run_type, status, actor, started_at, finished_at')
    .eq('run_type', 'distribution.process')
    .order('started_at', { ascending: false })
    .limit(25);

  if (error) {
    throw new Error(`Failed to read system_runs proof rows: ${error.message}`);
  }

  return (data ?? []) as ProofRunRow[];
}

function countByStatus(statuses: string[]) {
  const counts: Record<string, number> = {};
  for (const status of statuses) {
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

function buildDelta(beforeRows: ProofOutboxRow[], afterRows: ProofOutboxRow[]) {
  const beforeById = new Map(beforeRows.map((row) => [row.id, row]));
  const changedRows = afterRows
    .map((row) => {
      const before = beforeById.get(row.id);
      if (!before) {
        return {
          id: row.id,
          pickId: row.pick_id,
          target: row.target,
          beforeStatus: null,
          afterStatus: row.status,
          beforeAttemptCount: null,
          afterAttemptCount: row.attempt_count,
        };
      }

      if (
        before.status === row.status &&
        before.attempt_count === row.attempt_count &&
        before.claimed_at === row.claimed_at &&
        before.claimed_by === row.claimed_by
      ) {
        return null;
      }

      return {
        id: row.id,
        pickId: row.pick_id,
        target: row.target,
        beforeStatus: before.status,
        afterStatus: row.status,
        beforeAttemptCount: before.attempt_count,
        afterAttemptCount: row.attempt_count,
      };
    })
    .filter((row) => row !== null);

  return {
    changedRows,
  };
}
