/**
 * ops:cert-check (UTV2-1099)
 *
 * CI gate: verifies that no active certification domain has an unsatisfied
 * upstream dependency. Exits nonzero if any violation is detected.
 *
 * Usage:
 *   pnpm ops:cert-check                    # check P1 (default)
 *   pnpm ops:cert-check --program P2       # check specific program
 *   pnpm ops:cert-check --json             # emit structured JSON
 */

import { createClient } from '@supabase/supabase-js';
import {
  dependentGateChecker,
  CERTIFICATION_DOMAINS,
  type ProgramId,
  type CertificationDomain,
  type CertificationRecord,
} from '../../packages/invariants/src/certification/index.js';

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const programArg = args[args.indexOf('--program') + 1] as ProgramId | undefined;
const programId: ProgramId = programArg ?? 'P1';

// ---------------------------------------------------------------------------
// Supabase connection
// ---------------------------------------------------------------------------

function createDb() {
  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) {
    console.error('[cert-check] FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    process.exit(2);
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

// ---------------------------------------------------------------------------
// DB query — most-recent record per domain for a program
// ---------------------------------------------------------------------------

interface DbCertRecord {
  id: string;
  program_id: string;
  domain: string;
  status: string;
  evidence_sha: string;
  merge_sha: string;
  transitioned_at: string;
  transitioned_by: string;
  transition_reason: string;
  expires_at: string | null;
  revocation_trigger: string | null;
  predecessor_id: string | null;
  created_at: string;
}

function toRecord(row: DbCertRecord): CertificationRecord {
  return {
    id: row.id,
    programId: row.program_id as ProgramId,
    domain: row.domain as CertificationDomain,
    status: row.status as CertificationRecord['status'],
    evidenceSha: row.evidence_sha,
    mergeSha: row.merge_sha,
    transitionedAt: row.transitioned_at,
    transitionedBy: row.transitioned_by,
    transitionReason: row.transition_reason,
    expiresAt: row.expires_at,
    revocationTrigger: row.revocation_trigger as CertificationRecord['revocationTrigger'],
    predecessorId: row.predecessor_id,
    createdAt: row.created_at,
  };
}

async function fetchCurrentRecords(
  db: ReturnType<typeof createClient>,
  program: ProgramId,
): Promise<Partial<Record<CertificationDomain, CertificationRecord>>> {
  const records: Partial<Record<CertificationDomain, CertificationRecord>> = {};

  // Fetch the most-recent record per domain using a window-function-style query.
  // We use ORDER BY transitioned_at DESC and take LIMIT 1 per domain.
  const domainResults = await Promise.all(
    CERTIFICATION_DOMAINS.map(async (domain) => {
      const { data, error } = await db
        .from('certification_records')
        .select('*')
        .eq('program_id', program)
        .eq('domain', domain)
        .order('transitioned_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw new Error(`cert-check: DB error fetching ${domain}: ${error.message}`);
      }
      return { domain, row: data as DbCertRecord | null };
    }),
  );

  for (const { domain, row } of domainResults) {
    if (row) {
      records[domain] = toRecord(row);
    }
  }

  return records;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const db = createDb();
  const now = new Date().toISOString();

  let allCurrentRecords: Partial<Record<CertificationDomain, CertificationRecord>>;
  try {
    allCurrentRecords = await fetchCurrentRecords(db, programId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[cert-check] DB fetch failed: ${msg}`);
    process.exit(2);
  }

  const result = dependentGateChecker.checkProgramGates(programId, allCurrentRecords, now);

  if (jsonMode) {
    console.log(JSON.stringify({
      schema_version: 1,
      generated_at: now,
      program_id: programId,
      all_satisfied: result.allSatisfied,
      violations: result.violations,
      active_domains: CERTIFICATION_DOMAINS.filter(d => allCurrentRecords[d]?.status === 'active'),
      pending_domains: CERTIFICATION_DOMAINS.filter(d => allCurrentRecords[d]?.status === 'pending'),
      absent_domains: CERTIFICATION_DOMAINS.filter(d => !allCurrentRecords[d]),
    }, null, 2));
  } else {
    console.log(`\n[cert-check] Program: ${programId}  |  Checked: ${now}`);
    console.log(`\nDomain status:`);
    for (const domain of CERTIFICATION_DOMAINS) {
      const record = allCurrentRecords[domain];
      const status = record?.status ?? 'absent';
      console.log(`  ${domain.padEnd(16)} ${status}`);
    }

    if (result.violations.length === 0) {
      console.log('\n✅ All active domain dependency gates satisfied.');
    } else {
      console.log(`\n❌ GATE VIOLATIONS (${result.violations.length}):`);
      for (const v of result.violations) {
        console.log(`\n  Domain: ${v.domain}`);
        for (const b of v.blockers) {
          console.log(`    dep "${b.dependency}" → ${b.reason} (${b.status})`);
        }
      }
      console.log('\n[cert-check] FAIL — dependent-gate violations detected. Certification denied.');
    }
  }

  // Exit nonzero if gates are unsatisfied — this is the CI gate behavior
  process.exit(result.allSatisfied ? 0 : 1);
}

main().catch((err) => {
  console.error('[cert-check] Unexpected error:', err);
  process.exit(2);
});
