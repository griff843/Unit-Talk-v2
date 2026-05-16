/**
 * ops:scope-diff — Codex scope bleed detection (EXECUTION_TRUTH_MODEL.md §5)
 *
 * Compares files changed on a branch/PR against the declared file_scope_lock
 * in the lane manifest. Surfaces two categories:
 *
 *   bleed:    files changed but NOT covered by any file_scope_lock pattern
 *   unused:   file_scope_lock patterns that matched no changed files (advisory)
 *
 * Usage:
 *   pnpm exec tsx scripts/ops/scope-diff.ts --issue UTV2-929
 *   pnpm exec tsx scripts/ops/scope-diff.ts --issue UTV2-929 --base <sha> --head <sha>
 *   pnpm exec tsx scripts/ops/scope-diff.ts --issue UTV2-929 --json
 *
 * Exit codes:
 *   0 — no scope bleed
 *   1 — scope bleed detected (files outside declared scope)
 *   2 — configuration error (missing manifest, invalid args)
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, emitJson, type LaneManifest } from './shared.js';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ScopeDiffReport {
  schema_version: 1;
  generated_at: string;
  issue_id: string;
  branch: string;
  base_ref: string | null;
  head_ref: string | null;
  declared_scope: string[];
  changed_files: string[];
  bleed: string[];
  unused_locks: string[];
  verdict: 'clean' | 'bleed';
  summary: string;
}

// ── Git helpers ────────────────────────────────────────────────────────────────

function getChangedFiles(baseRef: string | null, headRef: string | null): string[] {
  const args = baseRef && headRef
    ? ['diff', '--name-only', baseRef, headRef]
    : ['diff', '--name-only', 'HEAD^', 'HEAD'];

  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (result.error || result.status !== 0) {
    // Fallback: staged + unstaged changes
    const fallback = spawnSync('git', ['diff', '--name-only', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return (fallback.stdout ?? '').split('\n').map((f) => f.trim()).filter(Boolean);
  }

  return (result.stdout ?? '').split('\n').map((f) => f.trim()).filter(Boolean);
}

// ── Scope matching ─────────────────────────────────────────────────────────────

function matchesPattern(filePath: string, pattern: string): boolean {
  const normalized = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
  const file = filePath.replace(/\\/g, '/').replace(/^\.\//, '');

  if (normalized.endsWith('/**')) {
    const prefix = normalized.slice(0, -3);
    return file === prefix || file.startsWith(prefix + '/');
  }
  if (normalized.endsWith('/*')) {
    const prefix = normalized.slice(0, -2);
    const rest = file.slice(prefix.length + 1);
    return file.startsWith(prefix + '/') && !rest.includes('/');
  }
  return file === normalized || file.startsWith(normalized + '/');
}

function isInScope(filePath: string, scopeLocks: string[]): boolean {
  return scopeLocks.some((lock) => matchesPattern(filePath, lock));
}

function lockMatchesAny(lock: string, changedFiles: string[]): boolean {
  return changedFiles.some((f) => matchesPattern(f, lock));
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);

  let issueId: string | null = null;
  let baseRef: string | null = null;
  let headRef: string | null = null;
  let jsonMode = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--issue' && args[i + 1]) { issueId = args[++i].toUpperCase(); }
    else if (args[i] === '--base' && args[i + 1]) { baseRef = args[++i]; }
    else if (args[i] === '--head' && args[i + 1]) { headRef = args[++i]; }
    else if (args[i] === '--json') { jsonMode = true; }
  }

  if (!issueId) {
    // Try to infer from current branch
    const branchResult = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: ROOT, encoding: 'utf8', stdio: 'pipe',
    });
    const branchName = (branchResult.stdout ?? '').trim();
    const match = branchName.match(/utv2-(\d+)/i);
    if (match) {
      issueId = `UTV2-${match[1]}`;
    }
  }

  if (!issueId) {
    const msg = 'Missing --issue <UTV2-###>. Cannot infer issue ID from branch name.';
    if (jsonMode) { emitJson({ ok: false, code: 'missing_issue_id', message: msg }); }
    else { console.error(`[ops:scope-diff] ERROR: ${msg}`); }
    process.exit(2);
  }

  // Load manifest
  const manifestPath = path.join(ROOT, 'docs', '06_status', 'lanes', `${issueId}.json`);
  if (!fs.existsSync(manifestPath)) {
    const msg = `No lane manifest found at ${manifestPath}`;
    if (jsonMode) { emitJson({ ok: false, code: 'missing_manifest', message: msg }); }
    else { console.error(`[ops:scope-diff] ERROR: ${msg}`); }
    process.exit(2);
  }

  let manifest: LaneManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as LaneManifest;
  } catch (err) {
    const msg = `Failed to parse manifest: ${String(err)}`;
    if (jsonMode) { emitJson({ ok: false, code: 'manifest_parse_error', message: msg }); }
    else { console.error(`[ops:scope-diff] ERROR: ${msg}`); }
    process.exit(2);
  }

  const declaredScope = Array.isArray(manifest.file_scope_lock) ? manifest.file_scope_lock : [];
  const changedFiles = getChangedFiles(baseRef, headRef);

  // Detect bleed: files changed outside declared scope
  const bleed = changedFiles.filter((f) => !isInScope(f, declaredScope));

  // Detect unused locks (advisory)
  const unusedLocks = declaredScope.filter((lock) => !lockMatchesAny(lock, changedFiles));

  const verdict: ScopeDiffReport['verdict'] = bleed.length > 0 ? 'bleed' : 'clean';
  const summary = verdict === 'clean'
    ? `All ${changedFiles.length} changed files within declared scope (${declaredScope.length} locks)`
    : `SCOPE BLEED: ${bleed.length} file(s) outside declared scope of ${issueId}`;

  const report: ScopeDiffReport = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    issue_id: issueId,
    branch: manifest.branch ?? 'unknown',
    base_ref: baseRef,
    head_ref: headRef,
    declared_scope: declaredScope,
    changed_files: changedFiles,
    bleed,
    unused_locks: unusedLocks,
    verdict,
    summary,
  };

  if (jsonMode) {
    emitJson(report);
  } else {
    console.log(`[ops:scope-diff] ${issueId} verdict=${verdict}`);
    console.log(`  changed: ${changedFiles.length}  declared_scope: ${declaredScope.length}`);

    if (bleed.length > 0) {
      console.error(`  BLEED (${bleed.length} files outside scope):`);
      for (const f of bleed) { console.error(`    ! ${f}`); }
    } else {
      console.log(`  clean — all changes within declared scope`);
    }

    if (unusedLocks.length > 0) {
      console.log(`  unused locks (advisory, ${unusedLocks.length}):`);
      for (const l of unusedLocks) { console.log(`    - ${l}`); }
    }
  }

  process.exit(verdict === 'bleed' ? 1 : 0);
}

main();
