import fs from 'node:fs';
import path from 'node:path';

import { sha256File } from '../lib/hash.js';
import { loadMetadata } from '../lib/metadata.js';
import { BlockError, EXIT_BLOCK, EXIT_ERROR, EXIT_PASS, stderrBlock } from '../lib/result.js';
import { readLatestVerifyState, writeJsonState } from '../lib/state.js';
import type { CommandContext } from '../types.js';

const DEFAULT_SQL_REVIEW_CRITERIA = [
  'Idempotency: can this migration re-run safely if the target state already exists?',
  'Drift tolerance: does it handle committed-schema-vs-live-schema divergence?',
  'Rollback safety: is the rollback SQL valid, complete, and pre-condition-safe?',
  'Side effects: does it touch anything beyond the declared scope (constraints, RLS policies, functions, data migrations)?',
  'Atomic RPC / dependent function impact: does it affect any RPCs that callers rely on (process_submission_atomic, enqueue_distribution_atomic, etc.)?',
];

export async function runPhaseSqlReview(
  context: CommandContext,
  issueId: string,
  options: {
    dryRun: boolean;
    reviewer: string | null;
    reviewedAgainst: string | null;
    confirm: boolean;
    json: boolean;
  },
): Promise<number> {
  try {
    const verify = readLatestVerifyState(context.cwd, issueId);
    if (!verify || verify.verdict !== 'pass') {
      throw new BlockError(`phase:verify has not passed for ${issueId}`);
    }
    const { metadata } = loadMetadata(context.cwd, issueId);
    if (!metadata.requires_migration || verify.migrations.paths.length === 0) {
      throw new BlockError('no migration detected in latest verify state');
    }
    if (options.confirm && !options.reviewer) {
      throw new BlockError('--confirm requires --reviewer');
    }

    console.log(`SQL REVIEW - ${issueId}`);
    for (const migration of verify.migrations.paths) {
      const filePath = path.join(context.cwd, migration.path);
      console.log(`--- ${migration.path} ---`);
      console.log(fs.readFileSync(filePath, 'utf8'));
    }

    console.log('Review criteria:');
    for (const criterion of metadata.sql_review_criteria ?? DEFAULT_SQL_REVIEW_CRITERIA) {
      console.log(`- ${criterion}`);
    }

    if (!options.confirm) {
      console.log('Re-run with --confirm --reviewer <handle> to record the marker.');
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              command: 'phase:sql-review',
              issueId,
              status: 'pass',
              confirmRequired: true,
              migrations: verify.migrations.paths,
            },
            null,
            2,
          ),
        );
      }
      return EXIT_PASS;
    }

    for (const migration of verify.migrations.paths) {
      const currentHash = sha256File(path.join(context.cwd, migration.path));
      if (currentHash !== migration.sha256) {
        throw new BlockError('migration changed after latest verify; re-run phase:verify before recording sql review');
      }
    }

    writeJsonState(
      context.cwd,
      issueId,
      'sql-review.json',
      {
        timestamp: new Date().toISOString(),
        reviewer: options.reviewer,
        reviewedAgainst: options.reviewedAgainst,
        migrations: verify.migrations.paths,
      },
      options.dryRun,
    );
    console.log(`phase:sql-review OK - ${issueId}`);
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            command: 'phase:sql-review',
            issueId,
            status: 'pass',
            confirmed: true,
            reviewer: options.reviewer,
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
