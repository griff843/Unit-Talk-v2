import fs from 'node:fs';

import { buildPrBody } from '../lib/body.js';
import { loadConfig } from '../lib/config.js';
import { collectDiffSummary } from '../lib/diff.js';
import {
  createPullRequest,
  ensureBranchPushedAndSynced,
  existingPrForBranch,
  getCommitSubjectsSince,
  getCurrentBranch,
} from '../lib/git.js';
import { loadMetadata } from '../lib/metadata.js';
import { BlockError, EXIT_BLOCK, EXIT_ERROR, EXIT_PASS, stderrBlock } from '../lib/result.js';
import { readLatestVerifyState, readSqlReviewState, readStartedState, writeJsonState } from '../lib/state.js';
import type { CommandContext } from '../types.js';

function ensureCleanForPr(diffFiles: string[]): void {
  if (diffFiles.length > 0) {
    throw new BlockError('working tree must be clean before opening a PR');
  }
}

export async function runPhasePr(
  context: CommandContext,
  issueId: string,
  options: {
    dryRun: boolean;
    title: string | null;
    bodyFrom: string | null;
    draft: boolean;
    json: boolean;
  },
): Promise<number> {
  try {
    const config = loadConfig(context.cwd);
    const started = readStartedState(context.cwd, issueId);
    if (!started) {
      throw new BlockError(`phase:start has not run for ${issueId}`);
    }
    const verify = readLatestVerifyState(context.cwd, issueId);
    if (!verify || verify.verdict !== 'pass') {
      throw new BlockError(`latest verify state is not passing for ${issueId}`);
    }

    const { metadata } = loadMetadata(context.cwd, issueId);
    const currentBranch = getCurrentBranch(context.shell, context.cwd);
    if (currentBranch !== started.branch) {
      throw new BlockError(
        `current branch ${currentBranch} does not match started branch ${started.branch}`,
      );
    }

    const dirty = collectDiffSummary(context.shell, context.cwd, started.startingSha);
    ensureCleanForPr([...dirty.staged, ...dirty.unstaged, ...dirty.untracked]);

    const commits = getCommitSubjectsSince(context.shell, context.cwd, started.startingSha);
    if (commits.length === 0) {
      throw new BlockError(`no commits exist on ${started.branch} beyond ${started.startingSha}`);
    }

    const commitRegex = new RegExp(config.commitMessageRegex, 'i');
    for (const commit of commits) {
      if (!commitRegex.test(commit.subject)) {
        throw new BlockError(
          `commit ${commit.sha.slice(0, 7)} subject does not match configured format`,
        );
      }
      if (!commit.subject.toUpperCase().includes(issueId.toUpperCase())) {
        throw new BlockError(
          `commit ${commit.sha.slice(0, 7)} does not reference ${issueId} in its subject`,
        );
      }
      if (config.coAuthorRequired && !commit.body.includes(config.coAuthorRequired)) {
        throw new BlockError(
          `commit ${commit.sha.slice(0, 7)} is missing required co-author trailer`,
        );
      }
    }

    const sqlReview = readSqlReviewState(context.cwd, issueId);
    if (metadata.requires_migration || metadata.requires_sql_review) {
      if (!sqlReview) {
        throw new BlockError('sql-review.json is required before opening the PR');
      }
      const verifyHashes = verify.migrations.paths.map((entry) => entry.sha256).join(',');
      const reviewHashes = sqlReview.migrations.map((entry) => entry.sha256).join(',');
      if (verifyHashes !== reviewHashes) {
        throw new BlockError('sql-review marker does not match the latest migration hash');
      }
    }

    if (metadata.tier === 'T1' && (!metadata.rollback_plan || metadata.rollback_plan.trim().length === 0)) {
      throw new BlockError('T1 issues require a non-empty rollback_plan');
    }

    ensureBranchPushedAndSynced(context.shell, context.cwd, started.branch, config.remote);
    if (existingPrForBranch(context.shell, context.cwd, started.branch)) {
      throw new BlockError(`an open PR already exists for branch ${started.branch}`);
    }

    if (metadata.pm_review_required) {
      console.log(`PM REVIEW REQUIRED for ${issueId}`);
    }

    const body = options.bodyFrom
      ? fs.readFileSync(options.bodyFrom, 'utf8')
      : buildPrBody(context.cwd, metadata, verify, sqlReview, config);
    const title = options.title ?? metadata.title;
    const createArgs = [
      'pr',
      'create',
      '--base',
      config.baseBranch,
      '--title',
      title,
      '--body',
      body,
    ];
    if (options.draft) {
      createArgs.push('--draft');
    }

    if (options.dryRun) {
      console.log(`phase:pr OK (dry-run) - ${issueId}`);
      console.log(`title: ${title}`);
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              command: 'phase:pr',
              issueId,
              status: 'pass',
              dryRun: true,
              title,
            },
            null,
            2,
          ),
        );
      }
      return EXIT_PASS;
    }

    const pr = createPullRequest(context.shell, context.cwd, createArgs);
    writeJsonState(
      context.cwd,
      issueId,
      'pr.json',
      {
        timestamp: new Date().toISOString(),
        number: pr.number,
        url: pr.url,
        branch: started.branch,
      },
      false,
    );
    console.log(`phase:pr OK - ${issueId}`);
    console.log(pr.url);
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            command: 'phase:pr',
            issueId,
            status: 'pass',
            pr,
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
