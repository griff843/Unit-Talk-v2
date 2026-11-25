/**
 * scripts/codex-classify.ts
 * Auto-classify open repo work orders (`.ops/work/WORK-*.md` with no lane
 * manifest yet) as claude-only, codex-safe, or needs-contract.
 *
 * Classification rules (from CLAUDE.md):
 *
 * claude-only:
 *   - cross-cutting refactors
 *   - shared contracts/types
 *   - shared route or repository changes
 *   - scoring/promotion/lifecycle logic
 *   - governance/status reconciliation
 *   - any work order with ambiguity
 *   - any work order that overlaps another active task
 *   - any T1 work order
 *
 * codex-safe (ALL must be true):
 *   - work order exists in the repo
 *   - scope is explicit
 *   - acceptance criteria are explicit
 *   - allowed files are explicit
 *   - no migration
 *   - no shared contract/type overlap with active work
 *   - no overlapping routes/tests likely to collide
 *   - verification path is independent
 *
 * Usage:
 *   pnpm codex:classify [--limit 50] [--json]
 */

import {
  ACTIVE_LOCK_STATUSES,
  readAllManifests,
} from './ops/shared.js';
import { openWorkOrders, type WorkOrder } from './ops/work-orders.js';

// ─── Types ────────────────────────────────────────────────────────────────────

type Classification = 'claude-only' | 'codex-safe' | 'blocked' | 'needs-contract';

interface ClassifiedIssue {
  issue: WorkOrder;
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

function classifyIssue(
  issue: WorkOrder,
  activeIssueIds: Set<string>,
): { classification: Classification; reason: string } {
  const titleAndDesc = `${issue.title} ${issue.body}`.toLowerCase();

  // Already active in another lane
  if (activeIssueIds.has(issue.identifier)) {
    return { classification: 'claude-only', reason: 'already active in a lane' };
  }

  // A work order with no acceptance criteria cannot be executed yet.
  if (!issue.has_acceptance_criteria) {
    return { classification: 'needs-contract', reason: 'no ## Acceptance Criteria section' };
  }

  if (issue.tier === 'T1') {
    return { classification: 'claude-only', reason: 'T1 work order' };
  }

  if (issue.executor === 'claude') {
    return { classification: 'claude-only', reason: 'work order names Executor: claude' };
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

// ─── Main ─────────────────────────────────────────────────────────────────────

const cliArgs = process.argv.slice(2);

function readArg(name: string): string | undefined {
  const idx = cliArgs.indexOf(`--${name}`);
  if (idx >= 0 && cliArgs[idx + 1] && !cliArgs[idx + 1].startsWith('--')) {
    return cliArgs[idx + 1];
  }
  return undefined;
}

const limitArg = parseInt(readArg('limit') ?? '50', 10);
const jsonOutput = cliArgs.includes('--json');

void (async () => {
  try {
    // Load lane manifests: they decide which work orders are still open.
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

    console.log(c.dim(`Reading open work orders (limit: ${limitArg})...`));
    const issues = openWorkOrders(new Set(manifests.map((m) => m.issue_id))).slice(0, limitArg);

    if (issues.length === 0) {
      console.log('(no open work orders found)');
      process.exit(0);
    }

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
    console.log(c.bold('WORK ORDER CLASSIFICATION'));
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
        const tier = item.issue.tier ? ` ${item.issue.tier}` : '';
        console.log(
          `  ${c.green(item.issue.identifier.padEnd(18))} ${item.issue.title.slice(0, 52).padEnd(54)}${tier}`,
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
        const tier = item.issue.tier ? ` ${item.issue.tier}` : '';
        console.log(
          `  ${c.cyan(item.issue.identifier.padEnd(18))} ${item.issue.title.slice(0, 52).padEnd(54)}${tier}`,
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
      console.log(c.dim('No Codex-safe work orders found. All open work requires Claude Code.'));
    } else {
      console.log(
        c.green(
          `${groups['codex-safe'].length} work order(s) ready for Codex CLI dispatch.`,
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
