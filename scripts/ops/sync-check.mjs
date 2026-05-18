import { existsSync, readFileSync } from 'node:fs';

const legacySyncYml = '.ops/sync.yml';
const syncDir = '.ops/sync';
const branchPattern = /^(?:claude|codex)\/utv2-(\d+)-/i;

const branch = getCurrentBranch();
const branchIssue = extractIssueFromBranch(branch);

if (branchIssue) {
  const perIssuePath = `${syncDir}/${branchIssue}.yml`;
  if (existsSync(perIssuePath)) {
    const syncIssue = extractIssueFromSync(perIssuePath);
    if (!syncIssue) {
      console.error(`\n[sync-check] MISSING: ${perIssuePath} exists but declares no issues.`);
      console.error(`  Add entities.issues: [${branchIssue}] to ${perIssuePath}.\n`);
      process.exit(1);
    }
    if (syncIssue.toUpperCase() !== branchIssue.toUpperCase()) {
      console.error(`\n[sync-check] MISMATCH: ${perIssuePath} lists "${syncIssue}" but branch "${branch}" expects "${branchIssue}".`);
      process.exit(1);
    }
    console.log(`[sync-check] OK (per-issue): branch "${branch}" <-> ${perIssuePath}`);
    process.exit(0);
  }

  const syncIssue = extractIssueFromSync(legacySyncYml);
  if (syncIssue && syncIssue.toUpperCase() !== branchIssue.toUpperCase()) {
    console.error(`\n[sync-check] MISMATCH: .ops/sync.yml lists "${syncIssue}" but branch "${branch}" expects "${branchIssue}".`);
    console.error(`  Create .ops/sync/${branchIssue}.yml with entities.issues: [${branchIssue}] to fix this permanently.\n`);
    process.exit(1);
  }
  if (syncIssue) {
    console.log(`[sync-check] OK (legacy): branch "${branch}" <-> sync.yml "${syncIssue}"`);
  }
}

function getCurrentBranch() {
  try {
    const head = readFileSync('.git/HEAD', 'utf8').trim();
    const prefix = 'ref: refs/heads/';
    return head.startsWith(prefix) ? head.slice(prefix.length) : 'HEAD';
  } catch (error) {
    console.error(`[sync-check] Unable to read .git/HEAD: ${error instanceof Error ? error.message : String(error)}`);
    return 'HEAD';
  }
}

function extractIssueFromBranch(branchName) {
  const match = branchName.match(branchPattern);
  return match ? `UTV2-${match[1]}` : null;
}

function extractIssueFromSync(syncPath) {
  if (!existsSync(syncPath)) return null;
  const content = readFileSync(syncPath, 'utf8');
  const inlineIssues = content.match(/^\s*issues:\s*\[\s*['"]?([A-Z0-9]+-\d+)['"]?\s*\]/im);
  if (inlineIssues?.[1]) return inlineIssues[1];
  const blockIssues = content.match(/^\s*issues:\s*\r?\n\s*-\s*['"]?([A-Z0-9]+-\d+)['"]?/im);
  if (blockIssues?.[1]) return blockIssues[1];
  const nestedIssues = content.match(/^\s*issues:\s*\r?\n(?:\s*#.*\r?\n|\s*\r?\n)*\s*-\s*['"]?([A-Z0-9]+-\d+)['"]?/im);
  return nestedIssues?.[1] ?? null;
}
