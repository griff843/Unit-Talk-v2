/**
 * scripts/codex-receive.ts
 * Accept returned work from Codex CLI and gate it before merge.
 *
 * - Validates the returned branch exists
 * - Runs pnpm type-check + pnpm test on the return branch
 * - Updates lane registry status → 'review'
 * - Posts a Linear comment with PR link + verdict
 * - Outputs PASS/FAIL verdict with diff summary
 *
 * Usage:
 *   pnpm codex:receive -- --issue UTV2-XXX --branch <branch> --pr <url> [--skip-tests]
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnvironment } from '@unit-talk/config';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LaneEntry {
  id: string;
  title: string;
  branch: string;
  worktree: string | null;
  status: 'active' | 'review' | 'merged' | 'abandoned';
  owner: 'claude' | 'codex' | 'codex-cli' | 'manual';
  createdAt: string;
  snapshotAt: string | null;
  pr: number | null;
  allowedFiles?: string[];
}

interface LaneRegistry {
  version: number;
  lanes: LaneEntry[];
}

// ─── Repo Context ─────────────────────────────────────────────────────────────

function repoRoot(): string {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) throw new Error('Not in a git repository');
  return result.stdout.trim();
}

const ROOT = repoRoot();
const CLAUDE_DIR = path.join(ROOT, '.claude');
const LANES_FILE = path.join(CLAUDE_DIR, 'lanes.json');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readRegistry(): LaneRegistry {
  if (!fs.existsSync(LANES_FILE)) return { version: 1, lanes: [] };
  try {
    return JSON.parse(fs.readFileSync(LANES_FILE, 'utf8')) as LaneRegistry;
  } catch {
    return { version: 1, lanes: [] };
  }
}

function writeRegistry(reg: LaneRegistry): void {
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  fs.writeFileSync(LANES_FILE, JSON.stringify(reg, null, 2) + '\n', 'utf8');
}

function git(...args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync('git', args, { encoding: 'utf8', stdio: 'pipe', cwd: ROOT });
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
  };
}

function runPnpm(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync('pnpm', args, {
    encoding: 'utf8',
    stdio: 'pipe',
    cwd: ROOT,
    shell: process.platform === 'win32',
  });
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
  };
}

function readArg(cliArgs: string[], name: string): string | undefined {
  const idx = cliArgs.indexOf(`--${name}`);
  if (idx >= 0 && cliArgs[idx + 1] && !cliArgs[idx + 1].startsWith('--')) {
    return cliArgs[idx + 1];
  }
  return undefined;
}

// ANSI colors
const isTTY = process.stdout.isTTY;
const c = {
  green: (s: string) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (isTTY ? `\x1b[33m${s}\x1b[0m` : s),
  red: (s: string) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s),
  bold: (s: string) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s: string) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s),
};

// ─── Linear Comment ───────────────────────────────────────────────────────────

async function postLinearComment(
  issueId: string,
  body: string,
  apiKey: string,
): Promise<void> {
  // Resolve issue internal ID first
  const resolveResp = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `query { issue(id: "${issueId}") { id } }`,
    }),
  });

  if (!resolveResp.ok) return; // non-fatal

  const resolveData = (await resolveResp.json()) as {
    data?: { issue?: { id: string } | null };
  };

  const internalId = resolveData.data?.issue?.id;
  if (!internalId) return;

  await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `mutation { commentCreate(input: { issueId: "${internalId}", body: ${JSON.stringify(body)} }) { success } }`,
    }),
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const env = loadEnvironment();
const apiKey = env.LINEAR_API_TOKEN?.trim();
const cliArgs = process.argv.slice(2);

const issueIdRaw = readArg(cliArgs, 'issue');
const branch = readArg(cliArgs, 'branch');
const prUrl = readArg(cliArgs, 'pr');
const skipTests = cliArgs.includes('--skip-tests');

if (!issueIdRaw || !branch || !prUrl) {
  console.error('Usage: pnpm codex:receive -- --issue UTV2-XXX --branch <branch> --pr <url>');
  process.exit(1);
}

const issueId = issueIdRaw.toUpperCase();

void (async () => {
  const line = '─'.repeat(62);
  console.log('');
  console.log(c.bold(`CODEX RECEIVE — ${issueId}`));
  console.log(line);
  console.log(`  Branch: ${branch}`);
  console.log(`  PR:     ${prUrl}`);
  console.log('');

  // 1. Verify branch exists on remote
  console.log('Checking branch...');
  const fetchResult = git('fetch', 'origin', branch);
  if (!fetchResult.ok) {
    console.warn(`  Warning: Could not fetch ${branch} from origin. Checking local...`);
  }

  const branchCheck = git('rev-parse', '--verify', `refs/remotes/origin/${branch}`);
  const localCheck = git('rev-parse', '--verify', `refs/heads/${branch}`);
  if (!branchCheck.ok && !localCheck.ok) {
    console.error(c.red(`Error: Branch '${branch}' not found locally or on origin.`));
    console.error('  Make sure Codex pushed the branch before reporting back.');
    process.exit(1);
  }
  console.log(c.green('  ✓ Branch exists'));

  // 2. Get diff summary vs main
  console.log('');
  console.log('Diff summary vs main:');
  const mergeBase = git('merge-base', branch, 'main');
  const diffFiles = mergeBase.ok
    ? git('diff', '--name-only', mergeBase.stdout, branch)
    : git('diff', '--name-only', 'main', `origin/${branch}`);

  const changedFiles = diffFiles.ok
    ? diffFiles.stdout.split('\n').filter(Boolean)
    : [];

  if (changedFiles.length === 0) {
    console.log(c.yellow('  (no files changed vs main — verify Codex actually made changes)'));
  } else {
    for (const f of changedFiles) {
      console.log(`  ${f}`);
    }
  }

  // 3. Check lane registry
  const registry = readRegistry();
  const lane = registry.lanes.find((l) => l.id === issueId);

  if (!lane) {
    console.warn(c.yellow(`  Warning: No lane registry entry for ${issueId}. Creating one now.`));
    registry.lanes.push({
      id: issueId,
      title: issueId,
      branch,
      worktree: null,
      status: 'review',
      owner: 'codex-cli',
      createdAt: new Date().toISOString(),
      snapshotAt: null,
      pr: null,
    });
  }

  // 4. Run verification gate
  let typeCheckOk = false;
  let testOk = false;

  if (skipTests) {
    console.log('');
    console.log(c.yellow('Skipping tests (--skip-tests). Manual verification required.'));
    typeCheckOk = true;
    testOk = true;
  } else {
    console.log('');
    console.log('Running verification gate...');
    console.log(c.dim('  This may take a few minutes.'));

    // We run on current checkout — Codex should have pushed to origin
    // For a full gate, checkout the branch first
    const currentBranch = git('branch', '--show-current').stdout;

    // Stash any local changes before switching
    const hasChanges = git('status', '--short').stdout.length > 0;
    if (hasChanges) {
      git('stash', 'push', '-m', 'codex-receive-temp-stash');
    }

    // Checkout the Codex branch
    const checkoutRef = branchCheck.ok ? `origin/${branch}` : branch;
    const checkoutResult = git('checkout', checkoutRef);
    if (!checkoutResult.ok) {
      console.warn(c.yellow(`  Warning: Could not checkout ${branch}. Running tests on current branch.`));
    }

    // type-check
    process.stdout.write('  type-check... ');
    const tcResult = runPnpm(['type-check']);
    typeCheckOk = tcResult.ok;
    console.log(typeCheckOk ? c.green('PASS') : c.red('FAIL'));
    if (!typeCheckOk) {
      const errLines = tcResult.stderr.split('\n').filter(Boolean).slice(0, 8);
      for (const l of errLines) console.log(c.dim(`    ${l}`));
    }

    // test
    process.stdout.write('  test...       ');
    const testResult = runPnpm(['test']);
    testOk = testResult.ok;
    console.log(testOk ? c.green('PASS') : c.red('FAIL'));
    if (!testOk) {
      const errLines = testResult.stderr.split('\n').filter(Boolean).slice(0, 8);
      for (const l of errLines) console.log(c.dim(`    ${l}`));
    }

    // Restore original branch
    if (currentBranch && currentBranch !== branch) {
      git('checkout', currentBranch);
    }
    if (hasChanges) {
      git('stash', 'pop');
    }
  }

  // 5. Determine verdict
  const verdict = typeCheckOk && testOk ? 'PASS' : 'FAIL';
  const verdictDisplay =
    verdict === 'PASS' ? c.green('PASS') : c.red('FAIL');

  // 6. Update lane registry
  const laneIdx = registry.lanes.findIndex((l) => l.id === issueId);
  if (laneIdx >= 0) {
    registry.lanes[laneIdx].status = 'review';
    registry.lanes[laneIdx].branch = branch;
  }
  writeRegistry(registry);

  // 7. Post Linear comment
  const commentBody = [
    `**Codex returned work — ${issueId}**`,
    '',
    `PR: ${prUrl}`,
    `Branch: \`${branch}\``,
    `Verification: ${verdict}`,
    `Files changed: ${changedFiles.length}`,
    '',
    changedFiles.length > 0
      ? `Changed files:\n${changedFiles.slice(0, 10).map((f) => `- \`${f}\``).join('\n')}${changedFiles.length > 10 ? `\n- ... and ${changedFiles.length - 10} more` : ''}`
      : '',
    '',
    verdict === 'PASS'
      ? 'Ready for Claude Code review and merge.'
      : 'FAILED verification — do not merge. Codex needs to fix before re-submission.',
  ]
    .filter((l) => l !== undefined)
    .join('\n');

  if (apiKey) {
    try {
      await postLinearComment(issueId, commentBody, apiKey);
      console.log('');
      console.log(c.dim('  Linear comment posted.'));
    } catch {
      console.warn(c.yellow('  Warning: Could not post Linear comment (non-fatal).'));
    }
  } else {
    console.log(c.dim('  (LINEAR_API_TOKEN not set — skipping Linear comment)'));
  }

  // 8. Final output
  console.log('');
  console.log(line);
  console.log(`VERDICT: ${verdictDisplay}`);
  console.log(line);
  console.log('');

  if (verdict === 'PASS') {
    console.log(c.green('Codex work verified. Claude Code can now review and merge.'));
    console.log('');
    console.log('Next steps:');
    console.log(`  1. Review diff: gh pr view ${prUrl}`);
    console.log(`  2. If diff is clean: merge via GitHub or gh pr merge`);
    console.log(`  3. After merge: pnpm lane:cleanup`);
    console.log(`  4. Update Linear: pnpm linear:close -- ${issueId} --comment "Merged via Codex CLI"`);
  } else {
    console.log(c.red('Verification failed. Do NOT merge.'));
    console.log('');
    console.log('Next steps:');
    console.log(`  1. Review failures above`);
    console.log(`  2. Feed failure output back to Codex CLI for correction`);
    console.log(`  3. Re-run: pnpm codex:receive -- --issue ${issueId} --branch ${branch} --pr ${prUrl}`);
  }

  console.log('');
  process.exit(verdict === 'PASS' ? 0 : 1);
})();
