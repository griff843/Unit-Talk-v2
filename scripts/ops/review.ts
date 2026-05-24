#!/usr/bin/env tsx
/**
 * ops:review — Review Packet Generator (Workflow Runtime v2, Phase C)
 *
 * Usage:
 *   pnpm ops:review <ISSUE_ID> --pr <PR_NUMBER> [--json]
 *
 * Detects the executor from the lane manifest and assigns the opposite
 * reviewer (Claude impl → Codex review, Codex impl → Claude review).
 * Generates an adversarial review packet and initializes
 * .ops/reviews/<ISSUE_ID>.json. Does NOT mark review as PASS.
 */

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  ROOT,
  emitJson,
  parseArgs,
  getFlag,
  requireIssueId,
  readManifest,
  relativeToRoot,
} from './shared.js';
import {
  makeEmptyReviewState,
  writeReviewState,
  reviewStatePath,
  type Executor,
} from './review-state-schema.js';

interface CliOptions {
  issueId: string;
  prNumber: number | null;
  json: boolean;
}

interface ReviewPacketResult {
  ok: boolean;
  issue_id: string;
  pr_number: number | null;
  executor: Executor | null;
  assigned_reviewer: Executor | null;
  review_state_path: string | null;
  packet_path: string | null;
  failures: string[];
  warnings: string[];
  generated_at: string;
}

const PACKETS_DIR = '.ops/review-packets';

function parseCliArgs(argv: string[]): CliOptions {
  const { positionals, flags, bools } = parseArgs(argv);
  const issueId = requireIssueId(positionals[0] ?? '');
  const prRaw = getFlag(flags, 'pr');
  const prNumber = prRaw != null ? Number(prRaw) : null;
  return {
    issueId,
    prNumber: prNumber != null && Number.isFinite(prNumber) ? prNumber : null,
    json: bools.has('json') || flags.has('json'),
  };
}

function assignReviewer(executor: Executor): Executor {
  if (executor === 'claude') return 'codex';
  if (executor === 'codex' || executor === 'codex-cli' || executor === 'codex-cloud') return 'claude';
  // PM-implemented lanes reviewed by claude
  return 'claude';
}

function getPrDiff(prNumber: number): string {
  try {
    return execFileSync('gh', [
      'pr', 'diff', String(prNumber), '--patch',
    ], { encoding: 'utf8', cwd: ROOT, maxBuffer: 2 * 1024 * 1024 }).slice(0, 8000);
  } catch {
    return '(could not retrieve PR diff)';
  }
}

function getPrFiles(prNumber: number): string[] {
  try {
    const out = execFileSync('gh', [
      'pr', 'view', String(prNumber),
      '--json', 'files',
      '--jq', '.files[].path',
    ], { encoding: 'utf8', cwd: ROOT }).trim();
    return out ? out.split('\n') : [];
  } catch {
    return [];
  }
}

function getPrHeadSha(prNumber: number): string | null {
  try {
    const out = execFileSync('gh', [
      'pr', 'view', String(prNumber),
      '--json', 'headRefOid',
      '--jq', '.headRefOid',
    ], { encoding: 'utf8', cwd: ROOT }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function buildPacketMarkdown(opts: {
  issueId: string;
  prNumber: number;
  executor: Executor;
  reviewer: Executor;
  tier: string;
  laneType: string;
  lockScope: string[];
  changedFiles: string[];
  prHeadSha: string | null;
  diff: string;
  generatedAt: string;
}): string {
  return [
    `# Adversarial Review Packet — ${opts.issueId}`,
    '',
    `**Generated:** ${opts.generatedAt}`,
    `**PR:** #${opts.prNumber}`,
    `**PR Head SHA:** ${opts.prHeadSha ?? 'unknown'}`,
    `**Executor (implementor):** ${opts.executor}`,
    `**Assigned Reviewer:** ${opts.reviewer}`,
    `**Tier:** ${opts.tier}`,
    `**Lane Type:** ${opts.laneType}`,
    '',
    '## Adversarial Review Instructions',
    '',
    `You are **${opts.reviewer}** reviewing work by **${opts.executor}**.`,
    'Your goal is to find real problems, not rubber-stamp. This is an adversarial review.',
    '',
    '### Constitutional requirements',
    '- Fail closed: no silent fallback to qualified/pass/done',
    '- Domain package must be pure (no I/O, no DB, no HTTP, no env)',
    '- No self-certification — reviewer must differ from executor',
    '- Proof must be bound to merge SHA, not branch HEAD',
    '- T1 requires runtime proof against real Supabase',
    '',
    '### Review checklist (complete all)',
    '- [ ] All acceptance criteria in the Linear issue are met',
    '- [ ] No new silent failure paths introduced',
    '- [ ] No unauthorized file scope expansion',
    '- [ ] Tests are adversarial (not just happy path)',
    '- [ ] No backwards-compat shims for removed code',
    '- [ ] Domain invariants preserved if any domain code touched',
    '- [ ] Proof files are non-placeholder and schema-valid',
    '',
    '## Lock Scope (declared files)',
    ...opts.lockScope.map(f => `- ${f}`),
    '',
    '## Changed Files (actual PR diff)',
    ...(opts.changedFiles.length > 0 ? opts.changedFiles.map(f => `- ${f}`) : ['(none detected)']),
    '',
    '## Scope Bleed Check',
    'Files in changed but NOT in lock scope constitute scope bleed — blocking finding:',
    ...opts.changedFiles
      .filter(f => !opts.lockScope.includes(f))
      .map(f => `- **OUT OF SCOPE:** ${f}`),
    ...(opts.changedFiles.filter(f => !opts.lockScope.includes(f)).length === 0
      ? ['(no scope bleed detected)']
      : []),
    '',
    '## PR Diff (truncated at 8000 chars)',
    '```diff',
    opts.diff,
    '```',
    '',
    '## Recording Your Verdict',
    '',
    'When review is complete, record verdict via:',
    `\`\`\`bash`,
    `pnpm ops:review-verdict ${opts.issueId} --pr ${opts.prNumber} --pass`,
    `# or`,
    `pnpm ops:review-verdict ${opts.issueId} --pr ${opts.prNumber} --fail --finding "description"`,
    `\`\`\``,
    '',
    '**Do NOT self-certify. Reviewer must be different from executor.**',
  ].join('\n');
}

function run(options: CliOptions): ReviewPacketResult {
  const { issueId, prNumber } = options;
  const failures: string[] = [];
  const warnings: string[] = [];
  const generatedAt = new Date().toISOString();

  // --- Load manifest ---
  let executor: Executor = 'claude';
  let tier: string = 'T2';
  let laneType: string = 'governance';
  let lockScope: string[] = [];

  try {
    const manifest = readManifest(issueId);
    executor = (manifest.executor ?? 'claude') as Executor;
    tier = manifest.tier ?? 'T2';
    laneType = (manifest.lane_type ?? 'governance') as string;
    lockScope = manifest.file_scope_lock ?? [];
  } catch {
    failures.push(`Lane manifest not found for ${issueId} — cannot determine executor or tier`);
  }

  if (failures.length > 0) {
    return {
      ok: false,
      issue_id: issueId,
      pr_number: prNumber,
      executor: null,
      assigned_reviewer: null,
      review_state_path: null,
      packet_path: null,
      failures,
      warnings,
      generated_at: generatedAt,
    };
  }

  const reviewer = assignReviewer(executor);

  // --- PR metadata ---
  let changedFiles: string[] = [];
  let prHeadSha: string | null = null;
  let diff = '';

  if (prNumber != null) {
    changedFiles = getPrFiles(prNumber);
    prHeadSha = getPrHeadSha(prNumber);
    diff = getPrDiff(prNumber);
  } else {
    warnings.push('No --pr provided — diff and file change data unavailable');
  }

  // --- Scope bleed warning (blocking finding in packet, warn in CLI output) ---
  const outOfScope = changedFiles.filter(f => !lockScope.includes(f));
  if (outOfScope.length > 0) {
    warnings.push(`Scope bleed detected: ${outOfScope.join(', ')} not in file_scope_lock`);
  }

  // --- Initialize review state ---
  const existingStatePath = reviewStatePath(issueId, ROOT);
  const prNum = prNumber ?? 0;

  const reviewState = makeEmptyReviewState(issueId, prNum, executor, tier as 'T1' | 'T2' | 'T3', laneType, lockScope);
  reviewState.reviewer = reviewer;
  reviewState.reviewed_head_sha = prHeadSha;
  reviewState.changed_files = changedFiles;
  reviewState.review_status = 'in_review';

  if (fs.existsSync(existingStatePath)) {
    warnings.push(`Review state already exists at ${relativeToRoot(existingStatePath)} — overwriting`);
  }
  writeReviewState(reviewState, ROOT);

  // --- Write packet markdown ---
  const packetsDir = `${ROOT}/${PACKETS_DIR}`;
  fs.mkdirSync(packetsDir, { recursive: true });
  const packetPath = `${packetsDir}/${issueId}.md`;
  const packet = buildPacketMarkdown({
    issueId,
    prNumber: prNum,
    executor,
    reviewer,
    tier,
    laneType,
    lockScope,
    changedFiles,
    prHeadSha,
    diff,
    generatedAt,
  });
  fs.writeFileSync(packetPath, packet);

  return {
    ok: true,
    issue_id: issueId,
    pr_number: prNumber,
    executor,
    assigned_reviewer: reviewer,
    review_state_path: relativeToRoot(existingStatePath),
    packet_path: relativeToRoot(packetPath),
    failures,
    warnings,
    generated_at: generatedAt,
  };
}

function printHuman(result: ReviewPacketResult): void {
  console.log(`ops:review ${result.issue_id}${result.pr_number != null ? ` PR #${result.pr_number}` : ''}`);
  if (result.executor) console.log(`Executor: ${result.executor}`);
  if (result.assigned_reviewer) console.log(`Assigned reviewer: ${result.assigned_reviewer}`);
  if (result.review_state_path) console.log(`Review state: ${result.review_state_path}`);
  if (result.packet_path) console.log(`Packet written: ${result.packet_path}`);

  if (result.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const w of result.warnings) console.log(`  WARN  ${w}`);
  }
  if (result.failures.length > 0) {
    console.log('\nFailures:');
    for (const f of result.failures) console.log(`  FAIL  ${f}`);
    console.log('\nResult: FAIL');
  } else {
    console.log('\nReview packet generated. Assign to reviewer — do NOT mark as PASS yet.');
  }
}

const options = parseCliArgs(process.argv.slice(2));
const result = run(options);

if (options.json) {
  emitJson(result);
} else {
  printHuman(result);
}

process.exitCode = result.ok ? 0 : 1;
