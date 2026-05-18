import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import type { AlignmentRegistry } from './system-alignment-check.js';

const requireFromTest = createRequire(import.meta.url);
const {
  buildAlignmentReport,
  checkDeprecatedControlPlaneClaims,
  checkMissingReferences,
  checkRegistryShape,
} = requireFromTest('./system-alignment-check.ts') as typeof import('./system-alignment-check.js');

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'utv2-alignment-'));
}

function write(root: string, relativePath: string, content: string): string {
  const fullPath = join(root, relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
  return fullPath;
}

function registry(root: string, overrides: Partial<AlignmentRegistry> = {}): AlignmentRegistry {
  const active = write(root, 'docs/05_operations/ACTIVE.md', 'Linear is live.\n`docs/06_status/ISSUE_QUEUE.md` is historical only.\n');
  const historical = write(root, 'docs/06_status/ISSUE_QUEUE.md', '# Historical\n');

  return {
    schema_version: 1,
    reference_root: root,
    active_authority_files: [active],
    historical_files: [historical],
    deprecated_live_control_planes: [
      {
        path: 'docs/06_status/ISSUE_QUEUE.md',
        allowed_terms: ['historical', 'deprecated', 'not active'],
        forbidden_patterns: ['Active work queue', 'Every lane state change', 'Update `ISSUE_QUEUE.md`'],
      },
    ],
    tool_surfaces: [
      {
        name: 'ci-triage',
        kind: 'prompt-agent',
        category: 'manual-diagnostic',
      },
    ],
    ...overrides,
  };
}

test('system alignment fails stale active-authority claim about ISSUE_QUEUE', () => {
  const root = tempRoot();
  const active = write(root, 'docs/05_operations/STALE_ACTIVE.md', '| `docs/06_status/ISSUE_QUEUE.md` | Active work queue | Every lane state change |\n');
  const reg = registry(root, { active_authority_files: [active] });

  const findings = checkDeprecatedControlPlaneClaims(reg);

  assert.ok(findings.some(finding => finding.code === 'ALIGN_DEPRECATED_CONTROL_PLANE_CLAIM'));
});

test('system alignment allows historical docs to mention old behavior outside active authority files', () => {
  const root = tempRoot();
  const active = write(root, 'docs/05_operations/ACTIVE.md', '`docs/06_status/ISSUE_QUEUE.md` is historical only.\n');
  const historical = write(root, 'docs/06_status/OLD_AUDIT.md', '`docs/06_status/ISSUE_QUEUE.md` was the Active work queue.\n');
  const reg = registry(root, {
    active_authority_files: [active],
    historical_files: [historical],
  });
  const registryPath = write(root, 'registry.json', JSON.stringify(reg));

  const report = buildAlignmentReport(registryPath);

  assert.equal(report.verdict, 'PASS');
});

test('system alignment fails missing references from active authority docs', () => {
  const root = tempRoot();
  const active = write(root, 'docs/05_operations/MISSING_REF.md', 'See `docs/governance/LANE_CONCURRENCY_POLICY.md`.\n');
  const reg = registry(root, { active_authority_files: [active] });

  const findings = checkMissingReferences(reg);

  assert.ok(findings.some(finding => finding.code === 'ALIGN_REFERENCE_MISSING'));
});

test('system alignment fails recurring manual tooling without target issue', () => {
  const root = tempRoot();
  const reg = registry(root, {
    tool_surfaces: [
      {
        name: 'proof-auditor',
        kind: 'prompt-agent',
        category: 'manual-transitional',
      },
    ],
  });

  const findings = checkRegistryShape(reg, join(root, 'registry.json'));

  assert.ok(findings.some(finding => finding.code === 'ALIGN_MANUAL_RECURRING_UNTRACKED'));
});

test('system alignment allows diagnostic-only manual tooling', () => {
  const root = tempRoot();
  const reg = registry(root, {
    tool_surfaces: [
      {
        name: 'ci-triage',
        kind: 'prompt-agent',
        category: 'manual-diagnostic',
      },
    ],
  });

  const findings = checkRegistryShape(reg, join(root, 'registry.json'));

  assert.equal(findings.filter(finding => finding.severity === 'fail').length, 0);
});
