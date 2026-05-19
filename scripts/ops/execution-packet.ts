import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateExecutionCwd } from './lane-execution.js';
import { ROOT, emitJson, parseArgs, readManifest, type LaneManifest } from './shared.js';

export interface ExecutionPacket {
  issue_id: string;
  title: string;
  project: string;
  tier: string;
  lane_type: string;
  branch: string;
  execution_location: string;
  cwd: string;
  cwd_guard_command: string;
  allowed_file_scope: string[];
  tier_c_warnings: string[];
  blockers: string[];
  required_verification: string[];
  expected_proof_paths: string[];
  closeout_instructions: string[];
  repo_brief: string;
  source_of_truth: {
    linear_url: string;
    branch: string;
    manifest_path: string;
  };
  generated_at: string;
}

const TEST_TIMESTAMP = '2000-01-01T00:00:00.000Z';

const EXECUTION_LOCATION_MAP: Record<string, string> = {
  claude: 'Claude Code (interactive)',
  'codex-cli': 'Codex CLI (autonomous)',
  'codex-cloud': 'Codex Cloud (autonomous)',
};

const TIER_VERIFICATION_MAP: Record<string, string[]> = {
  T1: ['type-check', 'test', 'test:db', 'runtime-proof', 'evidence-bundle'],
  T2: ['type-check', 'test', 'issue-specific verification'],
  T3: ['type-check', 'test'],
};

export function generateExecutionPacket(manifest: LaneManifest): ExecutionPacket {
  const issueId = manifest.issue_id;
  const tier = manifest.tier ?? 'unknown';
  const expectedProofPaths = manifest.expected_proof_paths ?? [];

  return {
    issue_id: issueId,
    title: issueId,
    project: 'Unit Talk V2',
    tier,
    lane_type: manifest.lane_type ?? 'unknown',
    branch: manifest.branch,
    execution_location: deriveExecutionLocation(manifest.executor),
    cwd: manifest.execution_location?.cwd ?? manifest.worktree_path,
    cwd_guard_command: `cd "${manifest.execution_location?.cwd ?? manifest.worktree_path}"`,
    allowed_file_scope: [...(manifest.file_scope_lock ?? [])],
    tier_c_warnings: collectTierCWarnings(manifest.file_scope_lock ?? []),
    blockers: [...(manifest.blocked_by ?? [])],
    required_verification: buildRequiredVerification(tier, expectedProofPaths),
    expected_proof_paths: [...expectedProofPaths],
    closeout_instructions: [
      'Run pnpm verify and ensure it passes',
      'Run npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD',
      `Open PR with title matching feat(ops): ${issueId} description`,
      `Apply tier label: gh pr edit <PR-number> --add-label tier:${tier}`,
      'Run ops:truth-check after merge to close lane',
    ],
    repo_brief: loadRepoBrief(),
    source_of_truth: {
      linear_url: `https://linear.app/unit-talk-v2/issue/${issueId}`,
      branch: manifest.branch,
      manifest_path: `docs/06_status/lanes/${issueId}.json`,
    },
    generated_at: packetTimestamp(),
  };
}

export function printExecutionPacket(manifest: LaneManifest): void {
  emitJson(generateExecutionPacket(manifest));
}

export function assertExecutionPacketCwd(
  packet: Pick<ExecutionPacket, 'cwd'>,
  actualCwd = process.cwd(),
): void {
  const errors = validateExecutionCwd(packet.cwd, actualCwd);
  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }
}

function deriveExecutionLocation(executor: LaneManifest['executor']): string {
  if (!executor) {
    return 'Unknown';
  }

  return EXECUTION_LOCATION_MAP[executor] ?? 'Unknown';
}

function collectTierCWarnings(fileScopeLock: string[]): string[] {
  const warnings: string[] = [];

  for (const filePath of fileScopeLock) {
    if (filePath.startsWith('packages/domain/')) {
      warnings.push(`Tier C path requires PM approval before editing: ${filePath} (packages/domain/)`);
      continue;
    }
    if (filePath.startsWith('packages/config/')) {
      warnings.push(`Tier C path requires PM approval before editing: ${filePath} (packages/config/)`);
      continue;
    }
    if (/^supabase\/migrations\/[^/]+\.sql$/u.test(filePath)) {
      warnings.push(`Tier C migration path requires PM approval before editing: ${filePath}`);
    }
  }

  return warnings;
}

function buildRequiredVerification(tier: string, expectedProofPaths: string[]): string[] {
  const values = [...(TIER_VERIFICATION_MAP[tier] ?? ['type-check', 'test'])];

  for (const proofPath of expectedProofPaths) {
    if (!values.includes(proofPath)) {
      values.push(proofPath);
    }
  }

  return values;
}

function loadRepoBrief(): string {
  if (process.env.UNIT_TALK_TEST_MODE === '1' || process.env.NODE_ENV === 'test') {
    return '[test-brief-stub]';
  }
  try {
    const briefPath = path.join(ROOT, '.claude', 'agent-brief.md');
    return fs.readFileSync(briefPath, 'utf8');
  } catch {
    return '[agent-brief.md not found — check .claude/agent-brief.md exists in repo root]';
  }
}

function packetTimestamp(): string {
  if (process.env.UNIT_TALK_TEST_MODE === '1' || process.env.NODE_ENV === 'test') {
    return TEST_TIMESTAMP;
  }

  return new Date().toISOString();
}

function main(): void {
  const { positionals, bools } = parseArgs(process.argv.slice(2));
  const issueId = positionals[0];
  if (!issueId) {
    throw new Error('Usage: npx tsx scripts/ops/execution-packet.ts <ISSUE-ID> [--enforce-cwd]');
  }

  const packet = generateExecutionPacket(readManifest(issueId));
  if (bools.has('enforce-cwd')) {
    assertExecutionPacketCwd(packet);
  }
  emitJson(packet);
}

const argv1 = process.argv[1] ?? '';
if (argv1 && import.meta.url === pathToFileURL(path.resolve(argv1)).href) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitJson({
      ok: false,
      code: 'execution_packet_error',
      message,
      cwd: ROOT,
    });
    process.exit(1);
  }
}
