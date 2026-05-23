#!/usr/bin/env tsx
/**
 * proof-binding-validator — Schema v2 proof binding gate (UTV2-1083/1088).
 *
 * Validates that a schema v2 evidence.json is correctly bound:
 *   1. sha_binding block is present; schema_version is 2
 *   2. verified_source_sha is a real 40-char hex SHA
 *   3. verified_source_sha is an ancestor of current HEAD
 *   4. Every commit between verified_source_sha and HEAD touches only proof/evidence paths
 *   5. evidence_commit_sha resolves at runtime to the commit that last changed evidence.json
 *   6. current_pr_head_sha resolves at runtime from GITHUB_SHA or git rev-parse HEAD
 *   7. No sentinel values ("set-by-ci", "validated-by-ci-at-runtime") remain in the resolved output
 *
 * Exit 0 → binding valid.
 * Exit 1 → binding invalid (gate fails).
 * Exit 2 → infrastructure error (missing files, bad args).
 *
 * Usage:
 *   tsx scripts/ci/proof-binding-validator.ts --proof-dir <dir> [--json]
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const SENTINELS = new Set(['set-by-ci', 'validated-by-ci-at-runtime']);
const SHA_RE = /^[0-9a-f]{40}$/;
const PROOF_ONLY_PREFIXES = ['docs/06_status/proof/', 'docs/06_status/lanes/'];

interface SchemaV2Evidence {
  schema_version: 2;
  issue_id: string;
  sha_binding: {
    verified_source_sha: string;
    verified_source_note?: string;
    evidence_commit_sha: string;
    current_pr_head_sha: string;
  };
}

interface ParsedArgs {
  proofDir: string;
  json: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let proofDir = '';
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--proof-dir' && argv[i + 1]) proofDir = argv[++i]!;
    else if (argv[i] === '--json') json = true;
  }
  return { proofDir, json };
}

interface BindingResult {
  schema_version: 2;
  gate: 'proof-binding-v2';
  issue_id: string;
  verified_source_sha: string;
  resolved_evidence_commit_sha: string;
  resolved_current_pr_head_sha: string;
  violations: string[];
  ok: boolean;
}

function git(cmd: string): string {
  return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
}

function isAncestor(sha: string, head: string): boolean {
  try {
    execSync(`git merge-base --is-ancestor "${sha}" "${head}"`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function changedFilesSince(sha: string, head: string): string[] {
  const out = execSync(`git diff --name-only "${sha}..${head}"`, {
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim();
  return out ? out.split('\n').filter(Boolean) : [];
}

function resolveEvidenceCommit(repoRelPath: string): string {
  try {
    return execSync(`git log --follow --format="%H" -1 -- "${repoRelPath}"`, {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
  } catch {
    return '';
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.proofDir) {
    process.stderr.write('proof-binding-validator: INFRA_ERROR — --proof-dir is required\n');
    process.exit(2);
  }

  const evidencePath = join(args.proofDir, 'evidence.json');
  if (!existsSync(evidencePath)) {
    process.stderr.write(
      `proof-binding-validator: INFRA_ERROR — evidence.json not found: ${evidencePath}\n`,
    );
    process.exit(2);
  }

  let evidence: SchemaV2Evidence;
  try {
    evidence = JSON.parse(readFileSync(evidencePath, 'utf8')) as SchemaV2Evidence;
  } catch (err) {
    process.stderr.write(
      `proof-binding-validator: INFRA_ERROR — cannot parse evidence.json: ${(err as Error).message}\n`,
    );
    process.exit(2);
  }

  const violations: string[] = [];
  const head: string = process.env['GITHUB_SHA'] ?? git('git rev-parse HEAD');

  // Rule 1: schema_version must be 2 and sha_binding must exist
  if (evidence.schema_version !== 2) {
    violations.push(
      `schema_version must be 2, got ${String(evidence.schema_version)} — upgrade evidence.json to schema v2`,
    );
  }
  const binding = evidence.sha_binding;
  if (!binding) {
    violations.push('sha_binding block is missing from evidence.json');
    emit(args, evidence, '', head, violations);
    return;
  }

  const { verified_source_sha } = binding;

  // Rule 2: verified_source_sha must be a real 40-char hex SHA
  if (!SHA_RE.test(verified_source_sha)) {
    violations.push(
      `verified_source_sha is not a valid 40-char hex SHA: "${verified_source_sha}"`,
    );
  } else {
    // Rule 3: must be an ancestor of HEAD
    if (!isAncestor(verified_source_sha, head)) {
      violations.push(
        `verified_source_sha ${verified_source_sha.slice(0, 8)} is not an ancestor of HEAD ${head.slice(0, 8)}`,
      );
    } else {
      // Rule 4: all commits between verified_source_sha and HEAD must only touch proof paths
      const changed = changedFilesSince(verified_source_sha, head);
      const nonProof = changed.filter(
        (f) => !PROOF_ONLY_PREFIXES.some((prefix) => f.startsWith(prefix)),
      );
      if (nonProof.length > 0) {
        violations.push(
          `Non-proof files changed between verified_source_sha and HEAD — ` +
          `only proof/evidence paths are allowed after the substantive commit. ` +
          `Offending files: ${nonProof.join(', ')}`,
        );
      }
    }
  }

  // Rule 5: resolve evidence_commit_sha from git log (repo-relative path)
  const repoRelPath = relative(process.cwd(), evidencePath);
  const resolvedEvidenceSha = resolveEvidenceCommit(repoRelPath);
  if (!resolvedEvidenceSha || !SHA_RE.test(resolvedEvidenceSha)) {
    violations.push(
      `Cannot resolve evidence_commit_sha: git log found no commit for ${repoRelPath}`,
    );
  }

  // Rule 6: resolve current_pr_head_sha — must be a real SHA
  if (!SHA_RE.test(head)) {
    violations.push(`current_pr_head_sha resolved to non-SHA: "${head}"`);
  }

  // Rule 7: no sentinel values in resolved output
  if (SENTINELS.has(resolvedEvidenceSha)) {
    violations.push(
      `evidence_commit_sha resolved to sentinel "${resolvedEvidenceSha}" — CI failed to populate`,
    );
  }
  if (SENTINELS.has(head)) {
    violations.push(
      `current_pr_head_sha resolved to sentinel "${head}" — CI runtime context missing`,
    );
  }

  emit(args, evidence, resolvedEvidenceSha, head, violations);
}

function emit(
  args: ParsedArgs,
  evidence: Partial<SchemaV2Evidence>,
  resolvedEvidenceSha: string,
  resolvedHeadSha: string,
  violations: string[],
): void {
  const ok = violations.length === 0;
  const result: BindingResult = {
    schema_version: 2,
    gate: 'proof-binding-v2',
    issue_id: evidence.issue_id ?? 'unknown',
    verified_source_sha: evidence.sha_binding?.verified_source_sha ?? '',
    resolved_evidence_commit_sha: resolvedEvidenceSha,
    resolved_current_pr_head_sha: resolvedHeadSha,
    violations,
    ok,
  };

  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(`proof-binding-validator\n`);
    process.stdout.write(`  issue:               ${result.issue_id}\n`);
    process.stdout.write(`  verified_source_sha: ${result.verified_source_sha.slice(0, 16) || '(missing)'}...\n`);
    process.stdout.write(`  evidence_commit_sha: ${result.resolved_evidence_commit_sha.slice(0, 16) || '(unresolved)'}...\n`);
    process.stdout.write(`  current_pr_head_sha: ${result.resolved_current_pr_head_sha.slice(0, 16) || '(unresolved)'}...\n`);
    if (violations.length > 0) {
      process.stdout.write(`\nVIOLATIONS (${violations.length}):\n`);
      for (const v of violations) {
        process.stdout.write(`  [FAIL] ${v}\n`);
      }
      process.stdout.write(`\nproof-binding-validator: FAIL\n`);
    } else {
      process.stdout.write(`\nproof-binding-validator: PASS\n`);
    }
  }

  process.exit(ok ? 0 : 1);
}

main();
