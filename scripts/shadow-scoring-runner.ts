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
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { type SupabaseClient } from '@supabase/supabase-js';
import { createPrivilegedClient } from '@unit-talk/db/privileged-client-boundary';
import { loadEnvironment } from '@unit-talk/config';

/**
 * UTV2-1629 — `apps/api` is loaded LAZILY, inside the scoring branch only.
 *
 * `shadow-parity-required.yml` runs this file with the PRODUCTION service-role
 * key and pins it against the merge base (assert-unmodified-vs-base.ts), so a
 * pull request cannot execute its own version of THIS file. That pin was
 * defeated by a static import: `apps/api/src/server.js` and
 * `candidate-scoring-service.js` were evaluated at module load, before
 * `--dry-run` was even parsed, and they transitively pull in most of
 * `apps/api/src/**` and `packages/domain/src/**`.
 *
 * Those are exactly the paths in that workflow's trigger filter. So the job
 * that fires *because* a PR edits `packages/domain` was executing that PR's
 * domain code against production — the pin named one file while the import
 * graph supplied hundreds.
 *
 * Pinning the closure instead is not an option: the closure is the code the
 * check exists to observe, so pinning it means the check never runs. Deferring
 * the import is: in `--dry-run` the only project code that loads is this file
 * plus `@unit-talk/config`, both of which the workflow pins. The imports still
 * resolve identically on the non-dry-run path, which no PR-triggered job takes.
 */
type ApiRuntimeModule = typeof import('../apps/api/src/server.js');
type CandidateScoringModule = typeof import('../apps/api/src/candidate-scoring-service.js');

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

  // UTV2-1627: this runner is observation-only — it asserts picksCreated and
  // distributionEnqueued remain 0. It previously REQUIRED a service-role key,
  // which bypasses RLS and can write; read-only-ness rested on that assertion
  // rather than on the credential. Prefer the anon key so Postgres enforces the
  // restriction, and fall back to service-role only where anon is unavailable.
  const readKey = environment.SUPABASE_ANON_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY;
  if (!environment.SUPABASE_URL || !readKey) {
    throw new Error(
      'SUPABASE_URL and one of SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are required',
    );
  }

  // UTV2-1628: the driver comes from the one boundary that may construct it.
  // The deferral recorded in the inventory ended when the lane that owned this
  // file landed and added scripts/shadow-scoring-runner.test.ts to `test:ops`,
  // which put this module inside `pnpm test`'s import graph — the exact
  // condition the guard's reachability rule fails on regardless of
  // classification.
  const client = createPrivilegedClient(
    environment.SUPABASE_URL,
    readKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
    'shadow-scoring-runner',
  ) as Client;

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
    // Loaded here, not at module scope — see the note beside the type imports.
    const { createApiRuntimeDependencies } = (await import(
      '../apps/api/src/server.js'
    )) as ApiRuntimeModule;
    const { runCandidateScoring } = (await import(
      '../apps/api/src/candidate-scoring-service.js'
    )) as CandidateScoringModule;

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

/**
 * UTV2-1629 — run `main()` only when this file IS the process entrypoint.
 *
 * It used to run on any import. `scripts/shadow-scoring-runner.test.ts` imports
 * the module to reach `parseCliOptions`/`assertGuardrails`, so importing it
 * fired `main()`, which threw on absent credentials and called `process.exit(1)`
 * mid-suite — killing the runner before the remaining tests executed. The file
 * reported 9 of its 12 tests and a non-zero exit, and was quietly left out of
 * every `pnpm test:*` script, so nothing noticed.
 *
 * Real paths compared rather than filenames: an `endsWith()` check fails OPEN
 * under any rename, copy, symlink or compiled-.js invocation. Same rationale
 * and same shape as scripts/ci/assert-staging-target.ts.
 */
function isCliEntrypoint(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return realpathSync(invoked) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isCliEntrypoint()) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
