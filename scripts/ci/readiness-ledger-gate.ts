#!/usr/bin/env tsx
/**
 * UTV2-1626 — the two checks that make the readiness ledger mean something.
 *
 * ## `gate` mode (pull requests)
 *
 * The previous gate collapsed every failure into one red X. A 351-hour-old file
 * and a live production outage produced the same output, so the only rational
 * response to either was to ignore both. This mode returns a distinct code per
 * condition:
 *
 *   LEDGER_MISSING / LEDGER_INVALID  — the ledger is not usable at all
 *   LEDGER_STALE                     — the FILE is older than its own SLA
 *   DIMENSION_STALE                  — a blocking DIMENSION was not re-observed,
 *                                      even though the file looks fresh
 *   OBSERVER_DEGRADED                — a blocking dimension is unreadable; we do
 *                                      not know the production state
 *   READINESS_RED                    — production is measurably failing
 *   READINESS_YELLOW / GREEN         — pass
 *
 * The first four are OBSERVER failures: they say the ledger cannot be trusted, not
 * that production is broken. Only READINESS_RED asserts a product condition.
 *
 * ## `persistence` mode (the scheduled refresher)
 *
 * A scheduled job that "succeeds" without writing anything is the exact defect
 * this lane came from: 26 green runs, one 13-day-old artifact. This mode is run
 * AFTER the generator and refuses to let the run conclude successfully unless the
 * new ledger is a genuinely current observation — the timestamp advanced, the file
 * changed, and every dimension was observed inside this run's own window.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  FRESHNESS_CONTRACT,
  type ReadinessDimension,
  type ReadinessLedger,
} from '../ops/readiness-refresh.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

export type GateCode =
  | 'GREEN'
  | 'READINESS_YELLOW'
  | 'READINESS_RED'
  | 'OBSERVER_DEGRADED'
  | 'DIMENSION_STALE'
  | 'LEDGER_STALE'
  | 'LEDGER_INVALID'
  | 'LEDGER_MISSING';

export interface GateResult {
  code: GateCode;
  /** True when the failure is about the OBSERVER, not about production. */
  observer_failure: boolean;
  passed: boolean;
  age_hours: number | null;
  summary: string;
  details: string[];
  /** Stable blocking identities used to distinguish inherited debt from a worsened head. */
  blocking_findings: string[];
}

export interface RegressionResult {
  conclusion: 'success' | 'neutral' | 'failure';
  passed: boolean;
  summary: string;
  base: GateResult;
  head: GateResult;
}

const OBSERVER_FAILURE_CODES: ReadonlySet<GateCode> = new Set<GateCode>([
  'LEDGER_MISSING',
  'LEDGER_INVALID',
  'LEDGER_STALE',
  'DIMENSION_STALE',
  'OBSERVER_DEGRADED',
]);

export interface LedgerParse {
  ledger: ReadinessLedger | null;
  errors: string[];
}

/**
 * Structural validation only. A ledger that cannot be parsed into this shape is
 * refused rather than partially trusted — a half-read ledger is how a missing
 * field silently becomes a passing dimension.
 */
export function parseLedger(raw: string): LedgerParse {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    return { ledger: null, errors: [`not valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ledger: null, errors: ['top level is not an object'] };
  }

  const record = value as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof record['generated_at'] !== 'string') errors.push('generated_at is missing or not a string');
  if (typeof record['verdict'] !== 'string') errors.push('verdict is missing or not a string');
  if (!Array.isArray(record['dimensions'])) errors.push('dimensions is missing or not an array');

  const schemaVersion = record['schema_version'];
  if (typeof schemaVersion !== 'number') errors.push('schema_version is missing or not a number');

  if (errors.length > 0) return { ledger: null, errors };
  return { ledger: record as unknown as ReadinessLedger, errors: [] };
}

function ageHours(generatedAt: string, now: Date): number {
  return Math.round(((now.getTime() - new Date(generatedAt).getTime()) / 3_600_000) * 10) / 10;
}

function dimensionsOf(ledger: ReadinessLedger): ReadinessDimension[] {
  return Array.isArray(ledger.dimensions) ? ledger.dimensions : [];
}

/**
 * Evaluate a ledger for the pull-request gate.
 *
 * Order matters and is deliberate: trust questions are answered before product
 * questions. A stale ledger's RED is not evidence of a current RED, so reporting
 * it as READINESS_RED would be the same lie the old gate told.
 */
export function evaluateLedger(
  ledger: ReadinessLedger,
  now: Date,
  policy: { hardStaleHours?: number } = {},
): GateResult {
  const details: string[] = [];
  const hardStaleHours =
    policy.hardStaleHours ?? ledger.freshness?.hard_stale_hours ?? FRESHNESS_CONTRACT.hard_stale_hours;
  const age = ageHours(ledger.generated_at, now);

  details.push(`generated_at=${ledger.generated_at} (${age}h old, hard threshold ${hardStaleHours}h)`);
  details.push(`verdict=${ledger.verdict}, observability=${ledger.observability ?? 'unrecorded'}`);

  if (!Number.isFinite(age)) {
    return {
      code: 'LEDGER_INVALID',
      observer_failure: true,
      passed: false,
      age_hours: null,
      summary: `generated_at "${ledger.generated_at}" is not a readable timestamp`,
      details,
      blocking_findings: [],
    };
  }

  if (age > hardStaleHours) {
    return {
      code: 'LEDGER_STALE',
      observer_failure: true,
      passed: false,
      age_hours: age,
      summary:
        `The readiness ledger is ${age}h old (threshold ${hardStaleHours}h). This is an OBSERVER failure: ` +
        'the recorded verdict describes the past, not production now. Refresh it with `pnpm ops:readiness-refresh` ' +
        '(or re-run readiness-refresh.yml) before reading anything into the verdict.',
      details,
      blocking_findings: [],
    };
  }

  const dimensions = dimensionsOf(ledger);
  const blocking = dimensions.filter((dimension) => dimension.blocking);

  // A file-level timestamp can be advanced while a dimension inside it was not
  // re-observed. Per-dimension observation times are what make that detectable.
  const staleDimensions = blocking.filter((dimension) => {
    if (typeof dimension.observed_at !== 'string') return true;
    const observedAge = ageHours(dimension.observed_at, now);
    return !Number.isFinite(observedAge) || observedAge > hardStaleHours;
  });
  if (staleDimensions.length > 0) {
    return {
      code: 'DIMENSION_STALE',
      observer_failure: true,
      passed: false,
      age_hours: age,
      summary:
        `Blocking dimension(s) were not re-observed within ${hardStaleHours}h even though the ledger file is ${age}h old: ` +
        `${staleDimensions.map((dimension) => `${dimension.id}@${dimension.observed_at ?? 'never'}`).join(', ')}. ` +
        'OBSERVER failure — the generator did not measure everything it published.',
      details,
      blocking_findings: staleDimensions.map((dimension) => `stale:${dimension.id}`),
    };
  }

  const unreadable = blocking.filter((dimension) => dimension.status === 'unknown');
  const failing = blocking.filter((dimension) => dimension.status === 'fail');

  if (failing.length > 0) {
    return {
      code: 'READINESS_RED',
      observer_failure: false,
      passed: false,
      age_hours: age,
      summary:
        `Readiness is RED on measured evidence ${age}h old. Blocking dimensions failing: ` +
        `${failing.map((dimension) => dimension.id).join(', ')}.`,
      details: [
        ...details,
        ...failing.map((dimension) => `${dimension.id}: ${dimension.evidence}`),
        ...(unreadable.length > 0
          ? [`also unreadable: ${unreadable.map((dimension) => dimension.id).join(', ')}`]
          : []),
      ],
      blocking_findings: [
        ...failing.map((dimension) => `fail:${dimension.id}`),
        ...unreadable.map((dimension) => `unknown:${dimension.id}`),
      ].sort(),
    };
  }

  if (unreadable.length > 0) {
    return {
      code: 'OBSERVER_DEGRADED',
      observer_failure: true,
      passed: false,
      age_hours: age,
      summary:
        `Production state is UNKNOWN, not proven good: blocking dimension(s) could not be read — ` +
        `${unreadable.map((dimension) => dimension.id).join(', ')}. An unreadable dimension is never scored as passing.`,
      details: [...details, ...unreadable.map((d) => `${d.id}: ${d.unreadable_reason ?? d.evidence}`)],
      blocking_findings: unreadable.map((dimension) => `unknown:${dimension.id}`).sort(),
    };
  }

  const nonBlockingGaps = dimensions.filter(
    (dimension) => !dimension.blocking && dimension.status !== 'pass',
  );
  if (nonBlockingGaps.length > 0 || ledger.verdict === 'YELLOW') {
    return {
      code: 'READINESS_YELLOW',
      observer_failure: false,
      passed: true,
      age_hours: age,
      summary:
        'All blocking dimensions pass on current evidence. Non-blocking gaps: ' +
        `${nonBlockingGaps.map((dimension) => `${dimension.id}(${dimension.status})`).join(', ') || 'none recorded'}.`,
      details,
      blocking_findings: [],
    };
  }

  return {
    code: 'GREEN',
    observer_failure: false,
    passed: true,
    age_hours: age,
    summary: `Every dimension passes on evidence ${age}h old.`,
    details,
    blocking_findings: [],
  };
}

export function evaluateLedgerFile(filePath: string, now: Date, policy: { hardStaleHours?: number } = {}): GateResult {
  if (!fs.existsSync(filePath)) {
    return {
      code: 'LEDGER_MISSING',
      observer_failure: true,
      passed: false,
      age_hours: null,
      summary: `${path.relative(REPO_ROOT, filePath)} does not exist — there is no readiness ledger to gate on.`,
      details: [],
      blocking_findings: [],
    };
  }
  const parsed = parseLedger(fs.readFileSync(filePath, 'utf8'));
  if (!parsed.ledger) {
    return {
      code: 'LEDGER_INVALID',
      observer_failure: true,
      passed: false,
      age_hours: null,
      summary: `${path.relative(REPO_ROOT, filePath)} is not a usable readiness ledger: ${parsed.errors.join('; ')}`,
      details: parsed.errors,
      blocking_findings: parsed.errors.map((error) => `invalid:${error}`).sort(),
    };
  }
  return evaluateLedger(parsed.ledger, now, policy);
}

/**
 * Classifies PR readiness independently from absolute operational readiness.
 *
 * A PR may inherit a RED/unknown ledger from main without causing that debt.
 * The PR check stays diagnostic in that case (`neutral`). A newly failing or
 * differently failing head is a PR-caused regression and remains fail-closed.
 * Scheduled/deployment callers continue to use evaluateLedgerFile directly,
 * so this comparison cannot soften absolute readiness enforcement.
 */
export function evaluateReadinessRegression(base: GateResult, head: GateResult): RegressionResult {
  if (head.passed) {
    return {
      conclusion: 'success',
      passed: true,
      summary: `PR readiness passes (${head.code}).`,
      base,
      head,
    };
  }

  const sameBlockingFindings =
    base.blocking_findings.length === head.blocking_findings.length &&
    base.blocking_findings.every((finding, index) => finding === head.blocking_findings[index]);
  if (!base.passed && base.code === head.code && sameBlockingFindings) {
    return {
      conclusion: 'neutral',
      passed: true,
      summary:
        `PR inherits repository readiness debt (${head.code}) from base; ` +
        'the PR did not introduce a new readiness classification.',
      base,
      head,
    };
  }

  return {
    conclusion: 'failure',
    passed: false,
    summary: `PR readiness regressed from ${base.code} to ${head.code}.`,
    base,
    head,
  };
}

// ── Persistence assertion ────────────────────────────────────────────────────

export type PersistenceCode =
  | 'OK'
  | 'NOT_WRITTEN'
  | 'UNPARSEABLE'
  | 'NOT_REWRITTEN'
  | 'TIMESTAMP_NOT_ADVANCED'
  | 'OBSERVATION_NOT_CURRENT';

export interface PersistenceResult {
  code: PersistenceCode;
  passed: boolean;
  summary: string;
}

/**
 * Proves the refresh actually happened, from the artifact alone.
 *
 * `previousRaw` is the ledger as it existed before the run (null on first write).
 * A byte-identical file is treated as a failure even when the verdict legitimately
 * did not change: an unchanged verdict is only allowed to conclude success when it
 * carries a NEW observation, and a new observation always changes `observed_at`.
 */
export function assertRefreshAdvanced(
  previousRaw: string | null,
  nextRaw: string | null,
  runStartedAt: Date,
): PersistenceResult {
  if (nextRaw === null) {
    return { code: 'NOT_WRITTEN', passed: false, summary: 'the generator produced no ledger file at the expected path' };
  }

  const next = parseLedger(nextRaw);
  if (!next.ledger) {
    return { code: 'UNPARSEABLE', passed: false, summary: `the written ledger is unusable: ${next.errors.join('; ')}` };
  }

  if (previousRaw !== null && previousRaw === nextRaw) {
    return {
      code: 'NOT_REWRITTEN',
      passed: false,
      summary:
        'the ledger is byte-identical to the previous version — the generator did not execute, or its output was not published',
    };
  }

  if (previousRaw !== null) {
    const previous = parseLedger(previousRaw);
    if (previous.ledger) {
      const previousAt = new Date(previous.ledger.generated_at).getTime();
      const nextAt = new Date(next.ledger.generated_at).getTime();
      if (!(nextAt > previousAt)) {
        return {
          code: 'TIMESTAMP_NOT_ADVANCED',
          passed: false,
          summary: `generated_at did not advance (previous ${previous.ledger.generated_at}, new ${next.ledger.generated_at})`,
        };
      }
    }
  }

  const dimensions = dimensionsOf(next.ledger);
  if (dimensions.length === 0) {
    return { code: 'OBSERVATION_NOT_CURRENT', passed: false, summary: 'the ledger records no dimensions at all' };
  }
  const notObservedThisRun = dimensions.filter((dimension) => {
    if (typeof dimension.observed_at !== 'string') return true;
    const observed = new Date(dimension.observed_at).getTime();
    return !Number.isFinite(observed) || observed < runStartedAt.getTime();
  });
  if (notObservedThisRun.length > 0) {
    return {
      code: 'OBSERVATION_NOT_CURRENT',
      passed: false,
      summary:
        'dimension(s) carry an observation older than this run, so they were carried forward rather than measured: ' +
        `${notObservedThisRun.map((dimension) => `${dimension.id}@${dimension.observed_at ?? 'never'}`).join(', ')}`,
    };
  }

  return {
    code: 'OK',
    passed: true,
    summary: `ledger rewritten with ${dimensions.length} dimensions, all observed within this run (generated_at ${next.ledger.generated_at})`,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function readIfExists(filePath: string): string | null {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
}

function argValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function main(argv = process.argv.slice(2)): number {
  const mode = argValue(argv, '--mode') ?? 'gate';
  const file = path.resolve(REPO_ROOT, argValue(argv, '--file') ?? 'docs/06_status/readiness/readiness-score.json');
  const jsonMode = argv.includes('--json');

  if (mode === 'regression') {
    const basePath = argValue(argv, '--base');
    if (!basePath) {
      console.error('::error title=readiness regression input missing::--base <ledger-path> is required');
      return 1;
    }
    const now = new Date();
    const result = evaluateReadinessRegression(
      evaluateLedgerFile(path.resolve(REPO_ROOT, basePath), now),
      evaluateLedgerFile(file, now),
    );
    if (jsonMode) console.log(JSON.stringify(result, null, 2));
    if (result.conclusion === 'failure') {
      console.error(`::error title=readiness regression::${result.summary}`);
      return 1;
    }
    if (result.conclusion === 'neutral') {
      console.log(`::notice title=repository readiness debt::${result.summary}`);
    } else {
      console.log(`[readiness-regression] ${result.summary}`);
    }
    return 0;
  }

  if (mode === 'persistence') {
    const previousPath = argValue(argv, '--previous');
    const runStartedAt = new Date(argValue(argv, '--run-started-at') ?? 0);
    const result = assertRefreshAdvanced(
      previousPath ? readIfExists(path.resolve(REPO_ROOT, previousPath)) : null,
      readIfExists(file),
      runStartedAt,
    );
    if (jsonMode) console.log(JSON.stringify(result, null, 2));
    if (!result.passed) {
      console.error(`::error title=readiness refresh did not persist::${result.code}: ${result.summary}`);
      return 1;
    }
    console.log(`[readiness-persistence] OK — ${result.summary}`);
    return 0;
  }

  const result = evaluateLedgerFile(file, new Date());
  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Readiness gate: ${result.code}`);
    for (const detail of result.details) console.log(`  ${detail}`);
  }

  if (result.passed) {
    console.log(`[readiness-gate] ${result.code} — ${result.summary}`);
    if (result.code === 'READINESS_YELLOW') {
      console.log(`::warning title=readiness YELLOW::${result.summary}`);
    }
    return 0;
  }

  const title = OBSERVER_FAILURE_CODES.has(result.code)
    ? `readiness OBSERVER failure (${result.code})`
    : `readiness ${result.code}`;
  console.error(`::error title=${title}::${result.summary}`);
  for (const detail of result.details) console.error(`::notice::${detail}`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
