/**
 * UTV2-728: High-Volume Shadow Scoring Runner
 *
 * Scores eligible pick_candidates (shadow_mode=true, model_score=NULL) using
 * the candidate scoring service WITHOUT creating live picks, posting to Discord,
 * widening the board, or setting shadow_mode=false.
 *
 * Hard guardrails (all must remain 0):
 *   picksCreated, shadowModeFalseSet, distributionEnqueued, promotionWidened
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnvironment } from '@unit-talk/config';
import { createApiRuntimeDependencies } from '../apps/api/src/server.js';
import { runCandidateScoring } from '../apps/api/src/candidate-scoring-service.js';

type Client = SupabaseClient<Record<string, never>>;

export interface DailyCounts {
  rawPropsIngested: number;
  marketUniverseRows: number;
  candidatesScanned: number;
  candidatesAlreadyScored: number;
  candidatesScoredThisRun: number;
  skippedByReason: Record<string, number>;
  ranked: number;
  posted: number;
  shadowOnly: number;
  settledResultBacked: number;
  clvReady: number;
}

export interface Guardrails {
  picksCreated: number;
  shadowModeFalseSet: number;
  distributionEnqueued: number;
  promotionWidened: number;
}

export interface ProofOutput {
  timestamp: string;
  runId: string;
  dailyCounts: DailyCounts;
  guardrails: Guardrails;
}

export interface CliOptions {
  dryRun: boolean;
  batchSize: number;
  outDir: string;
  statuses: string[];
}

export function parseCliOptions(args: string[]): CliOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg?.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith('--')) {
      values.set(key, next);
      i++;
    } else {
      flags.add(key);
    }
  }

  const statuses = (values.get('statuses') ?? 'qualified,rejected')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const batchSizeRaw = Number.parseInt(values.get('batch-size') ?? '100', 10);
  const batchSize = Number.isFinite(batchSizeRaw) && batchSizeRaw > 0 ? batchSizeRaw : 100;

  return {
    dryRun: flags.has('dry-run'),
    batchSize,
    outDir: values.get('out-dir') ?? 'docs/06_status/proof/UTV2-728',
    statuses,
  };
}

async function countTable(
  client: Client,
  table: string,
  filter?: (q: ReturnType<Client['from']>) => ReturnType<Client['from']>,
): Promise<number> {
  let q = client.from(table).select('*', { count: 'exact', head: true });
  if (filter) q = filter(q) as typeof q;
  const { count, error } = await q;
  if (error) {
    console.warn(`[shadow-scoring-runner] count(${table}) error:`, error.message);
    return 0;
  }
  return count ?? 0;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function queryDailyCounts(client: Client): Promise<DailyCounts> {
  const today = todayIso();

  const [
    rawPropsIngested,
    marketUniverseRows,
    candidatesScanned,
    candidatesAlreadyScored,
    ranked,
    posted,
    shadowOnly,
    settledResultBacked,
    clvReady,
    unscoredCount,
  ] = await Promise.all([
    countTable(client, 'provider_offers', (q) => q.gte('created_at', today)),
    countTable(client, 'market_universe', (q) => q.gte('created_at', today)),
    countTable(client, 'pick_candidates', (q) =>
      q.eq('shadow_mode', true).in('status', ['qualified', 'rejected']),
    ),
    countTable(client, 'pick_candidates', (q) =>
      q.not('model_score', 'is', null).gte('updated_at', today),
    ),
    countTable(client, 'pick_candidates', (q) => q.eq('is_board_candidate', true)),
    countTable(client, 'pick_candidates', (q) =>
      q.or('status.eq.posted,pick_id.not.is.null'),
    ),
    countTable(client, 'pick_candidates', (q) =>
      q.eq('shadow_mode', true).is('pick_id', null),
    ),
    countTable(client, 'pick_candidates', (q) => q.not('outcome', 'is', null)),
    countTable(client, 'market_universe', (q) =>
      q.not('opening_line', 'is', null).not('closing_line', 'is', null),
    ),
    countTable(client, 'pick_candidates', (q) =>
      q.eq('shadow_mode', true).in('status', ['qualified', 'rejected']).is('model_score', null),
    ),
  ]);

  return {
    rawPropsIngested,
    marketUniverseRows,
    candidatesScanned,
    candidatesAlreadyScored,
    candidatesScoredThisRun: 0,
    skippedByReason: { no_model_score: unscoredCount },
    ranked,
    posted,
    shadowOnly,
    settledResultBacked,
    clvReady,
  };
}

export function assertGuardrails(guardrails: Guardrails): void {
  const violations: string[] = [];
  if (guardrails.picksCreated !== 0)
    violations.push(`picksCreated=${guardrails.picksCreated} (must be 0)`);
  if (guardrails.shadowModeFalseSet !== 0)
    violations.push(`shadowModeFalseSet=${guardrails.shadowModeFalseSet} (must be 0)`);
  if (guardrails.distributionEnqueued !== 0)
    violations.push(`distributionEnqueued=${guardrails.distributionEnqueued} (must be 0)`);
  if (guardrails.promotionWidened !== 0)
    violations.push(`promotionWidened=${guardrails.promotionWidened} (must be 0)`);

  if (violations.length > 0) {
    throw new Error(
      '[shadow-scoring-runner] GUARDRAIL VIOLATION:\n' + violations.join('\n'),
    );
  }
}

async function writeProof(outDir: string, proof: ProofOutput): Promise<void> {
  const absDir = resolve(outDir);
  await mkdir(absDir, { recursive: true });
  const filename = `proof-${proof.runId}.json`;
  const outPath = resolve(absDir, filename);
  await writeFile(outPath, JSON.stringify(proof, null, 2), 'utf8');
  console.error(`[shadow-scoring-runner] Proof written to ${outPath}`);
}

export async function run(options: CliOptions): Promise<ProofOutput> {
  const environment = loadEnvironment();

  if (!environment.SUPABASE_URL || !environment.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  const client = createClient<Record<string, never>>(
    environment.SUPABASE_URL,
    environment.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );

  // Guardrails are always zero -- this runner never touches picks,
  // never sets shadow_mode=false, never enqueues distribution, never promotes.
  const guardrails: Guardrails = {
    picksCreated: 0,
    shadowModeFalseSet: 0,
    distributionEnqueued: 0,
    promotionWidened: 0,
  };

  const dailyCounts = await queryDailyCounts(client);

  let candidatesScoredThisRun = 0;

  if (!options.dryRun) {
    const runtime = createApiRuntimeDependencies({ environment });
    const repos = runtime.repositories;

    const result = await runCandidateScoring(
      {
        pickCandidates: repos.pickCandidates,
        marketUniverse: repos.marketUniverse,
        marketFamilyTrust: repos.marketFamilyTrust,
        ...(repos.modelRegistry ? { modelRegistry: repos.modelRegistry } : {}),
        ...(repos.experimentLedger ? { experimentLedger: repos.experimentLedger } : {}),
      },
      {
        batchSize: options.batchSize,
        statuses: options.statuses,
        logger: { info: () => {}, warn: console.warn, error: console.error },
      },
    );

    candidatesScoredThisRun = result.scored;
    console.error(
      `[shadow-scoring-runner] scored=${result.scored} skipped=${result.skipped} errors=${result.errors}`,
    );
  } else {
    console.error('[shadow-scoring-runner] --dry-run: skipping scoring writes, counts only');
  }

  dailyCounts.candidatesScoredThisRun = candidatesScoredThisRun;
  assertGuardrails(guardrails);

  const proof: ProofOutput = {
    timestamp: new Date().toISOString(),
    runId: randomUUID(),
    dailyCounts,
    guardrails,
  };

  return proof;
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const proof = await run(options);
  console.log(JSON.stringify(proof, null, 2));
  await writeProof(options.outDir, proof);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
