/**
 * scripts/codex-dispatch.ts
 * Generate a Codex CLI task packet for a Linear issue.
 *
 * - Reads the issue from Linear
 * - Checks lane registry for active file-overlap conflicts
 * - Generates a copy-paste-ready Codex task packet
 * - Writes packet to .claude/codex-queue/<issue-id>.md
 * - Registers the lane in .claude/lanes.json with owner: 'codex-cli'
 *
 * Usage:
 *   pnpm codex:dispatch -- --issue UTV2-XXX [--allowed "file1,file2"] [--forbidden "file3"] [--dry-run]
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  branchName?: string | null;
  description?: string | null;
  priority?: number | null;
  labels?: { nodes: Array<{ name: string }> } | null;
  project?: { name: string } | null;
  state?: { name: string } | null;
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
const CODEX_QUEUE_DIR = path.join(CLAUDE_DIR, 'codex-queue');

// ─── Registry Helpers ─────────────────────────────────────────────────────────

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

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

// ─── File Overlap Detection ───────────────────────────────────────────────────

function checkFileOverlap(
  registry: LaneRegistry,
  candidateFiles: string[],
): { conflict: boolean; lane: string | null; files: string[] } {
  if (candidateFiles.length === 0) return { conflict: false, lane: null, files: [] };

  for (const lane of registry.lanes) {
    if (lane.status !== 'active') continue;
    if (!lane.allowedFiles || lane.allowedFiles.length === 0) continue;

    const overlap = candidateFiles.filter((f) =>
      lane.allowedFiles!.some((lf) => f === lf || f.startsWith(lf) || lf.startsWith(f)),
    );

    if (overlap.length > 0) {
      return { conflict: true, lane: lane.id, files: overlap };
    }
  }

  return { conflict: false, lane: null, files: [] };
}

// ─── Linear API ───────────────────────────────────────────────────────────────

async function fetchIssue(identifier: string, apiKey: string): Promise<LinearIssue> {
  const query = `
    query FetchIssue($id: String!) {
      issue(id: $id) {
        id
        identifier
        title
        url
        branchName
        description
        priority
        project { name }
        labels(first: 8) { nodes { name } }
        state { name }
      }
    }
  `;

  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { id: identifier } }),
  });

  if (!response.ok) {
    throw new Error(`Linear API error: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as {
    data?: { issue: LinearIssue | null };
    errors?: Array<{ message?: string }>;
  };

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((e) => e.message ?? 'Unknown').join('; '));
  }

  const issue = payload.data?.issue;
  if (!issue) throw new Error(`Issue not found: ${identifier}`);
  return issue;
}

// ─── Packet Generator ─────────────────────────────────────────────────────────

function generatePacket(
  issue: LinearIssue,
  allowedFiles: string[],
  forbiddenFiles: string[],
): string {
  const labels = issue.labels?.nodes.map((l) => l.name).join(', ') ?? '';
  const priority = issue.priority != null ? `P${issue.priority}` : 'unset';
  const project = issue.project?.name ?? 'n/a';
  const description = issue.description?.trim() ?? '(no description in Linear)';

  const allowedSection =
    allowedFiles.length > 0
      ? allowedFiles.map((f) => `* ${f}`).join('\n')
      : '* (not yet specified — fill in before pasting to Codex)';

  const forbiddenSection =
    forbiddenFiles.length > 0
      ? forbiddenFiles.map((f) => `* ${f}`).join('\n')
      : '* all files not in the allowed list above';

  const branchName = issue.branchName ?? `feat/${issue.identifier.toLowerCase()}`;

  return `# Codex Task Packet — ${issue.identifier}

Generated: ${new Date().toISOString()}
Issue URL: ${issue.url}
Priority: ${priority} | Project: ${project} | Labels: ${labels}

---

Work only this Linear issue.

You are not exploring the repo. You are executing a bounded task packet.

Required output:
1. implement only the scoped issue
2. touch only allowed files
3. do not modify forbidden files
4. run the required verification commands
5. summarize what changed
6. provide PR-ready summary
7. stop if scope is ambiguous or collides with active work

---

## Task packet

* Linear issue: **${issue.identifier} — ${issue.title}**
* Branch to work on: \`${branchName}\`

### Why it matters
${description}

### Allowed files
${allowedSection}

### Forbidden files
${forbiddenSection}

### Acceptance criteria
* (fill in from Linear issue description or PM instruction)
* All existing tests must still pass

### Verification
* \`pnpm type-check\`
* \`pnpm test\`
* (add any issue-specific verification commands here)

### Merge dependencies
* none (confirm with PM if unsure)

### Rollback note
* Revert the PR — no migrations, no shared contract changes

---

## Rules

* no opportunistic refactors
* no unrelated cleanup
* no scope expansion
* no hidden dependency work unless explicitly included
* if blocked, stop and report the precise blocker
* Claude Code is the only merge authority — open a PR, do not merge

---

## When done

Report back with:
\`\`\`
pnpm codex:receive -- --issue ${issue.identifier} --branch <your-branch> --pr <pr-url>
\`\`\`
`;
}

// ─── Arg Parser ───────────────────────────────────────────────────────────────

function readArg(args: string[], name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && args[idx + 1] && !args[idx + 1].startsWith('--')) {
    return args[idx + 1];
  }
  return undefined;
}

function parseCsvArg(args: string[], name: string): string[] {
  const val = readArg(args, name);
  if (!val) return [];
  return val
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const env = loadEnvironment();
const apiKey = env.LINEAR_API_TOKEN?.trim();
const cliArgs = process.argv.slice(2);

const issueIdRaw = readArg(cliArgs, 'issue');
const allowedFiles = parseCsvArg(cliArgs, 'allowed');
const forbiddenFiles = parseCsvArg(cliArgs, 'forbidden');
const dryRun = cliArgs.includes('--dry-run');

if (!issueIdRaw) {
  console.error('Error: --issue <ID> is required.');
  console.error('  Example: pnpm codex:dispatch -- --issue UTV2-XXX');
  process.exit(1);
}

if (!apiKey) {
  console.error('Error: LINEAR_API_TOKEN is required to fetch issue details.');
  process.exit(1);
}

const issueId = issueIdRaw.toUpperCase();

void (async () => {
  try {
    // 1. Fetch issue from Linear
    console.log(`Fetching ${issueId} from Linear...`);
    const issue = await fetchIssue(issueId, apiKey);
    console.log(`  ${issue.identifier}: ${issue.title}`);
    console.log(`  State: ${issue.state?.name ?? 'unknown'}`);

    // 2. Load registry and check capacity
    const registry = readRegistry();

    const existingActive = registry.lanes.find(
      (l) => l.id === issueId && l.status === 'active',
    );
    if (existingActive) {
      console.error(`Error: Active lane for ${issueId} already exists.`);
      console.error(`  Owner:  ${existingActive.owner}`);
      console.error(`  Branch: ${existingActive.branch}`);
      console.error(`  Use: pnpm codex:status to review active lanes.`);
      process.exit(1);
    }

    const activeCodexCli = registry.lanes.filter(
      (l) => l.owner === 'codex-cli' && l.status === 'active',
    ).length;

    if (activeCodexCli >= 3) {
      console.error(`Error: Codex CLI lane capacity reached (${activeCodexCli}/3 active).`);
      console.error('  Run: pnpm codex:status to review active lanes.');
      console.error('  Wait for a lane to return or merge before dispatching another.');
      process.exit(1);
    }

    // 3. File overlap check
    if (allowedFiles.length > 0) {
      const overlap = checkFileOverlap(registry, allowedFiles);
      if (overlap.conflict) {
        console.error(`Error: File overlap conflict with lane ${overlap.lane}.`);
        console.error(`  Overlapping files: ${overlap.files.join(', ')}`);
        console.error('  Resolve the active lane before dispatching this issue.');
        process.exit(1);
      }
    }

    // 4. Generate packet
    const packet = generatePacket(issue, allowedFiles, forbiddenFiles);

    // 5. Write packet file
    const packetPath = path.join(CODEX_QUEUE_DIR, `${issueId}.md`);
    if (!dryRun) {
      fs.mkdirSync(CODEX_QUEUE_DIR, { recursive: true });
      fs.writeFileSync(packetPath, packet, 'utf8');
    }

    // 6. Register lane
    const idSlug = issueId.toLowerCase();
    const titleSlug = slugify(issue.title);
    const branch = issue.branchName ?? `feat/${idSlug}-${titleSlug}`;

    const lane: LaneEntry = {
      id: issueId,
      title: issue.title,
      branch,
      worktree: null,
      status: 'active',
      owner: 'codex-cli',
      createdAt: new Date().toISOString(),
      snapshotAt: null,
      pr: null,
      allowedFiles: allowedFiles.length > 0 ? allowedFiles : undefined,
    };

    if (!dryRun) {
      const existingIdx = registry.lanes.findIndex((l) => l.id === issueId);
      if (existingIdx >= 0) {
        registry.lanes[existingIdx] = lane;
      } else {
        registry.lanes.push(lane);
      }
      writeRegistry(registry);
    }

    // 7. Output
    const activeAfter = activeCodexCli + (dryRun ? 0 : 1);
    console.log('');
    console.log(`Codex task packet ready${dryRun ? ' (dry-run)' : ''}: ${issueId}`);
    console.log(`  Packet: ${dryRun ? '(not written)' : packetPath}`);
    console.log(`  Branch: ${branch}`);
    console.log(`  Codex CLI lanes: ${activeAfter}/3`);
    console.log('');
    console.log('─'.repeat(62));
    console.log('PASTE THIS INTO YOUR CODEX CLI TERMINAL:');
    console.log('─'.repeat(62));
    console.log('');
    console.log(packet);
    console.log('─'.repeat(62));
    console.log('');
    console.log(`When Codex returns, run:`);
    console.log(`  pnpm codex:receive -- --issue ${issueId} --branch <branch> --pr <url>`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
})();
