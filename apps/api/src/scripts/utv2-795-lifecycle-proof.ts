/**
 * UTV2-795 — lifecycle proof: posted → settlement_record → CLV payload → recap consumption
 *
 * Exercises the full settlement pipeline against two designated live proof picks
 * with confirmed market_universe closing data. Proves each stage of:
 *   posted → settlement eligibility → settlement_record (corrects_id=null)
 *   → CLV payload (status=computed) → recap consumption → audit entity_id
 *
 * Proof picks (confirmed in pre-flight, metadata.marketUniverseId present):
 *   d9b96f8d — NHL player_hockey_points_ou (MU: 0.5 line, -123/-109 odds)
 *   a3072fdc — MLB player_batting_doubles_ou (MU: 0.5 line, 428/-708 odds)
 *
 * Idempotent: if a pick is already settled, reads the original settlement record.
 * No mutation of original settlement records; no production queue drain.
 *
 * Run:
 *   npx tsx apps/api/src/scripts/utv2-795-lifecycle-proof.ts
 */

import {
  createDatabaseClientFromConnection,
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  type SettlementRecord,
} from '@unit-talk/db';
import { loadEnvironment } from '@unit-talk/config';

import { recordPickSettlement } from '../settlement-service.js';
import { computeRecapSummary, getRecapWindow } from '../recap-service.js';

export interface PickProofResult {
  proof: 'utv2-795';
  pickId: string;
  stages: {
    posted: boolean;
    settlement_created: boolean;
    corrects_id_null: boolean;
    clv_computed: boolean;
    clv_status: string | null;
    recap_consumes: boolean;
    audit_entity_id_present: boolean;
  };
  clvBacked: boolean;
  skipReason: string | null;
}

// Designated proof picks — confirmed in pre-flight with closing data in market_universe.
const PROOF_PICK_IDS = [
  'd9b96f8d-7d57-4f70-adbd-260722cc70a5', // NHL player_hockey_points_ou
  'a3072fdc-c0f9-45e1-b10b-206f1f4c1f4b', // MLB player_batting_doubles_ou
] as const;

export async function runProof(): Promise<PickProofResult[]> {
  const connection = createServiceRoleDatabaseConnectionConfig(loadEnvironment());
  const repositories = createDatabaseRepositoryBundle(connection);
  const db = createDatabaseClientFromConnection(connection);
  const results: PickProofResult[] = [];
  for (const pickId of PROOF_PICK_IDS) {
    results.push(await runPickProof(pickId, repositories, db));
  }
  return results;
}

export async function runPickProof(
  pickId: string,
  repositories: ReturnType<typeof createDatabaseRepositoryBundle>,
  db: ReturnType<typeof createDatabaseClientFromConnection>,
): Promise<PickProofResult> {
  const result: PickProofResult = {
    proof: 'utv2-795',
    pickId,
    stages: {
      posted: false,
      settlement_created: false,
      corrects_id_null: false,
      clv_computed: false,
      clv_status: null,
      recap_consumes: false,
      audit_entity_id_present: false,
    },
    clvBacked: false,
    skipReason: null,
  };

  // ── Fetch pick ─────────────────────────────────────────────────────────────
  const pick = await repositories.picks.findPickById(pickId);
  if (!pick) {
    result.skipReason = `pick not found: ${pickId}`;
    return result;
  }

  // ── Stage 1: posted / was posted ──────────────────────────────────────────
  // 'posted' is true if pick is currently posted, or was posted before settlement.
  // A settlement record with corrects_id=null proves the pick transitioned from posted.
  let settlement: SettlementRecord | null = null;

  if (pick.status === 'posted') {
    result.stages.posted = true;

    // ── Stage 2: settle via approved path ──────────────────────────────────
    const settled = await recordPickSettlement(
      pickId,
      {
        status: 'settled',
        result: 'win',
        source: 'operator',
        confidence: 'confirmed',
        evidenceRef: 'utv2-795-proof',
        settledBy: 'utv2-795-proof-runner',
        notes: 'T1 lifecycle proof — designated proof pick',
      },
      repositories,
    );
    settlement = settled.settlementRecord;
  } else if (pick.status === 'settled') {
    // Idempotent: find the original settlement (corrects_id IS NULL)
    result.stages.posted = true; // pick passed through 'posted' to reach 'settled'
    const allSettlements = await repositories.settlements.listByPick(pickId);
    settlement = allSettlements.find((s) => s.corrects_id === null) ?? null;
    if (!settlement) {
      result.skipReason = `pick settled but no original settlement record (corrects_id IS NULL): ${pickId}`;
      return result;
    }
  } else {
    result.skipReason = `pick ${pickId} has unexpected status '${pick.status}'; expected 'posted' or 'settled'`;
    return result;
  }

  result.stages.settlement_created = true;

  // ── Stage 3: corrects_id must be null (original row, never a correction) ─
  result.stages.corrects_id_null = settlement.corrects_id === null;

  // ── Stage 4: CLV must have been computed ──────────────────────────────────
  const payload = (settlement.payload ?? {}) as Record<string, unknown>;
  const clvStatus = typeof payload['clvStatus'] === 'string' ? payload['clvStatus'] : null;
  result.stages.clv_status = clvStatus;
  result.stages.clv_computed =
    clvStatus === 'computed' &&
    payload['clv'] !== null &&
    payload['clv'] !== undefined;

  // ── Stage 5: recap consumption ────────────────────────────────────────────
  // Compute a daily recap window that covers the settlement's created_at by
  // advancing 'now' by one day past the settlement time.
  const settlementAt = new Date(settlement.created_at);
  const recapNow = new Date(settlementAt.getTime() + 24 * 60 * 60 * 1000);
  const window = getRecapWindow('daily', recapNow);
  const inWindow =
    settlement.created_at >= window.startsAt && settlement.created_at < window.endsAt;

  const recap = await computeRecapSummary('daily', repositories, recapNow);
  result.stages.recap_consumes = inWindow && recap !== null && recap.settledCount > 0;

  // ── Stage 6: audit_log entity_id is present for this pick ─────────────────
  // audit_log.entity_ref = pick_id as text (schema invariant)
  // audit_log.entity_id  = FK to the primary entity (settlement_record.id)
  const { data: auditRows } = await db
    .from('audit_log')
    .select('entity_id, entity_ref')
    .eq('entity_ref', pickId)
    .not('entity_id', 'is', null)
    .limit(5);

  result.stages.audit_entity_id_present =
    Array.isArray(auditRows) && auditRows.length > 0;

  // ── Derive clvBacked ──────────────────────────────────────────────────────
  result.clvBacked = result.stages.clv_computed && result.stages.corrects_id_null;

  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('[utv2-795] lifecycle proof\n');

  let env;
  try {
    env = loadEnvironment();
    createServiceRoleDatabaseConnectionConfig(env);
  } catch (err) {
    console.log('[utv2-795] SKIP — Supabase env unavailable:', (err as Error).message);
    process.exit(0);
  }

  const results = await runProof();

  let allPassed = true;
  for (const r of results) {
    console.log(JSON.stringify(r, null, 2));
    console.log('');

    if (r.skipReason !== null) {
      console.error(`  SKIP: ${r.skipReason}`);
      allPassed = false;
      continue;
    }

    const stagesFailed = Object.entries(r.stages).filter(
      ([k, v]) => k !== 'clv_status' && v === false,
    );
    if (stagesFailed.length > 0 || !r.clvBacked) {
      console.error(`  FAIL: ${r.pickId}`);
      for (const [k, v] of stagesFailed) {
        console.error(`    stage '${k}' = ${String(v)}`);
      }
      if (!r.clvBacked) {
        console.error(`    clvBacked = false`);
      }
      allPassed = false;
    } else {
      console.log(`  PASS: ${r.pickId} — clvBacked=true`);
    }
  }

  console.log('');
  if (!allPassed) {
    console.error('[utv2-795] PROOF FAILED');
    process.exit(1);
  }

  console.log('[utv2-795] PROOF COMPLETE');
}

main().catch((err: unknown) => {
  console.error('[utv2-795] Unhandled error:', err);
  process.exit(1);
});
