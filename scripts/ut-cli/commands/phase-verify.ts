import { collectDiffSummary, isMigrationPath, repoJoin } from '../lib/diff.js';
import { getCurrentBranch } from '../lib/git.js';
import { sha256File } from '../lib/hash.js';
import { loadMetadata } from '../lib/metadata.js';
import { BlockError, EXIT_BLOCK, EXIT_ERROR, EXIT_PASS, stderrBlock } from '../lib/result.js';
import { currentShellCommand } from '../lib/shell.js';
import { evaluateScope } from '../lib/scope.js';
import { readStartedState, writeJsonState } from '../lib/state.js';
import type { CommandContext, GateResult, VerifyState } from '../types.js';

function timestampLabel(date: Date): string {
  const parts = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
    'T',
    String(date.getUTCHours()).padStart(2, '0'),
    String(date.getUTCMinutes()).padStart(2, '0'),
    String(date.getUTCSeconds()).padStart(2, '0'),
  ];
  return parts.join('');
}

function stderrTail(stderr: string): string[] {
  return stderr.split(/\r?\n/).filter(Boolean).slice(-40);
}

function verifierIdentity(context: CommandContext): string | null {
  const gitEmail = context.shell.run('git', ['config', 'user.email'], {
    cwd: context.cwd,
    allowNonZero: true,
  });
  const email = gitEmail.stdout.trim();
  if (email.length > 0) {
    return email;
  }
  return process.env.USERNAME ?? process.env.USER ?? null;
}

export async function runPhaseVerify(
  context: CommandContext,
  issueId: string,
  options: {
    dryRun: boolean;
    json: boolean;
    skipGate: string | null;
    skipReason: string | null;
    ackUntracked: string | null;
  },
): Promise<number> {
  try {
    const started = readStartedState(context.cwd, issueId);
    if (!started) {
      throw new BlockError(`phase:start has not run for ${issueId}`);
    }
    const currentBranch = getCurrentBranch(context.shell, context.cwd);
    if (currentBranch !== started.branch) {
      throw new BlockError(
        `current branch ${currentBranch} does not match started branch ${started.branch}`,
      );
    }

    const { metadata } = loadMetadata(context.cwd, issueId);
    const diff = collectDiffSummary(context.shell, context.cwd, started.startingSha);
    const scope = evaluateScope(
      diff.all,
      diff.untracked,
      metadata.allowed_files,
      metadata.forbidden_files,
      metadata.expected_collateral,
      options.ackUntracked,
    );

    const gateResults: GateResult[] = [];
    const skippedGates: Array<{ name: string; reason: string }> = [];

    if (scope.forbidden.length > 0) {
      throw new BlockError(
        `scope enforcement failure; forbidden files touched: ${scope.forbidden.join(', ')}`,
      );
    }
    if (scope.outOfScope.length > 0) {
      throw new BlockError(
        `scope enforcement failure; out-of-scope files touched: ${scope.outOfScope.join(', ')}`,
      );
    }
    gateResults.push({
      name: 'scope-check',
      type: 'scope',
      pass: true,
      exitCode: 0,
      message: 'scope check passed',
    });

    const migrationPaths = diff.all.filter((file) => isMigrationPath(file));
    if (migrationPaths.length > 0 && !metadata.requires_migration) {
      throw new BlockError('undeclared migration detected in diff');
    }
    if (migrationPaths.length === 0 && metadata.requires_migration) {
      throw new BlockError('required migration missing from diff');
    }
    gateResults.push({
      name: 'migration-detection',
      type: 'migration',
      pass: true,
      exitCode: 0,
      message: migrationPaths.length > 0 ? 'migration detected as declared' : 'no migration detected',
    });

    for (const command of metadata.verification_commands) {
      if (options.skipGate === command.name) {
        if (!options.skipReason) {
          throw new BlockError(`--skip-gate ${command.name} requires --reason`);
        }
        skippedGates.push({ name: command.name, reason: options.skipReason });
        gateResults.push({
          name: command.name,
          type: 'command',
          pass: true,
          exitCode: null,
          message: `skipped: ${options.skipReason}`,
        });
        continue;
      }

      const shellCommand = currentShellCommand();
      const result = context.shell.run(shellCommand.command, [...shellCommand.args, command.cmd], {
        cwd: context.cwd,
      });
      const passed = result.status === 0;
      gateResults.push({
        name: command.name,
        type: 'command',
        pass: passed,
        exitCode: result.status ?? 1,
        stderrTail: passed ? undefined : stderrTail(result.stderr || result.stdout),
        message: passed ? 'command passed' : 'command failed',
      });
      if (!passed) {
        throw new BlockError(`verification command ${command.name} failed`);
      }
    }

    if (scope.collateral.length > 0) {
      gateResults.push({
        name: 'post-verify-sanity',
        type: 'sanity',
        pass: true,
        exitCode: 0,
        message: `expected collateral present: ${scope.collateral.join(', ')}`,
      });
    }

    const verifyState: VerifyState = {
      timestamp: new Date().toISOString(),
      verifier: verifierIdentity(context),
      verdict: 'pass',
      branch: started.branch,
      startingSha: started.startingSha,
      diffSummary: {
        files: diff.all,
        stats: diff.stats,
        acknowledgedUntracked: scope.acknowledgedUntracked,
        warnings: scope.collateral,
      },
      migrations: {
        detected: migrationPaths.length > 0,
        paths: migrationPaths.map((relativePath) => ({
          path: relativePath,
          sha256: sha256File(repoJoin(context.cwd, relativePath)),
        })),
      },
      gateResults,
      skippedGates,
    };

    writeJsonState(
      context.cwd,
      issueId,
      `verify-${timestampLabel(new Date())}.json`,
      verifyState,
      options.dryRun,
    );
    console.log(`phase:verify OK - ${issueId}`);
    console.log(`verdict: ${verifyState.verdict}`);
    console.log(`files: ${verifyState.diffSummary.files.length}`);
    console.log(`migrations: ${verifyState.migrations.paths.length}`);
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            command: 'phase:verify',
            issueId,
            status: 'pass',
            verifyState,
          },
          null,
          2,
        ),
      );
    }
    return EXIT_PASS;
  } catch (error) {
    if (error instanceof BlockError) {
      stderrBlock(error.message);
      return EXIT_BLOCK;
    }
    if (error instanceof Error) {
      console.error(error.stack ?? error.message);
      return EXIT_ERROR;
    }
    console.error(String(error));
    return EXIT_ERROR;
  }
}
