import { runPhaseClose } from './commands/phase-close.js';
import { runPhasePr } from './commands/phase-pr.js';
import { runPhaseSqlReview } from './commands/phase-sql-review.js';
import { runPhaseStart } from './commands/phase-start.js';
import { runPhaseVerify } from './commands/phase-verify.js';
import { parseArgs } from './lib/args.js';
import { BlockError, EXIT_BLOCK, EXIT_ERROR, stderrBlock } from './lib/result.js';
import { NodeShellAdapter } from './lib/shell.js';

function printUsage(): void {
  console.log(`Usage:
  pnpm ut:phase:start <ID> [--dry-run] [--resume] [--json]
  pnpm ut:phase:verify <ID> [--dry-run] [--json] [--skip-gate <name> --reason <text>] [--ack-untracked <reason>]
  pnpm ut:phase:sql-review <ID> [--dry-run] [--reviewer <handle>] [--sql-reviewed-against <ref>] [--confirm]
  pnpm ut:phase:pr <ID> [--dry-run] [--title <text>] [--body-from <path>] [--draft]
  pnpm ut:phase:close <ID> [--dry-run]
  pnpm ut:phase:close <ID> --record-live-apply --applied-by <handle> [--proof-query-result <text>] [--dry-run]`);
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === '--help') {
    printUsage();
    return 0;
  }

  const context = {
    cwd: process.cwd(),
    shell: new NodeShellAdapter(),
  };

  switch (command) {
    case 'phase:start': {
      const parsed = parseArgs(rest, ['dry-run', 'resume', 'json', 'help']);
      const issueId = parsed.positionals[0];
      if (!issueId || parsed.bools.has('help')) {
        printUsage();
        return issueId ? 0 : EXIT_BLOCK;
      }
      return runPhaseStart(context, issueId, {
        dryRun: parsed.bools.has('dry-run'),
        resume: parsed.bools.has('resume'),
        json: parsed.bools.has('json'),
      });
    }
    case 'phase:verify': {
      const parsed = parseArgs(rest, [
        'dry-run',
        'json',
        'skip-gate',
        'reason',
        'ack-untracked',
        'help',
      ]);
      const issueId = parsed.positionals[0];
      if (!issueId || parsed.bools.has('help')) {
        printUsage();
        return issueId ? 0 : EXIT_BLOCK;
      }
      return runPhaseVerify(context, issueId, {
        dryRun: parsed.bools.has('dry-run'),
        json: parsed.bools.has('json'),
        skipGate: parsed.flags['skip-gate'] ?? null,
        skipReason: parsed.flags.reason ?? null,
        ackUntracked: parsed.flags['ack-untracked'] ?? null,
      });
    }
    case 'phase:sql-review': {
      const parsed = parseArgs(rest, [
        'dry-run',
        'json',
        'reviewer',
        'sql-reviewed-against',
        'confirm',
        'help',
      ]);
      const issueId = parsed.positionals[0];
      if (!issueId || parsed.bools.has('help')) {
        printUsage();
        return issueId ? 0 : EXIT_BLOCK;
      }
      return runPhaseSqlReview(context, issueId, {
        dryRun: parsed.bools.has('dry-run'),
        reviewer: parsed.flags.reviewer ?? null,
        reviewedAgainst: parsed.flags['sql-reviewed-against'] ?? null,
        confirm: parsed.bools.has('confirm'),
        json: parsed.bools.has('json'),
      });
    }
    case 'phase:pr': {
      const parsed = parseArgs(rest, ['dry-run', 'json', 'title', 'body-from', 'draft', 'help']);
      const issueId = parsed.positionals[0];
      if (!issueId || parsed.bools.has('help')) {
        printUsage();
        return issueId ? 0 : EXIT_BLOCK;
      }
      return runPhasePr(context, issueId, {
        dryRun: parsed.bools.has('dry-run'),
        title: parsed.flags.title ?? null,
        bodyFrom: parsed.flags['body-from'] ?? null,
        draft: parsed.bools.has('draft'),
        json: parsed.bools.has('json'),
      });
    }
    case 'phase:close': {
      const parsed = parseArgs(rest, [
        'dry-run',
        'json',
        'record-live-apply',
        'applied-by',
        'proof-query-result',
        'help',
      ]);
      const issueId = parsed.positionals[0];
      if (!issueId || parsed.bools.has('help')) {
        printUsage();
        return issueId ? 0 : EXIT_BLOCK;
      }
      return runPhaseClose(context, issueId, {
        dryRun: parsed.bools.has('dry-run'),
        recordLiveApply: parsed.bools.has('record-live-apply'),
        appliedBy: parsed.flags['applied-by'] ?? null,
        proofQueryResult: parsed.flags['proof-query-result'] ?? null,
        json: parsed.bools.has('json'),
      });
    }
    default:
      printUsage();
      return EXIT_BLOCK;
  }
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error) => {
    if (error instanceof BlockError) {
      stderrBlock(error.message);
      process.exit(EXIT_BLOCK);
    }
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(EXIT_ERROR);
  });
