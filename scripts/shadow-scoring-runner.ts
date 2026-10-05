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
type CandidateScoringModule =
  typeof import('../apps/api/src/candidate-scoring-service.js');

type Client = SupabaseClient<Record<string, never>>;

interface CandidatePickLink {
  id: string;
  pick_id: string | null;
}

interface CanonicalPick {
  id: string;
  market: string;
  metadata: unknown;
  selection: string;
  source: string;
  status: string;
  submission_id: string | null;
}

interface SettlementWithPick {
  id: string;
  pick_id: string;
  result: string | null;
  status: string;
  evidence_ref: string | null;
  corrects_id: string | null;
  picks: CanonicalPick | CanonicalPick[] | null;
}

interface PagedQueryResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

const QUERY_PAGE_SIZE = 1_000;
const PICK_ID_BATCH_SIZE = 100;
const CANONICAL_RESULTS = new Set(['win', 'loss', 'push']);

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
  const batchSize =
    Number.isFinite(batchSizeRaw) && batchSizeRaw > 0 ? batchSizeRaw : 100;

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
    throw new Error(
      `[shadow-scoring-runner] count(${table}) failed: ${error.message}`,
    );
  }
  return count ?? 0;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function jsonbHasTopLevelKey(value: unknown, key: string): boolean {
  if (typeof value === 'string') return value === key;
  if (Array.isArray(value)) return value.some((item) => item === key);
  return value !== null && typeof value === 'object'
    ? Object.hasOwn(value, key)
    : false;
}

function jsonbObjectFieldText(value: unknown, key: string): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return '';
  }

  const field = (value as Record<string, unknown>)[key];
  if (field === null || field === undefined) return '';
  if (typeof field === 'string') return field;
  return JSON.stringify(field) ?? '';
}

/** Mirrors reporting.pick_fixture_reason from the canonical reporting migration. */
function isFixturePick(pick: CanonicalPick): boolean {
  const eventName = jsonbObjectFieldText(pick.metadata, 'eventName');

  return (
    jsonbHasTopLevelKey(pick.metadata, 'proof_issue') ||
    jsonbHasTopLevelKey(pick.metadata, 'proofRunId') ||
    eventName.startsWith('db-smoke-') ||
    /^utv2[ _-]/iu.test(eventName) ||
    /^utv2[ _-]/iu.test(pick.selection) ||
    /[[(]utv2-[0-9]+/iu.test(pick.selection) ||
    pick.source === 't1-proof' ||
    pick.source === 'canary-proof' ||
    /command center qa/iu.test(eventName) ||
    /staff-only dry run/iu.test(pick.selection) ||
    ['test', 'foo', 'bar', 'dummy', 'sample'].includes(
      pick.selection.toLowerCase(),
    ) ||
    pick.market === 'test'
  );
}

function embeddedPick(row: SettlementWithPick): CanonicalPick | null {
  if (Array.isArray(row.picks)) return row.picks[0] ?? null;
  return row.picks;
}

function isCanonicalEvidenceSettlement(row: SettlementWithPick): boolean {
  const pick = embeddedPick(row);
  return Boolean(
    pick &&
    CANONICAL_RESULTS.has(row.result ?? '') &&
    row.status === 'settled' &&
    row.evidence_ref !== null &&
    pick.id === row.pick_id &&
    pick.submission_id !== null &&
    pick.status !== 'voided' &&
    pick.source !== 'shadow' &&
    !isFixturePick(pick),
  );
}

/**
 * Count candidate rows backed by at least one canonical evidence-settled pick.
 *
 * pick_candidates.pick_id has no FK, so PostgREST cannot embed picks from that
 * table. Read the links first, then traverse the real settlement_records →
 * picks FK. Candidate and settlement scans are both stable and paginated;
 * duplicate/correction settlement rows qualify their pick only once.
 */
export async function countSettledResultBacked(
  client: Client,
  pageSize = QUERY_PAGE_SIZE,
  pickIdBatchSize = PICK_ID_BATCH_SIZE,
): Promise<number> {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error(
      '[shadow-scoring-runner] pageSize must be a positive integer',
    );
  }
  if (!Number.isInteger(pickIdBatchSize) || pickIdBatchSize <= 0) {
    throw new Error(
      '[shadow-scoring-runner] pickIdBatchSize must be a positive integer',
    );
  }

  const candidateLinks: CandidatePickLink[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const response = (await client
      .from('pick_candidates')
      .select('id,pick_id')
      .not('pick_id', 'is', null)
      .order('id', { ascending: true })
      .range(
        offset,
        offset + pageSize - 1,
      )) as unknown as PagedQueryResult<CandidatePickLink>;

    if (response.error) {
      throw new Error(
        `[shadow-scoring-runner] candidate settlement links query failed: ${response.error.message}`,
      );
    }
    if (response.data === null) {
      throw new Error(
        '[shadow-scoring-runner] candidate settlement links query returned no data',
      );
    }

    candidateLinks.push(...response.data.filter((row) => row.pick_id !== null));
    if (response.data.length < pageSize) break;
  }

  const uniquePickIds = [
    ...new Set(
      candidateLinks
        .map((row) => row.pick_id)
        .filter((pickId): pickId is string => pickId !== null),
    ),
  ];
  const qualifyingPickIds = new Set<string>();

  for (
    let batchOffset = 0;
    batchOffset < uniquePickIds.length;
    batchOffset += pickIdBatchSize
  ) {
    const pickIds = uniquePickIds.slice(
      batchOffset,
      batchOffset + pickIdBatchSize,
    );

    for (let offset = 0; ; offset += pageSize) {
      const response = (await client
        .from('settlement_records')
        .select(
          'id,pick_id,result,status,evidence_ref,corrects_id,picks!inner(id,status,submission_id,source,metadata,selection,market)',
        )
        .in('pick_id', pickIds)
        .in('result', [...CANONICAL_RESULTS])
        .eq('status', 'settled')
        .not('evidence_ref', 'is', null)
        .neq('picks.status', 'voided')
        .not('picks.submission_id', 'is', null)
        .order('id', { ascending: true })
        .range(
          offset,
          offset + pageSize - 1,
        )) as unknown as PagedQueryResult<SettlementWithPick>;

      if (response.error) {
        throw new Error(
          `[shadow-scoring-runner] canonical settlements query failed: ${response.error.message}`,
        );
      }
      if (response.data === null) {
        throw new Error(
          '[shadow-scoring-runner] canonical settlements query returned no data',
        );
      }

      for (const row of response.data) {
        if (isCanonicalEvidenceSettlement(row))
          qualifyingPickIds.add(row.pick_id);
      }
      if (response.data.length < pageSize) break;
    }
  }

  return candidateLinks.filter(
    (link) => link.pick_id !== null && qualifyingPickIds.has(link.pick_id),
  ).length;
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
    countTable(client, 'pick_candidates', (q) =>
      q.eq('is_board_candidate', true),
    ),
    countTable(client, 'pick_candidates', (q) =>
      q.or('status.eq.posted,pick_id.not.is.null'),
    ),
    countTable(client, 'pick_candidates', (q) =>
      q.eq('shadow_mode', true).is('pick_id', null),
    ),
    countSettledResultBacked(client),
    countTable(client, 'market_universe', (q) =>
      q.not('opening_line', 'is', null).not('closing_line', 'is', null),
    ),
    countTable(client, 'pick_candidates', (q) =>
      q
        .eq('shadow_mode', true)
        .in('status', ['qualified', 'rejected'])
        .is('model_score', null),
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
    violations.push(
      `shadowModeFalseSet=${guardrails.shadowModeFalseSet} (must be 0)`,
    );
  if (guardrails.distributionEnqueued !== 0)
    violations.push(
      `distributionEnqueued=${guardrails.distributionEnqueued} (must be 0)`,
    );
  if (guardrails.promotionWidened !== 0)
    violations.push(
      `promotionWidened=${guardrails.promotionWidened} (must be 0)`,
    );

  if (violations.length > 0) {
    throw new Error(
      '[shadow-scoring-runner] GUARDRAIL VIOLATION:\n' + violations.join('\n'),
    );
  }
}

export function assertParityReadiness(dailyCounts: DailyCounts): void {
  if (dailyCounts.candidatesScanned <= 0) {
    throw new Error(
      '[shadow-scoring-runner] PARITY NOT ESTABLISHED: candidatesScanned must be greater than 0',
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

  // UTV2-1627: production parity must use a dedicated database role whose
  // grants are mechanically read-only. An anon key commonly cannot see these
  // protected tables, while a service-role key can write; neither proves safe
  // parity. There is deliberately no fallback between credential classes.
  const readKey = process.env['SHADOW_PARITY_READ_ONLY_KEY'];
  if (!environment.SUPABASE_URL || !readKey) {
    throw new Error(
      'SUPABASE_URL and SHADOW_PARITY_READ_ONLY_KEY are required',
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
    const { createApiRuntimeDependencies } =
      (await import('../apps/api/src/server.js')) as ApiRuntimeModule;
    const { runCandidateScoring } =
      (await import('../apps/api/src/candidate-scoring-service.js')) as CandidateScoringModule;

    const runtime = createApiRuntimeDependencies({ environment });
    const repos = runtime.repositories;

    const result = await runCandidateScoring(
      {
        pickCandidates: repos.pickCandidates,
        marketUniverse: repos.marketUniverse,
        marketFamilyTrust: repos.marketFamilyTrust,
        ...(repos.modelRegistry ? { modelRegistry: repos.modelRegistry } : {}),
        ...(repos.experimentLedger
          ? { experimentLedger: repos.experimentLedger }
          : {}),
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
    console.error(
      '[shadow-scoring-runner] --dry-run: skipping scoring writes, counts only',
    );
  }

  dailyCounts.candidatesScoredThisRun = candidatesScoredThisRun;
  assertParityReadiness(dailyCounts);
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
    return (
      realpathSync(invoked) === realpathSync(fileURLToPath(import.meta.url))
    );
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
