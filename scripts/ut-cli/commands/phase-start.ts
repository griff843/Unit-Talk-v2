import { loadConfig } from '../lib/config.js';
import {
  createAndCheckoutBranch,
  ensureLocalMainUpToDate,
  fetchRemote,
  findCollidingPullRequests,
  getCurrentBranch,
  getHeadSha,
} from '../lib/git.js';
import { loadMetadata } from '../lib/metadata.js';
import {
  BlockError,
  EXIT_BLOCK,
  EXIT_ERROR,
  EXIT_PASS,
  stderrBlock,
  stderrFix,
} from '../lib/result.js';
import { readClosedState, readStartedState, writeJsonState } from '../lib/state.js';
import type { CommandContext } from '../types.js';

export async function runPhaseStart(
  context: CommandContext,
  issueId: string,
  options: { dryRun: boolean; resume: boolean; json: boolean },
): Promise<number> {
  try {
    const config = loadConfig(context.cwd);
    const { metadata, hash } = loadMetadata(context.cwd, issueId);

    for (const dependency of metadata.upstream_dependencies) {
      if (!readClosedState(context.cwd, dependency)) {
        throw new BlockError(`upstream dependency ${dependency} is not closed`);
      }
    }

    const existingStarted = readStartedState(context.cwd, issueId);
    if (existingStarted && !options.resume) {
      throw new BlockError(`started.json already exists for ${issueId}; re-run with --resume`);
    }
    if (existingStarted && options.resume) {
      console.log(`phase:start OK - ${issueId}`);
      console.log(`resumed existing state on branch: ${existingStarted.branch}`);
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              command: 'phase:start',
              issueId,
              status: 'pass',
              resumed: true,
              branch: existingStarted.branch,
            },
            null,
            2,
          ),
        );
      }
      return EXIT_PASS;
    }

    const currentBranch = getCurrentBranch(context.shell, context.cwd);
    if (currentBranch !== config.baseBranch) {
      throw new BlockError(`current branch must be ${config.baseBranch}`);
    }

    const status = context.shell.run('git', ['status', '--porcelain'], { cwd: context.cwd });
    if ((status.stdout.trim() || status.stderr.trim()).length > 0) {
      throw new BlockError('working tree must be clean');
    }

    fetchRemote(context.shell, context.cwd, config.remote);
    ensureLocalMainUpToDate(context.shell, context.cwd, config.remote, config.baseBranch);

    const collisions = findCollidingPullRequests(
      context.shell,
      context.cwd,
      metadata.allowed_files,
      config.lifecycleSpineFiles,
    );
    if (collisions.length > 0) {
      const summary = collisions
        .map((collision) => `#${collision.number} (${collision.files.join(', ')})`)
        .join('; ');
      throw new BlockError(`open PR collision detected: ${summary}`);
    }

    const branchPrefix = metadata.branch_prefix ?? config.defaultBranchPrefix;
    const slug = metadata.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    const branchName = `${branchPrefix}${issueId.toLowerCase()}-${slug}`;

    if (!options.resume && !options.dryRun) {
      createAndCheckoutBranch(context.shell, context.cwd, branchName, config.baseBranch);
    }

    const startingSha = getHeadSha(context.shell, context.cwd);
    const started = {
      timestamp: new Date().toISOString(),
      branch: branchName,
      startingSha,
      metadataHash: hash,
    };
    writeJsonState(context.cwd, issueId, 'started.json', started, options.dryRun);

    console.log(`phase:start OK - ${issueId}`);
    console.log(`branch: ${branchName}`);
    console.log(`tier: ${metadata.tier}`);
    console.log(`allowed files: ${metadata.allowed_files.length}`);
    console.log(`requires migration: ${metadata.requires_migration ? 'yes' : 'no'}`);
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            command: 'phase:start',
            issueId,
            status: 'pass',
            branch: branchName,
            tier: metadata.tier,
            requiresMigration: metadata.requires_migration,
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
    stderrFix(String(error));
    return EXIT_BLOCK;
  }
}
