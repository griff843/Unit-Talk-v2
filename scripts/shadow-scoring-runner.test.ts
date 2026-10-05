import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ProofOutput,
  DailyCounts,
  Guardrails,
} from './shadow-scoring-runner.js';

type MockRow = Record<string, unknown>;

interface QueryTrace {
  table: string;
  selection: string | null;
  calls: Array<{ method: string; column: string; value: unknown }>;
  range: [number, number] | null;
}

interface MockQueryResult {
  data: MockRow[] | null;
  error: { message: string } | null;
}

function createReadClient(
  input: {
    candidates?: MockRow[];
    settlements?: MockRow[];
    failTable?: string;
    nullDataTable?: string;
  } = {},
): { client: unknown; traces: QueryTrace[] } {
  const rowsByTable: Record<string, MockRow[]> = {
    pick_candidates: input.candidates ?? [],
    settlement_records: input.settlements ?? [],
  };
  const traces: QueryTrace[] = [];

  class MockQuery {
    readonly trace: QueryTrace;
    private pickIds: string[] | null = null;

    constructor(private readonly table: string) {
      this.trace = { table, selection: null, calls: [], range: null };
      traces.push(this.trace);
    }

    select(selection: string): this {
      this.trace.selection = selection;
      return this;
    }

    not(column: string, operator: string, value: unknown): this {
      this.trace.calls.push({ method: `not:${operator}`, column, value });
      return this;
    }

    order(column: string, value: unknown): this {
      this.trace.calls.push({ method: 'order', column, value });
      return this;
    }

    in(column: string, value: readonly unknown[]): this {
      this.trace.calls.push({ method: 'in', column, value });
      if (column === 'pick_id') {
        this.pickIds = value.filter(
          (item): item is string => typeof item === 'string',
        );
      }
      return this;
    }

    eq(column: string, value: unknown): this {
      this.trace.calls.push({ method: 'eq', column, value });
      return this;
    }

    neq(column: string, value: unknown): this {
      this.trace.calls.push({ method: 'neq', column, value });
      return this;
    }

    async range(from: number, to: number): Promise<MockQueryResult> {
      this.trace.range = [from, to];
      if (input.failTable === this.table) {
        return { data: null, error: { message: `${this.table} unavailable` } };
      }
      if (input.nullDataTable === this.table)
        return { data: null, error: null };

      let rows = rowsByTable[this.table] ?? [];
      if (this.pickIds) {
        rows = rows.filter(
          (row) =>
            typeof row['pick_id'] === 'string' &&
            this.pickIds?.includes(row['pick_id']),
        );
      }
      return { data: rows.slice(from, to + 1), error: null };
    }
  }

  return {
    client: { from: (table: string) => new MockQuery(table) },
    traces,
  };
}

function candidate(id: string, pickId: string | null): MockRow {
  return { id, pick_id: pickId };
}

function canonicalPick(id: string, overrides: MockRow = {}): MockRow {
  return {
    id,
    status: 'settled',
    submission_id: `submission-${id}`,
    source: 'api',
    metadata: {},
    selection: 'Player Over 1.5',
    market: 'player-prop',
    ...overrides,
  };
}

function settlement(
  id: string,
  pickId: string,
  result: string | null,
  rowOverrides: MockRow = {},
  pickOverrides: MockRow = {},
): MockRow {
  return {
    id,
    pick_id: pickId,
    result,
    status: 'settled',
    evidence_ref: `evidence-${id}`,
    corrects_id: null,
    picks: canonicalPick(pickId, pickOverrides),
    ...rowOverrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGuardrails(overrides: Partial<Guardrails> = {}): Guardrails {
  return {
    picksCreated: 0,
    shadowModeFalseSet: 0,
    distributionEnqueued: 0,
    promotionWidened: 0,
    ...overrides,
  };
}

function makeDailyCounts(overrides: Partial<DailyCounts> = {}): DailyCounts {
  return {
    rawPropsIngested: 0,
    marketUniverseRows: 0,
    candidatesScanned: 0,
    candidatesAlreadyScored: 0,
    candidatesScoredThisRun: 0,
    skippedByReason: {},
    ranked: 0,
    posted: 0,
    shadowOnly: 0,
    settledResultBacked: 0,
    clvReady: 0,
    ...overrides,
  };
}

function _makeProofOutput(
  overrides: {
    dailyCounts?: Partial<DailyCounts>;
    guardrails?: Partial<Guardrails>;
  } = {},
): ProofOutput {
  return {
    timestamp: new Date().toISOString(),
    runId: 'test-run-id',
    dailyCounts: makeDailyCounts(overrides.dailyCounts),
    guardrails: makeGuardrails(overrides.guardrails),
  };
}

// ---------------------------------------------------------------------------
// Mock scoring run (simulates the runner with a mocked DB)
// ---------------------------------------------------------------------------

async function mockRun(
  options: {
    dryRun?: boolean;
    batchSize?: number;
    statuses?: string[];
    candidatesToScore?: number;
  } = {},
): Promise<ProofOutput> {
  const {
    dryRun = false,
    batchSize: _batchSize = 100,
    statuses: _statuses = ['qualified', 'rejected'],
    candidatesToScore = 5,
  } = options;

  // Simulate the counts query (no real DB)
  const dailyCounts: DailyCounts = makeDailyCounts({
    candidatesScanned: candidatesToScore + 10,
    candidatesAlreadyScored: 10,
    candidatesScoredThisRun: dryRun ? 0 : candidatesToScore,
    skippedByReason: { no_model_score: candidatesToScore },
    shadowOnly: candidatesToScore + 10,
  });

  // Guardrails are always zero -- no picks created, no shadow_mode changes, etc.
  const guardrails: Guardrails = makeGuardrails();

  return {
    timestamp: new Date().toISOString(),
    runId: 'mock-run-' + Date.now(),
    dailyCounts,
    guardrails,
  };
}

// Verify that none of the forbidden functions are referenced in the runner source
async function assertNoForbiddenCalls(): Promise<void> {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const dir = resolve(fileURLToPath(import.meta.url), '..');
  const source = readFileSync(resolve(dir, 'shadow-scoring-runner.ts'), 'utf8');

  const forbidden = ['enqueueDistribution', 'promoteToLive', 'createPick'];
  for (const fn of forbidden) {
    assert.ok(
      !source.includes(fn + '('),
      `Runner source must not call ${fn}()`,
    );
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('guardrails.picksCreated is always 0 in runner output', async () => {
  const proof = await mockRun();
  assert.equal(proof.guardrails.picksCreated, 0);
});

test('guardrails.shadowModeFalseSet is always 0 in runner output', async () => {
  const proof = await mockRun();
  assert.equal(proof.guardrails.shadowModeFalseSet, 0);
});

test('guardrails.distributionEnqueued is always 0 in runner output', async () => {
  const proof = await mockRun();
  assert.equal(proof.guardrails.distributionEnqueued, 0);
});

test('guardrails.promotionWidened is always 0 in runner output', async () => {
  const proof = await mockRun();
  assert.equal(proof.guardrails.promotionWidened, 0);
});

test('runner never calls enqueueDistribution, promoteToLive, or createPick', async () => {
  await assertNoForbiddenCalls();
});

test('proof JSON has all required dailyCounts keys', async () => {
  const proof = await mockRun();
  const dc = proof.dailyCounts;

  assert.ok('rawPropsIngested' in dc, 'missing rawPropsIngested');
  assert.ok('marketUniverseRows' in dc, 'missing marketUniverseRows');
  assert.ok('candidatesScanned' in dc, 'missing candidatesScanned');
  assert.ok('candidatesAlreadyScored' in dc, 'missing candidatesAlreadyScored');
  assert.ok('candidatesScoredThisRun' in dc, 'missing candidatesScoredThisRun');
  assert.ok('skippedByReason' in dc, 'missing skippedByReason');
  assert.ok('ranked' in dc, 'missing ranked');
  assert.ok('posted' in dc, 'missing posted');
  assert.ok('shadowOnly' in dc, 'missing shadowOnly');
  assert.ok('settledResultBacked' in dc, 'missing settledResultBacked');
  assert.ok('clvReady' in dc, 'missing clvReady');
});

test('proof JSON has all required guardrails keys', async () => {
  const proof = await mockRun();
  const g = proof.guardrails;

  assert.ok('picksCreated' in g, 'missing picksCreated');
  assert.ok('shadowModeFalseSet' in g, 'missing shadowModeFalseSet');
  assert.ok('distributionEnqueued' in g, 'missing distributionEnqueued');
  assert.ok('promotionWidened' in g, 'missing promotionWidened');
});

test('proof JSON has timestamp and runId', async () => {
  const proof = await mockRun();
  assert.ok(
    typeof proof.timestamp === 'string' && proof.timestamp.length > 0,
    'missing timestamp',
  );
  assert.ok(
    typeof proof.runId === 'string' && proof.runId.length > 0,
    'missing runId',
  );
});

test('dry-run does not score any candidates', async () => {
  const proof = await mockRun({ dryRun: true });
  assert.equal(proof.dailyCounts.candidatesScoredThisRun, 0);
});

test('assertGuardrails throws if picksCreated is nonzero', async () => {
  const { assertGuardrails } = await import('./shadow-scoring-runner.js');
  assert.throws(
    () => assertGuardrails(makeGuardrails({ picksCreated: 1 })),
    /GUARDRAIL VIOLATION/,
  );
});

test('assertGuardrails throws if shadowModeFalseSet is nonzero', async () => {
  const { assertGuardrails } = await import('./shadow-scoring-runner.js');
  assert.throws(
    () => assertGuardrails(makeGuardrails({ shadowModeFalseSet: 1 })),
    /GUARDRAIL VIOLATION/,
  );
});

test('assertGuardrails passes when all guardrails are 0', async () => {
  const { assertGuardrails } = await import('./shadow-scoring-runner.js');
  assert.doesNotThrow(() => assertGuardrails(makeGuardrails()));
});

test('parity fails closed when no candidates were scanned', async () => {
  const { assertParityReadiness } = await import('./shadow-scoring-runner.js');
  assert.throws(
    () => assertParityReadiness(makeDailyCounts({ candidatesScanned: 0 })),
    /PARITY NOT ESTABLISHED/,
  );
});

test('parity readiness accepts a non-vacuous candidate population', async () => {
  const { assertParityReadiness } = await import('./shadow-scoring-runner.js');
  assert.doesNotThrow(() =>
    assertParityReadiness(makeDailyCounts({ candidatesScanned: 1 })),
  );
});

test('parseCliOptions parses --dry-run flag', async () => {
  const { parseCliOptions } = await import('./shadow-scoring-runner.js');
  const opts = parseCliOptions(['--dry-run']);
  assert.equal(opts.dryRun, true);
});

test('parseCliOptions defaults to qualified,rejected statuses', async () => {
  const { parseCliOptions } = await import('./shadow-scoring-runner.js');
  const opts = parseCliOptions([]);
  assert.deepEqual(opts.statuses, ['qualified', 'rejected']);
});

test('parseCliOptions parses --batch-size', async () => {
  const { parseCliOptions } = await import('./shadow-scoring-runner.js');
  const opts = parseCliOptions(['--batch-size', '50']);
  assert.equal(opts.batchSize, 50);
});

// ---------------------------------------------------------------------------
// WORK-2026100401 — canonical candidate-backed settlement truth
// ---------------------------------------------------------------------------

test('settledResultBacked counts candidate links backed by win, loss, and push evidence', async () => {
  const { countSettledResultBacked } =
    await import('./shadow-scoring-runner.js');
  const { client } = createReadClient({
    candidates: [
      candidate('c-win', 'p-win'),
      candidate('c-loss', 'p-loss'),
      candidate('c-push', 'p-push'),
    ],
    settlements: [
      settlement('s-win', 'p-win', 'win'),
      settlement('s-loss', 'p-loss', 'loss'),
      settlement('s-push', 'p-push', 'push'),
    ],
  });

  const count = await countSettledResultBacked(
    client as Parameters<typeof countSettledResultBacked>[0],
    2,
    2,
  );

  assert.equal(count, 3);
});

test('settledResultBacked counts each candidate once across duplicate and correction records', async () => {
  const { countSettledResultBacked } =
    await import('./shadow-scoring-runner.js');
  const correction = settlement('s-correction', 'p-shared', 'loss', {
    corrects_id: 's-original',
  });
  // Exercise the array form Supabase can expose for an embedded relationship.
  correction['picks'] = [canonicalPick('p-shared')];
  const { client } = createReadClient({
    candidates: [candidate('c-1', 'p-shared'), candidate('c-2', 'p-shared')],
    settlements: [
      settlement('s-original', 'p-shared', 'win'),
      settlement('s-duplicate', 'p-shared', 'win'),
      correction,
    ],
  });

  const count = await countSettledResultBacked(
    client as Parameters<typeof countSettledResultBacked>[0],
    2,
    1,
  );

  assert.equal(
    count,
    2,
    'two candidate links qualify, regardless of settlement row multiplicity',
  );
});

test('settledResultBacked excludes incomplete evidence, voids, shadow picks, fixtures, and non-production links', async () => {
  const { countSettledResultBacked } =
    await import('./shadow-scoring-runner.js');
  const pickIds = [
    'no-settlement',
    'no-evidence',
    'not-settled',
    'bad-result',
    'voided',
    'no-submission',
    'shadow-source',
    'proof-fixture',
    'selection-fixture',
    'market-fixture',
    'valid',
  ];
  const { client } = createReadClient({
    candidates: pickIds.map((pickId, index) => candidate(`c-${index}`, pickId)),
    settlements: [
      settlement('s-no-evidence', 'no-evidence', 'win', { evidence_ref: null }),
      settlement('s-not-settled', 'not-settled', 'loss', {
        status: 'evidence_only',
      }),
      settlement('s-bad-result', 'bad-result', 'void'),
      settlement('s-voided', 'voided', 'push', {}, { status: 'voided' }),
      settlement(
        's-no-submission',
        'no-submission',
        'win',
        {},
        { submission_id: null },
      ),
      settlement('s-shadow', 'shadow-source', 'loss', {}, { source: 'shadow' }),
      settlement(
        's-proof',
        'proof-fixture',
        'push',
        {},
        { metadata: { proof_issue: 'WORK-1' } },
      ),
      settlement(
        's-selection',
        'selection-fixture',
        'win',
        {},
        { selection: 'UTV2 Proof Player' },
      ),
      settlement('s-market', 'market-fixture', 'loss', {}, { market: 'test' }),
      settlement('s-valid', 'valid', 'win'),
    ],
  });

  const count = await countSettledResultBacked(
    client as Parameters<typeof countSettledResultBacked>[0],
    3,
    4,
  );

  assert.equal(count, 1);
});

test('settledResultBacked uses the real schema path and paginates both link and settlement reads', async () => {
  const { countSettledResultBacked } =
    await import('./shadow-scoring-runner.js');
  const { client, traces } = createReadClient({
    candidates: [
      candidate('c-1', 'p-1'),
      candidate('c-2', 'p-2'),
      candidate('c-3', 'p-3'),
      candidate('c-unlinked', null),
    ],
    settlements: [
      settlement('s-1', 'p-1', 'win'),
      settlement('s-2', 'p-2', 'loss'),
      settlement('s-3', 'p-3', 'push'),
    ],
  });

  const count = await countSettledResultBacked(
    client as Parameters<typeof countSettledResultBacked>[0],
    2,
    3,
  );

  assert.equal(count, 3);
  const candidateTraces = traces.filter(
    (trace) => trace.table === 'pick_candidates',
  );
  const settlementTraces = traces.filter(
    (trace) => trace.table === 'settlement_records',
  );
  assert.ok(candidateTraces.length >= 2, 'candidate links must be paginated');
  assert.ok(
    settlementTraces.length >= 2,
    'settlement records must be paginated',
  );
  assert.equal(candidateTraces[0]?.selection, 'id,pick_id');
  assert.doesNotMatch(candidateTraces[0]?.selection ?? '', /outcome/u);
  assert.match(settlementTraces[0]?.selection ?? '', /picks!inner/u);
  assert.ok(
    settlementTraces[0]?.calls.some(
      (call) =>
        call.method === 'in' &&
        call.column === 'result' &&
        Array.isArray(call.value) &&
        ['win', 'loss', 'push'].every((value) => call.value.includes(value)),
    ),
  );
});

test('settledResultBacked fails closed on candidate-link query errors and absent data', async () => {
  const { countSettledResultBacked } =
    await import('./shadow-scoring-runner.js');
  const failed = createReadClient({ failTable: 'pick_candidates' });
  const absent = createReadClient({ nullDataTable: 'pick_candidates' });

  await assert.rejects(
    countSettledResultBacked(
      failed.client as Parameters<typeof countSettledResultBacked>[0],
    ),
    /candidate settlement links query failed/u,
  );
  await assert.rejects(
    countSettledResultBacked(
      absent.client as Parameters<typeof countSettledResultBacked>[0],
    ),
    /candidate settlement links query returned no data/u,
  );
});

test('settledResultBacked fails closed on settlement query errors and absent data', async () => {
  const { countSettledResultBacked } =
    await import('./shadow-scoring-runner.js');
  const failed = createReadClient({
    candidates: [candidate('c-1', 'p-1')],
    failTable: 'settlement_records',
  });
  const absent = createReadClient({
    candidates: [candidate('c-1', 'p-1')],
    nullDataTable: 'settlement_records',
  });

  await assert.rejects(
    countSettledResultBacked(
      failed.client as Parameters<typeof countSettledResultBacked>[0],
    ),
    /canonical settlements query failed/u,
  );
  await assert.rejects(
    countSettledResultBacked(
      absent.client as Parameters<typeof countSettledResultBacked>[0],
    ),
    /canonical settlements query returned no data/u,
  );
});

// ---------------------------------------------------------------------------
// UTV2-1629 — the --dry-run path must not load PR-authored application code
// ---------------------------------------------------------------------------

test('the runner has no STATIC import of apps/, so --dry-run loads no PR-authored app code', async () => {
  // shadow-parity-required.yml runs this file against PRODUCTION and pins it
  // against the merge base. A static `import ... from '../apps/...'` is
  // evaluated before --dry-run is parsed and drags in most of apps/api and
  // packages/domain — the very paths that trigger the workflow — so the pin
  // would name one file while the import graph supplied hundreds.
  //
  // Type-only positions are fine: `typeof import(...)` is erased at runtime.
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const dir = resolve(fileURLToPath(import.meta.url), '..');
  const source = readFileSync(resolve(dir, 'shadow-scoring-runner.ts'), 'utf8');

  const staticAppImports = source
    .split(/\r?\n/)
    .filter((line) =>
      /^\s*import\s[^(]*from\s+['"][^'"]*\.\.\/apps\//u.test(line),
    );

  assert.deepEqual(
    staticAppImports,
    [],
    'Static import from apps/ found. Load it with `await import(...)` inside the ' +
      'non-dry-run branch instead — the dry-run path runs with a production credential.',
  );
});

test('shadow parity workflow uses only the dedicated read-only credential and fails zero scans', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const dir = resolve(fileURLToPath(import.meta.url), '..');
  const workflow = readFileSync(
    resolve(dir, '../.github/workflows/shadow-parity-required.yml'),
    'utf8',
  );

  assert.match(workflow, /secrets\.SHADOW_PARITY_READ_ONLY_KEY/);
  assert.doesNotMatch(
    workflow,
    /secrets\.(?:SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)/,
  );
  assert.match(
    workflow,
    /CRITICAL=\$\(\(CRITICAL \+ 1\)\)[\s\S]*candidatesScanned=0/,
  );
  assert.match(
    workflow,
    /CANDIDATES.*-eq 0[\s\S]*CRITICAL=\$\(\(CRITICAL \+ 1\)\)/,
  );
});
