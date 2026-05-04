#!/usr/bin/env node
// fix-sync-yml.mjs — auto-repairs .ops/sync.yml after a rebase.
//
// The post-merge-lane-close GitHub Action resets sync.yml to `issues: []`
// after every merge, so every subsequent rebase conflicts on this file.
// Resolution is always: set the branch's issue ID and clear everything else.
//
// Usage:
//   node scripts/ops/fix-sync-yml.mjs              # auto-detect branch
//   node scripts/ops/fix-sync-yml.mjs UTV2-123     # explicit override
//   node scripts/ops/fix-sync-yml.mjs UNI-174

import { execSync } from 'child_process';
import { writeFileSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const syncYmlPath = resolve(repoRoot, '.ops/sync.yml');

function getBranchIssueId() {
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoRoot })
    .toString()
    .trim();

  // Branch naming: claude/utv2-NNN-slug, codex/uni-NNN-slug, feat/uni-NNN-slug
  const match = branch.match(/(?:^|\/)(utv2|uni)-(\d+)/i);
  if (!match) return null;

  const prefix = match[1].toUpperCase();
  const number = match[2];
  return `${prefix}-${number}`;
}

const explicitId = process.argv[2];
const issueId = explicitId ?? getBranchIssueId();

if (!issueId) {
  console.error('Cannot determine issue ID from branch name. Pass it explicitly:');
  console.error('  node scripts/ops/fix-sync-yml.mjs UTV2-123');
  process.exit(1);
}

const current = readFileSync(syncYmlPath, 'utf8');
const neutral = `version: 1\napproval:\n  allow_multiple_issues: true\n  skip_sync_required: false\nentities:\n  issues: []\n  findings: []\n  controls: []\n  proofs: []\n`;

const target = `version: 1\napproval:\n  allow_multiple_issues: true\n  skip_sync_required: false\nentities:\n  issues:\n    - ${issueId}\n  findings: []\n  controls: []\n  proofs: []\n`;

if (current === target) {
  console.log(`sync.yml already correct for ${issueId} — no change needed.`);
  process.exit(0);
}

if (current !== neutral && current !== target) {
  console.warn('sync.yml has unexpected content — overwriting with correct state.');
  console.warn('Current content:\n' + current);
}

writeFileSync(syncYmlPath, target, 'utf8');
console.log(`sync.yml set to ${issueId}.`);
console.log('Next: git add .ops/sync.yml && git rebase --continue');
