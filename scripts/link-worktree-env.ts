#!/usr/bin/env tsx
/**
 * link-worktree-env.ts
 *
 * Safely expose the main worktree's credential files to a target git worktree
 * without copying them. Uses **hardlinks** (fs.linkSync): both the source and
 * the target worktree path refer to the same inode, so edits in one place are
 * immediately visible from the other. Flipping a flag cannot silently diverge.
 *
 * Why hardlinks instead of symlinks: symlinks require Developer Mode or an
 * elevated shell on Windows, which is friction we don't need. Hardlinks work
 * on Windows, macOS, and Linux without any privilege escalation. The tradeoff:
 * hardlinks cannot span filesystems — source and target must be on the same
 * volume. For this repo, worktrees always live under the main worktree's
 * directory tree, so they share the same volume by construction.
 *
 * Why this exists
 * ---------------
 * On 2026-04-10 (UTV2-519 execution), a lane copied `local.env` into its
 * worktree so it could run `pnpm test:db`. The copy later shadowed the main
 * worktree's edits — specifically, `SYSTEM_PICK_SCANNER_ENABLED` silently
 * reverted from `false` to `true` when the worktree's stale copy was read.
 * This helper replaces that ad-hoc pattern with a safe, idempotent hardlink.
 *
 * Scope
 * -----
 * - Whitelisted files only. Adding a new file requires editing WHITELIST below.
 * - Refuses to overwrite a regular file in the target worktree unless it is
 *   already a hardlink to the corresponding source file (identified by inode).
 * - Idempotent: re-running against an already-linked worktree is a no-op.
 * - Idempotent cleanup: passing --unlink removes only entries whose inode
 *   matches the source, leaving unrelated files untouched.
 * - Does not follow or resolve anything outside the repo root.
 *
 * Usage
 * -----
 *   npx tsx scripts/link-worktree-env.ts <worktree-path>
 *   npx tsx scripts/link-worktree-env.ts --unlink <worktree-path>
 *   npx tsx scripts/link-worktree-env.ts --check <worktree-path>
 *
 * The worktree path can be absolute or relative to the current working
 * directory. It must resolve to a directory that is a sibling of (or inside)
 * the main repo — links outside the repo root are refused.
 */

import { mkdirSync, existsSync, lstatSync, statSync, linkSync, unlinkSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Whitelist — the only files this helper will ever link
// ---------------------------------------------------------------------------
// Paths are repo-root-relative. Each entry will be linked into the target
// worktree at the same relative path.
//
// Add a new entry here only if:
//   1. The file is gitignored (never checked into the repo)
//   2. It contains credentials or environment state needed by `pnpm test:db`
//      or similar verification-only tasks
//   3. Duplicating it via file-copy would create a drift risk (state that
//      can diverge between the main worktree and the lane worktree)
//
// Do NOT add runtime source, test data, migrations, or anything mutable by
// the lane's task. This helper is for credentials only.
const WHITELIST: readonly string[] = [
  'local.env',
  'supabase/.temp/project-ref',
];

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

type Mode = 'link' | 'unlink' | 'check';

interface CliArgs {
  mode: Mode;
  target: string;
}

function printUsage(): void {
  console.error('Usage:');
  console.error('  npx tsx scripts/link-worktree-env.ts <worktree-path>');
  console.error('  npx tsx scripts/link-worktree-env.ts --unlink <worktree-path>');
  console.error('  npx tsx scripts/link-worktree-env.ts --check <worktree-path>');
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args = argv.slice(2);
  if (args.length === 0) {
    printUsage();
    process.exit(2);
  }

  let mode: Mode = 'link';
  let target: string | undefined;

  for (const arg of args) {
    if (arg === '--unlink') {
      mode = 'unlink';
    } else if (arg === '--check') {
      mode = 'check';
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else if (arg.startsWith('--')) {
      console.error(`Unknown flag: ${arg}`);
      printUsage();
      process.exit(2);
    } else if (target === undefined) {
      target = arg;
    } else {
      console.error(`Unexpected argument: ${arg}`);
      printUsage();
      process.exit(2);
    }
  }

  if (target === undefined) {
    console.error('Missing <worktree-path>');
    printUsage();
    process.exit(2);
  }

  return { mode, target };
}

// ---------------------------------------------------------------------------
// Repo-root resolution
// ---------------------------------------------------------------------------

function findRepoRoot(): string {
  // This script lives at <repo-root>/scripts/link-worktree-env.ts
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(here, '..');
  if (!existsSync(join(root, 'package.json'))) {
    throw new Error(`Cannot locate repo root: ${root} does not contain package.json`);
  }
  return realpathSync(root);
}

function resolveTarget(rawTarget: string): string {
  const abs = isAbsolute(rawTarget) ? rawTarget : resolve(process.cwd(), rawTarget);
  if (!existsSync(abs)) {
    throw new Error(`Target worktree does not exist: ${abs}`);
  }
  const stats = lstatSync(abs);
  if (!stats.isDirectory()) {
    throw new Error(`Target is not a directory: ${abs}`);
  }
  return realpathSync(abs);
}

// ---------------------------------------------------------------------------
// Safety: refuse to touch the main worktree itself
// ---------------------------------------------------------------------------

function assertNotMainWorktree(repoRoot: string, target: string): void {
  if (repoRoot === target) {
    throw new Error(
      'Refusing to link the main worktree to itself. This helper is for ' +
        'git worktree children created under .claude/worktrees/ or similar.',
    );
  }
}

// ---------------------------------------------------------------------------
// Safety: refuse to escape the repo root
// ---------------------------------------------------------------------------

function assertInsideRepoOrSibling(repoRoot: string, target: string): void {
  const rel = relative(repoRoot, target);
  // A sibling directory (e.g. adjacent worktrees dir) relative path will
  // start with '..'. A nested directory will not. Reject anything that
  // climbs more than one level up, and reject absolute paths that aren't
  // under the repo's parent.
  if (rel.startsWith(`..${sep}..`)) {
    throw new Error(
      `Refusing to link outside repo scope: target ${target} is not under ` +
        `${repoRoot} or its parent directory.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Link / unlink / check operations
// ---------------------------------------------------------------------------

interface FileOutcome {
  path: string;
  action: 'linked' | 'already-linked' | 'skipped-missing-source' | 'skipped-existing-file' | 'unlinked' | 'no-link' | 'check-ok' | 'check-diverged' | 'check-missing';
  detail?: string;
}

function inodeOf(p: string): bigint | null {
  try {
    // Use bigint ino to sidestep the JS number precision ceiling on exotic FS.
    const s = statSync(p, { bigint: true });
    return s.ino;
  } catch {
    return null;
  }
}

function sameInode(a: string, b: string): boolean {
  const ia = inodeOf(a);
  const ib = inodeOf(b);
  if (ia === null || ib === null) return false;
  return ia === ib;
}

function linkFile(repoRoot: string, target: string, relPath: string): FileOutcome {
  const source = join(repoRoot, relPath);
  const dest = join(target, relPath);

  if (!existsSync(source)) {
    return { path: relPath, action: 'skipped-missing-source', detail: `source not present at ${source}` };
  }

  // Ensure dest directory exists
  mkdirSync(dirname(dest), { recursive: true });

  // Dest already exists?
  if (existsSync(dest) || lstatSafe(dest) !== null) {
    if (sameInode(source, dest)) {
      return { path: relPath, action: 'already-linked', detail: `hardlink to ${source}` };
    }
    // Different file (or a stale non-hardlink copy) — refuse to overwrite
    return {
      path: relPath,
      action: 'skipped-existing-file',
      detail: `distinct file present at ${dest}; remove it manually first if you intend to replace it with a hardlink`,
    };
  }

  try {
    linkSync(source, dest);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    let hint = '';
    if (code === 'EXDEV') {
      hint = ' (source and target are on different filesystems; hardlinks cannot span volumes)';
    } else if (code === 'EPERM') {
      hint = ' (check that the target directory is writable by this user)';
    }
    throw new Error(`Failed to create hardlink at ${dest}: ${(err as Error).message}${hint}`);
  }

  return { path: relPath, action: 'linked', detail: `hardlink to ${source}` };
}

function unlinkFile(repoRoot: string, target: string, relPath: string): FileOutcome {
  const source = join(repoRoot, relPath);
  const dest = join(target, relPath);

  if (lstatSafe(dest) === null) {
    return { path: relPath, action: 'no-link', detail: 'nothing to unlink' };
  }

  if (!sameInode(source, dest)) {
    return {
      path: relPath,
      action: 'no-link',
      detail: `file at ${dest} is not a hardlink to our source ${source} (different inode); leaving it alone`,
    };
  }

  unlinkSync(dest);
  return { path: relPath, action: 'unlinked' };
}

function checkFile(repoRoot: string, target: string, relPath: string): FileOutcome {
  const source = join(repoRoot, relPath);
  const dest = join(target, relPath);

  if (lstatSafe(dest) === null) {
    return { path: relPath, action: 'check-missing' };
  }

  if (!sameInode(source, dest)) {
    return {
      path: relPath,
      action: 'check-diverged',
      detail: `file at ${dest} is not a hardlink to ${source} — state may have diverged from main worktree`,
    };
  }

  return { path: relPath, action: 'check-ok', detail: `hardlink to ${source}` };
}

function lstatSafe(p: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const { mode, target } = parseArgs(process.argv);

  const repoRoot = findRepoRoot();
  const resolvedTarget = resolveTarget(target);

  assertNotMainWorktree(repoRoot, resolvedTarget);
  assertInsideRepoOrSibling(repoRoot, resolvedTarget);

  console.log(`repoRoot: ${repoRoot}`);
  console.log(`target:   ${resolvedTarget}`);
  console.log(`mode:     ${mode}`);
  console.log('whitelist:');
  for (const f of WHITELIST) {
    console.log(`  - ${f}`);
  }
  console.log('');

  const outcomes: FileOutcome[] = [];
  for (const relPath of WHITELIST) {
    try {
      if (mode === 'link') {
        outcomes.push(linkFile(repoRoot, resolvedTarget, relPath));
      } else if (mode === 'unlink') {
        outcomes.push(unlinkFile(repoRoot, resolvedTarget, relPath));
      } else {
        outcomes.push(checkFile(repoRoot, resolvedTarget, relPath));
      }
    } catch (err) {
      console.error(`ERROR processing ${relPath}: ${(err as Error).message}`);
      process.exitCode = 1;
      outcomes.push({ path: relPath, action: 'skipped-existing-file', detail: (err as Error).message });
    }
  }

  for (const o of outcomes) {
    const detail = o.detail !== undefined ? ` ${o.detail}` : '';
    console.log(`  [${o.action}] ${o.path}${detail}`);
  }

  // Exit non-zero for check-mode divergences so callers can gate on it
  if (mode === 'check') {
    const diverged = outcomes.some(
      (o) => o.action === 'check-diverged' || o.action === 'check-missing',
    );
    if (diverged) {
      console.error('\nCheck failed: one or more entries are not linked correctly.');
      process.exit(1);
    }
  }
}

try {
  main();
} catch (err) {
  console.error(`ERROR: ${(err as Error).message}`);
  process.exit(1);
}
