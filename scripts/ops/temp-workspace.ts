/**
 * UTV2-1949 — governed temporary workspaces for tests and scripts.
 *
 * Test suites created temporary directories with `fs.mkdtempSync` and never removed
 * them. They accumulated across every `pnpm test` run until the `/tmp` tmpfs *inode*
 * table was exhausted, at which point unrelated suites failed with ENOSPC — blocking
 * `pnpm test`, `pnpm verify`, `ops:preflight` gate PB2, and therefore every lane.
 *
 * This module is deliberately NOT a `/tmp` sweeper. It removes only the directories
 * this process created, and only those. It never scans, matches or deletes anything
 * it did not make itself.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const created = new Set<string>();
let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  // `exit` fires for normal completion, an uncaught throw, and an explicit
  // process.exit(), so a failing test still releases its inodes.
  process.on('exit', () => {
    cleanupTempWorkspaces();
  });
}

/**
 * Create a temporary directory that is removed when the process exits.
 *
 * Drop-in replacement for `fs.mkdtempSync(path.join(os.tmpdir(), prefix))`.
 */
export function createTempWorkspace(prefix: string): string {
  installExitHook();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.add(dir);
  return dir;
}

/**
 * Remove a workspace before process exit. Safe to call on a path this module did
 * not create — in that case it is a no-op, so a caller can never use this helper
 * to delete an arbitrary directory.
 */
export function releaseTempWorkspace(dir: string): void {
  if (!created.has(dir)) return;
  created.delete(dir);
  removeQuietly(dir);
}

/** Remove every workspace this process created. Idempotent. */
export function cleanupTempWorkspaces(): void {
  for (const dir of created) {
    removeQuietly(dir);
  }
  created.clear();
}

/** Paths this process created and has not yet released. Exposed for tests. */
export function trackedTempWorkspaces(): readonly string[] {
  return [...created];
}

function removeQuietly(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Cleanup must never fail a test run or mask the real failure. An inode that
    // cannot be released is a smaller problem than a swallowed assertion error.
  }
}
