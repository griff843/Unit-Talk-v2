/**
 * Tests for R-level scope annotation mechanism (UTV2-838).
 *
 * Uses node:test + node:assert/strict (not Jest/Vitest).
 * Run: tsx --test scripts/ci/r-level-check.test.ts
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../..');
const script = path.join(repoRoot, 'scripts/ci/r-level-check.ts');

/** Write a temp file and return its path; cleaned up in `after`. */
const tmpFiles: string[] = [];
function writeTmp(name: string, content: string): string {
  const p = path.join(os.tmpdir(), `utv2-838-test-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(p, content, 'utf8');
  tmpFiles.push(p);
  return p;
}

after(() => {
  for (const f of tmpFiles) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

/**
 * Run the r-level-check script as a subprocess using `tsx` directly.
 * Uses HEAD..HEAD so git diff is empty and no file-path rules fire.
 */
function runCheck(opts: {
  prBodyContent: string | null;
}): { exitCode: number; report: Record<string, unknown> | null; stdout: string; stderr: string } {
  const prBodyFile = opts.prBodyContent !== null
    ? writeTmp('pr-body', opts.prBodyContent)
    : null;

  const outPath = writeTmp('out', '');

  const extraArgs = [
    '--base HEAD',
    '--head HEAD',
    `--output-json ${outPath}`,
    ...(prBodyFile ? [`--pr-body-file "${prBodyFile}"`] : []),
  ].join(' ');

  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  try {
    stdout = execSync(
      `npx tsx "${script}" ${extraArgs}`,
      { cwd: repoRoot, encoding: 'utf8' },
    );
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    stdout = e.stdout ?? '';
    stderr = e.stderr ?? '';
    exitCode = e.status ?? 1;
  }

  let report: Record<string, unknown> | null = null;
  try {
    const raw = fs.readFileSync(outPath, 'utf8');
    if (raw.trim().length > 0) {
      report = JSON.parse(raw) as Record<string, unknown>;
    }
  } catch { /* no report written */ }

  return { exitCode, report, stdout, stderr };
}

// ---------------------------------------------------------------------------
// Subprocess integration tests — call script via npx tsx
// ---------------------------------------------------------------------------

describe('r-level-check subprocess — no annotation (baseline)', () => {
  it('emits annotation_applied: false when no pr-body-file provided', () => {
    const { report } = runCheck({ prBodyContent: null });
    assert.ok(report !== null, 'report should be written');
    assert.equal(report['annotation_applied'], false, 'annotation_applied should be false');
    assert.equal(report['annotation_type'], null, 'annotation_type should be null');
  });

  it('emits annotation_applied: false when pr-body has no r-scope line', () => {
    const { report } = runCheck({
      prBodyContent: '## Summary\n\nSome PR body without any scope annotation.\n',
    });
    assert.ok(report !== null, 'report should be written');
    assert.equal(report['annotation_applied'], false);
    assert.equal(report['annotation_type'], null);
  });
});

describe('r-level-check subprocess — additive-guard present, no files match', () => {
  it('annotation_applied is false when no rules are matched (empty diff)', () => {
    // HEAD..HEAD → empty diff → no rules fired → annotation has nothing to apply
    const { report } = runCheck({
      prBodyContent: 'r-scope: additive-guard\n',
    });
    assert.ok(report !== null, 'report should be written');
    assert.equal(
      report['annotation_applied'],
      false,
      'annotation_applied must be false when no rules match',
    );
    assert.equal(
      (report['rulesMatched'] as unknown[]).length,
      0,
      'rulesMatched should be empty for empty diff',
    );
  });
});

// ---------------------------------------------------------------------------
// Unit-level logic tests — inline helpers to avoid ESM cycle issues
// ---------------------------------------------------------------------------

interface ScopeAnnotationDef {
  description: string;
  allowedForRules: string[];
  downgradesRequired: string[];
  retains: string[];
  pmGated: boolean;
}

interface RuleEntry {
  id: string;
  paths: string[];
  required: string[];
  advisory: string[];
  pmGated: string[];
  artifactRequirements: string[];
}

function applyAnnotation(
  rule: RuleEntry,
  annotationDef: ScopeAnnotationDef,
): { required: string[]; advisory: string[]; pmGated: string[]; applied: boolean } | null {
  if (!annotationDef.allowedForRules.includes(rule.id)) {
    return null;
  }

  const downgradeSet = new Set(annotationDef.downgradesRequired);
  const retainSet = new Set(annotationDef.retains);

  const newRequired = rule.required.filter((r) => retainSet.has(r) || !downgradeSet.has(r));
  const downgradedLevels = rule.required.filter(
    (r) => downgradeSet.has(r) && !retainSet.has(r),
  );
  const newAdvisory = [...rule.advisory, ...downgradedLevels];
  return { required: newRequired, advisory: newAdvisory, pmGated: rule.pmGated, applied: true };
}

function detectAnnotation(content: string): string | null {
  for (const line of content.split('\n')) {
    const match = /^r-scope:\s*(\S+)\s*$/.exec(line.trim());
    if (match) {
      return match[1];
    }
  }
  return null;
}

const ADDITIVE_GUARD: ScopeAnnotationDef = {
  description: 'Small additive guards',
  allowedForRules: ['lifecycle-fsm', 'ingestor-provider'],
  downgradesRequired: ['R2', 'R3', 'R4'],
  retains: ['R1'],
  pmGated: true,
};

describe('applyAnnotation — allowed rule (lifecycle-fsm)', () => {
  const lifecycleFsm: RuleEntry = {
    id: 'lifecycle-fsm',
    paths: ['apps/api/src/submission-service.ts'],
    required: ['R1', 'R2', 'R3', 'R4'],
    advisory: ['R5'],
    pmGated: ['R4'],
    artifactRequirements: ['r2-determinism', 'r3-shadow-report', 'r4-fault-report'],
  };

  it('returns applied: true for an allowed rule', () => {
    const result = applyAnnotation(lifecycleFsm, ADDITIVE_GUARD);
    assert.ok(result !== null, 'should return a result');
    assert.equal(result.applied, true);
  });

  it('retains R1 in required', () => {
    const result = applyAnnotation(lifecycleFsm, ADDITIVE_GUARD);
    assert.ok(result !== null);
    assert.ok(result.required.includes('R1'), 'R1 must remain required');
  });

  it('removes R2, R3, R4 from required', () => {
    const result = applyAnnotation(lifecycleFsm, ADDITIVE_GUARD);
    assert.ok(result !== null);
    assert.ok(!result.required.includes('R2'), 'R2 should be downgraded');
    assert.ok(!result.required.includes('R3'), 'R3 should be downgraded');
    assert.ok(!result.required.includes('R4'), 'R4 should be downgraded');
  });

  it('moves R2, R3, R4 to advisory', () => {
    const result = applyAnnotation(lifecycleFsm, ADDITIVE_GUARD);
    assert.ok(result !== null);
    assert.ok(result.advisory.includes('R2'), 'R2 should be in advisory');
    assert.ok(result.advisory.includes('R3'), 'R3 should be in advisory');
    assert.ok(result.advisory.includes('R4'), 'R4 should be in advisory');
  });

  it('preserves original advisory (R5)', () => {
    const result = applyAnnotation(lifecycleFsm, ADDITIVE_GUARD);
    assert.ok(result !== null);
    assert.ok(result.advisory.includes('R5'), 'R5 should remain in advisory');
  });
});

describe('applyAnnotation — allowed rule (ingestor-provider)', () => {
  const ingestorProvider: RuleEntry = {
    id: 'ingestor-provider',
    paths: ['apps/ingestor/**'],
    required: ['R1'],
    advisory: ['R2', 'R3', 'R4'],
    pmGated: ['R4'],
    artifactRequirements: [],
  };

  it('returns applied: true for ingestor-provider', () => {
    const result = applyAnnotation(ingestorProvider, ADDITIVE_GUARD);
    assert.ok(result !== null);
    assert.equal(result.applied, true);
  });

  it('retains R1 (already the only required)', () => {
    const result = applyAnnotation(ingestorProvider, ADDITIVE_GUARD);
    assert.ok(result !== null);
    assert.deepEqual(result.required, ['R1']);
  });
});

describe('applyAnnotation — disallowed rules (fail-closed)', () => {
  const settlementGrading: RuleEntry = {
    id: 'settlement-grading',
    paths: ['apps/api/src/settlement-service.ts'],
    required: ['R1', 'R2', 'R3', 'R4'],
    advisory: ['R5'],
    pmGated: ['R4'],
    artifactRequirements: ['r2-determinism', 'r3-shadow-report', 'r4-fault-report'],
  };

  const promotionScoring: RuleEntry = {
    id: 'promotion-scoring',
    paths: ['packages/domain/src/promotion/**'],
    required: ['R1', 'R2', 'R3'],
    advisory: ['R4', 'R5'],
    pmGated: ['R4'],
    artifactRequirements: ['r2-determinism', 'r3-shadow-report'],
  };

  const strategyBankroll: RuleEntry = {
    id: 'strategy-bankroll',
    paths: ['packages/domain/src/strategy/**'],
    required: ['R5'],
    advisory: ['R1', 'R2'],
    pmGated: [],
    artifactRequirements: ['r5-strategy-proof'],
  };

  it('returns null for settlement-grading (annotation has no effect)', () => {
    const result = applyAnnotation(settlementGrading, ADDITIVE_GUARD);
    assert.equal(result, null, 'settlement-grading must not be downgraded');
  });

  it('returns null for promotion-scoring (annotation has no effect)', () => {
    const result = applyAnnotation(promotionScoring, ADDITIVE_GUARD);
    assert.equal(result, null, 'promotion-scoring must not be downgraded');
  });

  it('returns null for strategy-bankroll (annotation has no effect)', () => {
    const result = applyAnnotation(strategyBankroll, ADDITIVE_GUARD);
    assert.equal(result, null, 'strategy-bankroll must not be downgraded');
  });
});

describe('detectAnnotation', () => {
  it('detects r-scope: additive-guard at start of line', () => {
    const body = '## Summary\n\nr-scope: additive-guard\n\nSome text.\n';
    assert.equal(detectAnnotation(body), 'additive-guard');
  });

  it('detects r-scope at first line', () => {
    const body = 'r-scope: additive-guard';
    assert.equal(detectAnnotation(body), 'additive-guard');
  });

  it('returns null when no annotation present', () => {
    const body = '## Summary\n\nSome PR body.\n';
    assert.equal(detectAnnotation(body), null);
  });

  it('returns null for partial match (inline, not start of line)', () => {
    // The regex requires the line to match fully (trimmed)
    const body = '  some text r-scope: additive-guard other text  ';
    assert.equal(detectAnnotation(body), null);
  });

  it('returns the annotation type verbatim', () => {
    const body = 'r-scope: additive-guard\n';
    assert.equal(detectAnnotation(body), 'additive-guard');
  });
});
