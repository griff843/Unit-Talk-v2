/**
 * UTV2-1041 — Burn-in snapshot collector
 *
 * Collects one point-in-time evidence snapshot for the 72-hour production
 * burn-in certification. Designed to be called every 6h by the
 * ops-burn-in-monitor.yml GitHub Actions workflow.
 *
 * Usage:
 *   tsx scripts/ops/burn-in-snapshot.ts --index <N> --output <path>
 *
 * Exits 0 always — a failed snapshot captures the error and marks
 * passing: false. The workflow must never fail on a bad snapshot.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QueueHealth {
  status: string | null;
  pendingCount: number;
  deadLetterCount: number;
}

interface ApiResult {
  reachable: boolean;
  httpStatus: number | null;
  status: string | null;
  dbReachable: boolean | null;
  runtimeMode: string | null;
  queueHealth: QueueHealth | null;
}

interface OutboxCounts {
  pending: number;
  processing: number;
  dead_letter: number;
  deferred: number;
}

interface IngestorResult {
  lastOfferAgeMinutes: number | null;
  fresh: boolean;
}

export interface BurnInSnapshot {
  snapshotAt: string;
  deploymentSha: string;
  snapshotIndex: number;
  api: ApiResult;
  outbox: OutboxCounts | null;
  ingestor: IngestorResult;
  passing: boolean;
  failures: string[];
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const STALE_THRESHOLD_MINUTES = Number.parseInt(
  process.env['STALE_THRESHOLD_MINUTES'] ?? '30',
  10,
);
const DEPLOYMENT_SHA =
  process.env['BURN_IN_DEPLOYMENT_SHA'] ?? 'bd952fd7211d92eab782da273f11fa386dc22ca0';
const API_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { index: number; output: string } {
  let index = 0;
  let output = 'artifacts/snapshots/snap-0.json';

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--index' && argv[i + 1] !== undefined) {
      index = Number.parseInt(argv[i + 1]!, 10);
      i++;
    } else if (argv[i] === '--output' && argv[i + 1] !== undefined) {
      output = argv[i + 1]!;
      i++;
    }
  }

  return { index, output };
}

// ---------------------------------------------------------------------------
// API health collection
// ---------------------------------------------------------------------------

async function collectApiHealth(): Promise<ApiResult> {
  const healthUrl = process.env['UNIT_TALK_DEPLOY_HEALTH_URL'];
  if (!healthUrl) {
    return {
      reachable: false,
      httpStatus: null,
      status: null,
      dbReachable: null,
      runtimeMode: null,
      queueHealth: null,
    };
  }

  const url = `${healthUrl.replace(/\/$/, '')}/api/health?full=true`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    const httpStatus = response.status;

    if (!response.ok) {
      return {
        reachable: true,
        httpStatus,
        status: null,
        dbReachable: null,
        runtimeMode: null,
        queueHealth: null,
      };
    }

    const body: Record<string, unknown> = await response.json() as Record<string, unknown>;

    const queueHealthRaw = body['queueHealth'] as Record<string, unknown> | null | undefined;
    const queueHealth: QueueHealth | null = queueHealthRaw != null
      ? {
          status: typeof queueHealthRaw['status'] === 'string' ? queueHealthRaw['status'] : null,
          pendingCount: typeof queueHealthRaw['pendingCount'] === 'number'
            ? queueHealthRaw['pendingCount']
            : 0,
          deadLetterCount: typeof queueHealthRaw['deadLetterCount'] === 'number'
            ? queueHealthRaw['deadLetterCount']
            : 0,
        }
      : null;

    return {
      reachable: true,
      httpStatus,
      status: typeof body['status'] === 'string' ? body['status'] : null,
      dbReachable: typeof body['dbReachable'] === 'boolean' ? body['dbReachable'] : null,
      runtimeMode: typeof body['runtimeMode'] === 'string' ? body['runtimeMode'] : null,
      queueHealth,
    };
  } catch (err: unknown) {
    const isAbort =
      err instanceof Error &&
      (err.name === 'AbortError' || err.message.includes('abort'));
    console.error(`[burn-in-snapshot] API health fetch failed: ${isAbort ? 'timeout' : String(err)}`);
    return {
      reachable: false,
      httpStatus: null,
      status: null,
      dbReachable: null,
      runtimeMode: null,
      queueHealth: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Outbox state collection
// ---------------------------------------------------------------------------

async function collectOutboxCounts(): Promise<OutboxCounts | null> {
  const supabaseUrl = process.env['SUPABASE_URL'];
  const supabaseKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!supabaseUrl || !supabaseKey) {
    console.warn('[burn-in-snapshot] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — skipping outbox check');
    return null;
  }

  try {
    const db = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Count rows by status — distribution_outbox is the canonical outbox table.
    // 'deferred' is not a first-class status in the schema (statuses: pending,
    // processing, sent, failed, dead_letter) but we query for it defensively.
    const statuses = ['pending', 'processing', 'dead_letter', 'deferred'] as const;
    const counts: OutboxCounts = { pending: 0, processing: 0, dead_letter: 0, deferred: 0 };

    for (const status of statuses) {
      const { count, error } = await db
        .from('distribution_outbox')
        .select('*', { count: 'exact', head: true })
        .eq('status', status);

      if (error) {
        throw new Error(`outbox count query failed for status=${status}: ${error.message}`);
      }

      counts[status] = count ?? 0;
    }

    return counts;
  } catch (err: unknown) {
    console.error(`[burn-in-snapshot] Outbox count collection failed: ${String(err)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Ingestor freshness collection
// ---------------------------------------------------------------------------

async function collectIngestorFreshness(): Promise<IngestorResult> {
  const supabaseUrl = process.env['SUPABASE_URL'];
  const supabaseKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!supabaseUrl || !supabaseKey) {
    console.warn('[burn-in-snapshot] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — skipping ingestor check');
    return { lastOfferAgeMinutes: null, fresh: false };
  }

  try {
    const db = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // provider_offers is a view; snapshot_at is the ingestor-populated timestamp.
    // Fall back to created_at if snapshot_at is null.
    const { data, error } = await db
      .from('provider_offers')
      .select('snapshot_at, created_at')
      .order('snapshot_at', { ascending: false })
      .limit(1);

    if (error) {
      throw new Error(`provider_offers freshness query failed: ${error.message}`);
    }

    const row = data?.[0];
    const latestTimestamp =
      (typeof row?.snapshot_at === 'string' ? row.snapshot_at : null) ??
      (typeof row?.created_at === 'string' ? row.created_at : null);

    if (!latestTimestamp) {
      return { lastOfferAgeMinutes: null, fresh: false };
    }

    const ageMs = Date.now() - new Date(latestTimestamp).getTime();
    const ageMinutes = Math.max(0, Math.round(ageMs / 60_000));
    const fresh = ageMinutes <= STALE_THRESHOLD_MINUTES;

    return { lastOfferAgeMinutes: ageMinutes, fresh };
  } catch (err: unknown) {
    console.error(`[burn-in-snapshot] Ingestor freshness collection failed: ${String(err)}`);
    return { lastOfferAgeMinutes: null, fresh: false };
  }
}

// ---------------------------------------------------------------------------
// Criteria evaluation
// ---------------------------------------------------------------------------

function evaluateCriteria(
  api: ApiResult,
  outbox: OutboxCounts | null,
  ingestor: IngestorResult,
): { passing: boolean; failures: string[] } {
  const failures: string[] = [];

  if (!api.reachable) {
    failures.push('api.reachable');
  }
  if (api.reachable && api.dbReachable !== true) {
    failures.push('api.dbReachable');
  }
  if (api.reachable && api.queueHealth !== null && api.queueHealth.deadLetterCount !== 0) {
    failures.push('api.queueHealth.deadLetterCount');
  }
  if (!ingestor.fresh) {
    failures.push('ingestor.fresh');
  }
  if (outbox !== null && outbox.dead_letter !== 0) {
    failures.push('outbox.dead_letter');
  }

  return { passing: failures.length === 0, failures };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { index, output } = parseArgs(process.argv);
  const snapshotAt = new Date().toISOString();

  console.log(`[burn-in-snapshot] Collecting snapshot #${index} at ${snapshotAt}`);

  const [api, outbox, ingestor] = await Promise.all([
    collectApiHealth(),
    collectOutboxCounts(),
    collectIngestorFreshness(),
  ]);

  const { passing, failures } = evaluateCriteria(api, outbox, ingestor);

  const snapshot: BurnInSnapshot = {
    snapshotAt,
    deploymentSha: DEPLOYMENT_SHA,
    snapshotIndex: index,
    api,
    outbox,
    ingestor,
    passing,
    failures,
  };

  // Write output file
  const outputDir = path.dirname(output);
  if (outputDir && !fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(output, JSON.stringify(snapshot, null, 2), 'utf8');

  const status = passing ? 'PASS' : `FAIL (${failures.join(', ')})`;
  console.log(`[burn-in-snapshot] Snapshot #${index}: ${status}`);
  console.log(`[burn-in-snapshot] Written to ${output}`);

  // Exit 0 always — failed snapshots are collected, not failed workflows.
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('[burn-in-snapshot] Unexpected fatal error:', err);
  // Still exit 0 — the workflow must not fail on a bad snapshot.
  process.exit(0);
});
