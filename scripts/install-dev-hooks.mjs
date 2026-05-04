#!/usr/bin/env node
// Installs local git hooks for Unit Talk V2 development workflow.
// These hooks are NOT committed — run this once per clone.
//
// Usage: node scripts/install-dev-hooks.mjs
//
// Hooks installed:
//   post-rewrite  — after `git rebase`, auto-repairs .ops/sync.yml if it was
//                   reset to neutral by the post-merge-lane-close Action

import { writeFileSync, chmodSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const hooksDir = resolve(repoRoot, '.git/hooks');

if (!existsSync(hooksDir)) {
  console.error('.git/hooks directory not found — are you in the repo root?');
  process.exit(1);
}

// post-rewrite fires after `git rebase` and `git commit --amend`.
// $1 is "rebase" or "amend". We only care about rebase.
const postRewrite = `#!/bin/sh
# Installed by scripts/install-dev-hooks.mjs
# Auto-repairs .ops/sync.yml after rebase to set the branch's issue ID.
[ "$1" = "rebase" ] || exit 0

REPO_ROOT="$(git rev-parse --show-toplevel)"
node "$REPO_ROOT/scripts/ops/fix-sync-yml.mjs" 2>/dev/null && \
  git -C "$REPO_ROOT" add .ops/sync.yml 2>/dev/null || true
`;

const hookPath = resolve(hooksDir, 'post-rewrite');
writeFileSync(hookPath, postRewrite, 'utf8');
try {
  chmodSync(hookPath, 0o755);
} catch {
  // Windows: chmod is a no-op, hooks run via node anyway
}

console.log('Installed: .git/hooks/post-rewrite');
console.log('');
console.log('After any rebase, sync.yml will auto-repair to match the branch issue ID.');
console.log('You will still need to `git rebase --continue` if there are other conflicts.');
