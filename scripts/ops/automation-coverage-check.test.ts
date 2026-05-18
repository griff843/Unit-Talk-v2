import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import type { AutomationRegistry } from './automation-coverage-check.js';

const requireFromTest = createRequire(import.meta.url);
const { buildAutomationCoverageReport } = requireFromTest('./automation-coverage-check.ts') as typeof import('./automation-coverage-check.js');

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'utv2-automation-'));
}

function write(root: string, relativePath: string, content: string): string {
  const fullPath = join(root, relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
  return fullPath;
}

function baseRegistry(root: string, overrides: Partial<AutomationRegistry> = {}): AutomationRegistry {
  write(root, '.claude/agents/ci-triage.md', '---\nname: ci-triage\n---\nManual diagnostic only.\n');
  write(root, '.agents/skills/runtime-delivery/SKILL.md', '---\nname: runtime-delivery\n---\n');
  write(root, 'scripts/ops/reconcile.ts', 'console.log("reconcile");\n');
  write(root, '.github/workflows/ops-reconcile.yml', 'on:\n  schedule:\n    - cron: "0 * * * *"\n');

  return {
    schema_version: 1,
    reference_root: root,
    tool_surfaces: [
      {
        name: 'ci-triage',
        kind: 'prompt-agent',
        category: 'manual-diagnostic',
        owner: 'claude-governance',
        trigger: 'manual invocation after failed CI',
        artifact: 'operator transcript',
        required_check_status: 'not-required',
        manual_allowance: 'diagnostic',
      },
    ],
    ...overrides,
  };
}

function writeRegistry(root: string, registry: AutomationRegistry): string {
  return write(root, 'docs/05_operations/system-alignment-registry.json', JSON.stringify(registry, null, 2));
}

test('automation coverage fails recurring manual-purpose tool without target issue', () => {
  const root = tempRoot();
  write(root, '.claude/agents/proof-auditor.md', '---\nname: proof-auditor\n---\nAdvisory proof review.\n');
  const registryPath = writeRegistry(
    root,
    baseRegistry(root, {
      tool_surfaces: [
        {
          name: 'ci-triage',
          kind: 'prompt-agent',
          category: 'manual-diagnostic',
          manual_allowance: 'diagnostic',
        },
        {
          name: 'proof-auditor',
          kind: 'prompt-agent',
          category: 'manual-tool',
          manual_allowance: 'transitional wiring gap',
        },
      ],
    }),
  );

  const report = buildAutomationCoverageReport(registryPath);

  assert.equal(report.verdict, 'FAIL');
  assert.ok(report.findings.some(finding => finding.code === 'AUTO_MANUAL_RECURRING_UNJUSTIFIED'));
});

test('automation coverage allows diagnostic-only manual tools', () => {
  const root = tempRoot();
  const registryPath = writeRegistry(root, baseRegistry(root));

  const report = buildAutomationCoverageReport(registryPath);

  assert.equal(report.verdict, 'PASS');
  assert.equal(report.coverage[0]?.required_check_status, 'not-required');
});

test('automation coverage fails prompt-agent gate claim without equivalent blocking automation', () => {
  const root = tempRoot();
  write(root, '.claude/agents/proof-auditor.md', '---\nname: proof-auditor\n---\nUse before any merge gate. Do not apply t1-approved until VALID.\n');
  const registryPath = writeRegistry(
    root,
    baseRegistry(root, {
      tool_surfaces: [
        {
          name: 'ci-triage',
          kind: 'prompt-agent',
          category: 'manual-diagnostic',
          manual_allowance: 'diagnostic',
        },
        {
          name: 'proof-auditor',
          kind: 'prompt-agent',
          category: 'manual-transitional',
          target_issue: 'UTV2-1046',
          manual_allowance: 'transitional wiring gap',
        },
      ],
    }),
  );

  const report = buildAutomationCoverageReport(registryPath);

  assert.equal(report.verdict, 'FAIL');
  assert.ok(report.findings.some(finding => finding.code === 'AUTO_PROMPT_AGENT_BLOCKING_WITHOUT_GATE'));
});

test('automation coverage emits classified trigger and artifact fields', () => {
  const root = tempRoot();
  write(root, '.github/workflows/ops-reconcile.yml', 'on:\n  schedule:\n    - cron: "0 * * * *"\n');
  write(root, 'scripts/ops/reconcile.ts', 'console.log("reconcile");\n');
  const registryPath = writeRegistry(
    root,
    baseRegistry(root, {
      tool_surfaces: [
        {
          name: 'ci-triage',
          kind: 'prompt-agent',
          category: 'manual-diagnostic',
          manual_allowance: 'diagnostic',
        },
        {
          name: 'scripts/ops/reconcile.ts',
          kind: 'script',
          category: 'scheduled-monitor',
          owner: 'codex-implementation',
          trigger: '.github/workflows/ops-reconcile.yml schedule',
          automation: '.github/workflows/ops-reconcile.yml',
          artifact: 'reconcile JSON output',
          required_check_status: 'not-required',
        },
      ],
    }),
  );

  const report = buildAutomationCoverageReport(registryPath);

  assert.equal(report.verdict, 'PASS');
  const reconcileEntry = report.coverage.find(entry => entry.surface === 'scripts/ops/reconcile.ts');
  assert.equal(reconcileEntry?.trigger, '.github/workflows/ops-reconcile.yml schedule');
  assert.equal(reconcileEntry?.artifact, 'reconcile JSON output');
  assert.equal(reconcileEntry?.automation_exists, true);
});
