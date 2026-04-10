import fs from 'node:fs';
import path from 'node:path';

import { loadConfig } from '../lib/config.js';
import { getMergedPullRequest } from '../lib/git.js';
import { loadMetadata } from '../lib/metadata.js';
import { BlockError, EXIT_BLOCK, EXIT_ERROR, EXIT_PASS, stderrBlock } from '../lib/result.js';
import {
  readClosedState,
  readLatestVerifyState,
  readLiveApplyState,
  readPrState,
  readSqlReviewState,
  readStartedState,
  writeJsonState,
} from '../lib/state.js';
import type { CommandContext } from '../types.js';

function printChecklist(issueId: string, downstreamUnlocks: string[]): void {
  console.log(`PHASE CLOSE OK - ${issueId}`);
  console.log('CLI has marked this issue as locally closed. The following manual steps remain:');
  console.log(`  [ ] Move Linear issue ${issueId} to Done`);
  for (const downstream of downstreamUnlocks) {
    console.log(`  [ ] Transition Linear issue ${downstream} to Ready`);
  }
  console.log('  [ ] Verify PROGRAM_STATUS.md entry is accurate and dated');
  console.log('  [ ] If this was a phase proof bundle issue, confirm the next phase gate opens');
}

export async function runPhaseClose(
  context: CommandContext,
  issueId: string,
  options: {
    dryRun: boolean;
    recordLiveApply: boolean;
    appliedBy: string | null;
    proofQueryResult: string | null;
    json: boolean;
  },
): Promise<number> {
  try {
    const config = loadConfig(context.cwd);
    const started = readStartedState(context.cwd, issueId);
    const verify = readLatestVerifyState(context.cwd, issueId);
    const pr = readPrState(context.cwd, issueId);
    const { metadata } = loadMetadata(context.cwd, issueId);
    if (!started || !verify || verify.verdict !== 'pass' || !pr) {
      throw new BlockError('start, passing verify, and pr state are all required before close');
    }

    if (options.recordLiveApply) {
      if (!metadata.requires_migration) {
        throw new BlockError('live-apply marker is only valid for migration issues');
      }
      if (!options.appliedBy) {
        throw new BlockError('--record-live-apply requires --applied-by');
      }
      if (verify.migrations.paths.length === 0) {
        throw new BlockError('latest verify state does not include migration hashes');
      }
      const sqlReview = readSqlReviewState(context.cwd, issueId);
      if (!sqlReview) {
        throw new BlockError('sql-review marker is required before recording live apply');
      }
      const verifyHashes = verify.migrations.paths.map((entry) => entry.sha256).join(',');
      const reviewHashes = sqlReview.migrations.map((entry) => entry.sha256).join(',');
      if (verifyHashes !== reviewHashes) {
        throw new BlockError('live-apply SHA mismatch - re-run phase:verify and phase:sql-review');
      }

      writeJsonState(
        context.cwd,
        issueId,
        'live-apply.json',
        {
          timestamp: new Date().toISOString(),
          appliedBy: options.appliedBy,
          migrationPaths: verify.migrations.paths.map((entry) => entry.path),
          liveMigrationHash: verifyHashes,
          proofQueryResult: options.proofQueryResult,
        },
        options.dryRun,
      );
      console.log(`phase:close live-apply marker OK - ${issueId}`);
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              command: 'phase:close',
              issueId,
              status: 'pass',
              mode: 'record-live-apply',
            },
            null,
            2,
          ),
        );
      }
      return EXIT_PASS;
    }

    const existingClosed = readClosedState(context.cwd, issueId);
    if (existingClosed) {
      printChecklist(issueId, existingClosed.downstreamUnlocks);
      return EXIT_PASS;
    }

    const merged = getMergedPullRequest(context.shell, context.cwd, pr.number);
    if (merged.state !== 'MERGED' || !merged.mergeCommitSha) {
      throw new BlockError(`PR not merged. Merge PR #${pr.number} first, then retry.`);
    }

    let hashChain: { verify: string[]; sqlReview: string[]; liveApply: string[] } | null = null;
    if (metadata.requires_migration) {
      const liveApply = readLiveApplyState(context.cwd, issueId);
      const sqlReview = readSqlReviewState(context.cwd, issueId);
      if (!liveApply) {
        throw new BlockError(
          `live-apply marker missing. Run: pnpm ut:phase:close ${issueId} --record-live-apply --applied-by <handle>`,
        );
      }
      if (!sqlReview) {
        throw new BlockError('sql-review marker missing');
      }
      const verifyHashes = verify.migrations.paths.map((entry) => entry.sha256);
      const reviewHashes = sqlReview.migrations.map((entry) => entry.sha256);
      const liveHashes = [liveApply.liveMigrationHash];
      if (
        verifyHashes.join(',') !== reviewHashes.join(',') ||
        reviewHashes.join(',') !== liveHashes.join(',')
      ) {
        throw new BlockError(
          'live-apply SHA mismatch - migration file was modified after sql-review',
        );
      }
      hashChain = { verify: verifyHashes, sqlReview: reviewHashes, liveApply: liveHashes };
    }

    if (metadata.requires_status_sync) {
      const programStatusPath = path.join(context.cwd, config.programStatusPath);
      const programStatus = fs.readFileSync(programStatusPath, 'utf8');
      if (!programStatus.includes(issueId)) {
        throw new BlockError(`PROGRAM_STATUS.md does not contain ${issueId} reference`);
      }
    }

    if (metadata.tier === 'T1' && (!metadata.rollback_plan || metadata.rollback_plan.trim().length === 0)) {
      throw new BlockError('rollback_plan empty - T1 issues require a non-empty rollback plan');
    }

    writeJsonState(
      context.cwd,
      issueId,
      'closed.json',
      {
        timestamp: new Date().toISOString(),
        tier: metadata.tier,
        mergeCommitSha: merged.mergeCommitSha,
        verifyHashChain: hashChain,
        downstreamUnlocks: metadata.downstream_unlocks,
      },
      options.dryRun,
    );
    printChecklist(issueId, metadata.downstream_unlocks);
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            command: 'phase:close',
            issueId,
            status: 'pass',
            mergeCommitSha: merged.mergeCommitSha,
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
