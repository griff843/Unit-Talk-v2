/**
 * scripts/codex-classify.ts
 * Auto-classify Linear issues as claude-only, codex-safe, blocked, or needs-contract.
 *
 * Reads all Ready/In Progress/In Review issues from Linear and applies the
 * classification rules from CLAUDE.md to determine which are Codex-safe.
 *
 * Classification rules (from CLAUDE.md):
 *
 * claude-only:
 *   - cross-cutting refactors
 *   - shared contracts/types
 *   - shared route or repository changes
 *   - scoring/promotion/lifecycle logic
 *   - governance/status reconciliation
 *   - any issue with ambiguity
 *   - any issue that overlaps another active task
 *   - any T1 issue
 *
 * codex-safe (ALL must be true):
 *   - issue exists in Linear
 *   - scope is explicit
 *   - acceptance criteria are explicit
 *   - allowed files are explicit
 *   - no migration
 *   - no shared contract/type overlap with active work
 *   - no overlapping routes/tests likely to collide
 *   - verification path is independent
 *
 * Usage:
 *   pnpm codex:classify [--states "Ready,In Progress"] [--limit 50] [--json]
 */

import { loadEnvironment } from '@unit-talk/config';
import { spawnSync } from 'node:child_process';
import {
  ACTIVE_LOCK_STATUSES,
  readAllManifests,
} from './ops/shared.js';

// ─── Types ────────────────────────────────────────────────────────────────────

type Classification = 'claude-only' | 'codex-safe' | 'blocked' | 'needs-contract';

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
  state?: { name: string; type?: string } | null;
}

interface ClassifiedIssue {
  issue: LinearIssue;
  classification: Classification;
  reason: string;
  dispatchReady: boolean;
}

// ─── ANSI Colors ──────────────────────────────────────────────────────────────

const isTTY = process.stdout.isTTY;
const c = {
  green: (s: string) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (isTTY ? `\x1b[33m${s}\x1b[0m` : s),
  red: (s: string) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s),
  cyan: (s: string) => (isTTY ? `\x1b[36m${s}\x1b[0m` : s),
  dim: (s: string) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s),
};

// ─── Classification Logic ─────────────────────────────────────────────────────

// Keywords that signal claude-only territory
const CLAUDE_ONLY_SIGNALS: RegExp[] = [
  /contract/i,
  /migration/i,
  /schema/i,
  /lifecycle/i,
  /promotion.*(logic|service|gate)/i,
  /scoring/i,
  /settlement/i,
  /grading/i,
  /routing/i,
  /outbox/i,
  /worker/i,
  /governance/i,
  /reconcil/i,
  /authority/i,
  /t1\b/i,
  /cross.cutting/i,
  /shared.*type/i,
  /domain/i,
  /clv/i,
  /canary/i,
  /prod.*readiness/i,
  /deploy/i,
  /circuit.breaker/i,
  /retry/i,
  /packages\/(contracts|domain|db)/i,
  /data.*layer/i,
  /ingestor/i,
];

// Labels that signal blocked state
const BLOCKED_LABEL_SIGNALS: RegExp[] = [
  /blocked/i,
  /waiting/i,
  /depends/i,
];

// Labels/title signals for needs-contract
const NEEDS_CONTRACT_SIGNALS: RegExp[] = [
  /design/i,
  /spec/i,
  /plan/i,
  /tbd/i,
  /unknown/i,
  /research/i,
];

function classifyIssue(
  issue: LinearIssue,
  activeIssueIds: Set<string>,
): { classification: Classification; reason: string } {
  const titleAndDesc = `${issue.title} ${issue.description ?? ''}`.toLowerCase();
  const labels = (issue.labels?.nodes ?? []).map((l) => l.name.toLowerCase());
  const stateType = issue.state?.type?.toLowerCase() ?? '';

  // Already active in another lane
  if (activeIssueIds.has(issue.identifier)) {
    return { classification: 'claude-only', reason: 'already active in a lane' };
  }

  // Blocked state
  if (stateType === 'cancelled' || stateType === 'completed') {
    return { classification: 'blocked', reason: `state=${issue.state?.name}` };
  }

  if (labels.some((l) => BLOCKED_LABEL_SIGNALS.some((re) => re.test(l)))) {
    return { classification: 'blocked', reason: 'blocked label detected' };
  }

  // Needs contract
  if (labels.some((l) => NEEDS_CONTRACT_SIGNALS.some((re) => re.test(l)))) {
    return { classification: 'needs-contract', reason: 'spec/design label — needs AC before execution' };
  }

  // No description = ambiguous
  if (!issue.description || issue.description.trim().length < 50) {
    return {
      classification: 'needs-contract',
      reason: 'description too short or missing — AC unclear',
    };
  }

  // Claude-only signal detection
  for (const signal of CLAUDE_ONLY_SIGNALS) {
    if (signal.test(titleAndDesc)) {
      return {
        classification: 'claude-only',
        reason: `matches claude-only signal: ${signal.source}`,
      };
    }
  }

  // Default: codex-safe (scope still needs human confirmation)
  return {
    classification: 'codex-safe',
    reason: 'no claude-only signals detected — verify scope before dispatch',
  };
}

// ─── Linear API ───────────────────────────────────────────────────────────────

async function fetchIssues(
  states: string[],
  limit: number,
  apiKey: string,
): Promise<LinearIssue[]> {
  // Resolve team ID first
  const teamsResp = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `query { teams(first: 10) { nodes { id key name } } }`,
    }),
  });

  if (!teamsResp.ok) throw new Error(`Linear API: ${teamsResp.status}`);
  const teamsData = (await teamsResp.json()) as {
    data?: { teams: { nodes: Array<{ id: string; key: string }> } };
  };
  const teamId = teamsData.data?.teams.nodes[0]?.id;
  if (!teamId) throw new Error('Could not resolve Linear team ID');

  const query = `
    query ListIssues($teamId: String!, $states: [String!], $first: Int!) {
      team(id: $teamId) {
        issues(
          first: $first
          filter: { state: { name: { in: $states } } }
          orderBy: updatedAt
        ) {
          nodes {
            id
            identifier
            title
            url
            branchName
            description
            priority
            project { name }
            labels(first: 8) { nodes { name } }
            state { name type }
          }
        }
      }
    }
  `;

  const resp = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { teamId, states, first: limit } }),
  });

  if (!resp.ok) throw new Error(`Linear API: ${resp.status}`);
  const data = (await resp.json()) as {
    data?: { team?: { issues: { nodes: LinearIssue[] } } | null };
    errors?: Array<{ message?: string }>;
  };

  if (data.errors?.length) {
    throw new Error(data.errors.map((e) => e.message ?? 'Unknown').join('; '));
  }

  return data.data?.team?.issues.nodes ?? [];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const env = loadEnvironment();
const apiKey = env.LINEAR_API_TOKEN?.trim();
const cliArgs = process.argv.slice(2);

function readArg(name: string): string | undefined {
  const idx = cliArgs.indexOf(`--${name}`);
  if (idx >= 0 && cliArgs[idx + 1] && !cliArgs[idx + 1].startsWith('--')) {
    return cliArgs[idx + 1];
  }
  return undefined;
}

const statesArg = readArg('states') ?? 'Ready,In Progress,In Review';
const limitArg = parseInt(readArg('limit') ?? '50', 10);
const jsonOutput = cliArgs.includes('--json');

if (!apiKey) {
  console.error('Error: LINEAR_API_TOKEN is required.');
  process.exit(1);
}

const states = statesArg.split(',').map((s) => s.trim());

void (async () => {
  try {
    console.log(c.dim(`Fetching issues (states: ${states.join(', ')}, limit: ${limitArg})...`));
    const issues = await fetchIssues(states, limitArg, apiKey);

    if (issues.length === 0) {
      console.log('(no issues found)');
      process.exit(0);
    }

    // Load active lane IDs from canonical manifests
    let manifests: Array<{ issue_id: string; status: string; lane_type: string }> = [];
    try {
      manifests = readAllManifests();
    } catch {
      // Empty manifest dir is normal on a fresh clone
    }
    const activeIssueIds = new Set(
      manifests
        .filter((m) => ACTIVE_LOCK_STATUSES.has(m.status as never))
        .map((m) => m.issue_id),
    );

    // Classify
    const classified: ClassifiedIssue[] = issues.map((issue) => {
      const { classification, reason } = classifyIssue(issue, activeIssueIds);
      return {
        issue,
        classification,
        reason,
        dispatchReady: classification === 'codex-safe',
      };
    });

    if (jsonOutput) {
      console.log(JSON.stringify(classified, null, 2));
      process.exit(0);
    }

    // Group by classification
    const groups: Record<Classification, ClassifiedIssue[]> = {
      'codex-safe': classified.filter((c) => c.classification === 'codex-safe'),
      'claude-only': classified.filter((c) => c.classification === 'claude-only'),
      'blocked': classified.filter((c) => c.classification === 'blocked'),
      'needs-contract': classified.filter((c) => c.classification === 'needs-contract'),
    };

    const line = '─'.repeat(80);
    console.log('');
    console.log(c.bold('ISSUE CLASSIFICATION'));
    console.log(line);
    console.log(
      `  Total: ${issues.length}    ` +
      `${c.green(`Codex-safe: ${groups['codex-safe'].length}`)}    ` +
      `${c.cyan(`Claude-only: ${groups['claude-only'].length}`)}    ` +
      `${c.yellow(`Needs-contract: ${groups['needs-contract'].length}`)}    ` +
      `${c.dim(`Blocked: ${groups['blocked'].length}`)}`,
    );
    console.log('');

    // Print codex-safe first (action items)
    if (groups['codex-safe'].length > 0) {
      console.log(c.green('CODEX-SAFE (dispatch candidates)'));
      console.log(c.dim('  These are cleared for Codex CLI dispatch after you verify scope.'));
      console.log('');
      for (const item of groups['codex-safe']) {
        const priority = item.issue.priority != null ? ` P${item.issue.priority}` : '';
        const project = item.issue.project?.name ? ` [${item.issue.project.name}]` : '';
        console.log(
          `  ${c.green(item.issue.identifier.padEnd(12))} ${item.issue.title.slice(0, 52).padEnd(54)}${priority}${project}`,
        );
        console.log(c.dim(`    ↳ ${item.reason}`));
        console.log(c.dim(`    ↳ dispatch: pnpm codex:dispatch -- --issue ${item.issue.identifier}`));
        console.log('');
      }
    }

    // Claude-only
    if (groups['claude-only'].length > 0) {
      console.log(c.cyan('CLAUDE-ONLY'));
      console.log('');
      for (const item of groups['claude-only']) {
        const priority = item.issue.priority != null ? ` P${item.issue.priority}` : '';
        console.log(
          `  ${c.cyan(item.issue.identifier.padEnd(12))} ${item.issue.title.slice(0, 52).padEnd(54)}${priority}`,
        );
        console.log(c.dim(`    ↳ ${item.reason}`));
      }
      console.log('');
    }

    // Needs contract
    if (groups['needs-contract'].length > 0) {
      console.log(c.yellow('NEEDS CONTRACT (cannot execute yet)'));
      console.log('');
      for (const item of groups['needs-contract']) {
        console.log(
          `  ${c.yellow(item.issue.identifier.padEnd(12))} ${item.issue.title.slice(0, 52)}`,
        );
        console.log(c.dim(`    ↳ ${item.reason}`));
      }
      console.log('');
    }

    // Blocked
    if (groups['blocked'].length > 0) {
      console.log(c.dim('BLOCKED'));
      console.log('');
      for (const item of groups['blocked']) {
        console.log(c.dim(`  ${item.issue.identifier.padEnd(12)} ${item.issue.title.slice(0, 52)}`));
        console.log(c.dim(`    ↳ ${item.reason}`));
      }
      console.log('');
    }

    console.log(line);
    console.log('');

    // Active Codex lanes summary from canonical manifests
    const codexActive = manifests.filter(
      (m) => m.lane_type === 'codex-cli' && ACTIVE_LOCK_STATUSES.has(m.status as never),
    );
    if (codexActive.length > 0) {
      console.log(c.dim(`Active Codex CLI lanes: ${codexActive.length}`));
      for (const m of codexActive) {
        console.log(c.dim(`  ${m.issue_id} — ${m.status}`));
      }
      console.log('');
    }

    if (groups['codex-safe'].length === 0) {
      console.log(c.dim('No Codex-safe issues found. All ready work requires Claude Code.'));
    } else {
      console.log(
        c.green(
          `${groups['codex-safe'].length} issue(s) ready for Codex CLI dispatch.`,
        ),
      );
      console.log(c.dim(`  pnpm codex:dispatch -- --issue <ID>`));
    }
    console.log('');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
})();
