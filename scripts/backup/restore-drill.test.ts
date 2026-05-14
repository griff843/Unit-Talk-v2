import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildOptions,
  type DbClient,
  runRestoreDrill,
  type RestoreDrillOptions,
  type RestoreExecutor,
} from './restore-drill.js';

function baseOptions(source: string): RestoreDrillOptions {
  return {
    source,
    targetUrl: 'postgresql://restore_user:secret@localhost:5432/unit_talk_restore',
    tables: ['picks', 'audit_log'],
    dryRun: false,
    timeoutMinutes: 30,
    env: {},
  };
}

function withTempBackup(run: (source: string) => Promise<void> | void): Promise<void> | void {
  const dir = mkdtempSync(join(tmpdir(), 'restore-drill-'));
  const source = join(dir, 'backup.sql');
  writeFileSync(source, '-- backup\n', 'utf8');
  const result = run(source);
  if (result instanceof Promise) {
    return result.finally(() => rmSync(dir, { recursive: true, force: true }));
  }
  rmSync(dir, { recursive: true, force: true });
  return undefined;
}

function fakeDbClient(counts: Record<string, number>): DbClient {
  return {
    async countRows(table: string): Promise<number> {
      return counts[table] ?? 0;
    },
  };
}

test('buildOptions parses dry-run flags and defaults sentinel tables', () => {
  const options = buildOptions(
    [
      '--source=r2/backups/unit-talk.sql',
      '--target-url=postgresql://user:secret@localhost:5432/restore',
      '--dry-run',
    ],
    {},
  );

  assert.equal(options.source, 'r2/backups/unit-talk.sql');
  assert.equal(options.targetUrl, 'postgresql://user:secret@localhost:5432/restore');
  assert.equal(options.dryRun, true);
  assert.equal(options.timeoutMinutes, 30);
  assert.deepEqual(options.tables, [
    'picks',
    'audit_log',
    'distribution_outbox',
    'settlement_records',
    'pick_lifecycle',
  ]);
});

test('runRestoreDrill dry-run validates artifact and skips row-count execution', async () => {
  await withTempBackup(async (source) => {
    let dbCreated = false;
    let restoreCommand = '';

    const { exitCode, report } = await runRestoreDrill(
      { ...baseOptions(source), dryRun: true },
      {
        createDbClient: () => {
          dbCreated = true;
          return fakeDbClient({});
        },
        restoreExecutor: async (): Promise<{ command: string }> => {
          restoreCommand = 'pg_restore --dbname masked backup.sql';
          return { command: restoreCommand };
        },
      },
    );

    assert.equal(exitCode, 0);
    assert.equal(report.passed, true);
    assert.equal(dbCreated, false);
    assert.equal(report.steps.find((step) => step.name === 'restore_to_target')?.status, 'skipped');
    assert.equal(report.steps.find((step) => step.name === 'row_count_sanity_checks')?.status, 'skipped');
    assert.match(report.steps.find((step) => step.name === 'restore_to_target')?.detail ?? '', /would run/);
    assert.equal(restoreCommand, 'pg_restore --dbname masked backup.sql');
  });
});

test('runRestoreDrill rejects production Supabase project target url before restore', async () => {
  await withTempBackup(async (source) => {
    let restoreCalled = false;

    const { exitCode, report } = await runRestoreDrill(
      {
        ...baseOptions(source),
        targetUrl: 'postgresql://postgres:secret@db.zfzdnfwdarxucxtaojxm.supabase.co:5432/postgres',
      },
      {
        restoreExecutor: async (): Promise<{ command: string }> => {
          restoreCalled = true;
          return { command: 'should-not-run' };
        },
      },
    );

    assert.equal(exitCode, 1);
    assert.equal(report.passed, false);
    assert.equal(restoreCalled, false);
    assert.match(report.errors.join('\n'), /production Supabase project/);
    assert.equal(report.steps[0]?.name, 'production_guard');
    assert.equal(report.steps[0]?.status, 'fail');
  });
});

test('runRestoreDrill rejects NODE_ENV production without ALLOW_PROD_DRILL', async () => {
  await withTempBackup(async (source) => {
    const { exitCode, report } = await runRestoreDrill({
      ...baseOptions(source),
      env: { NODE_ENV: 'production' },
    });

    assert.equal(exitCode, 1);
    assert.equal(report.passed, false);
    assert.match(report.errors.join('\n'), /NODE_ENV=production/);
    assert.equal(report.steps[0]?.status, 'fail');
  });
});

test('runRestoreDrill happy path records timestamps, masked target, row counts, and pass steps', async () => {
  await withTempBackup(async (source) => {
    const dates = [
      new Date('2026-05-14T12:00:00.000Z'),
      new Date('2026-05-14T12:00:00.010Z'),
      new Date('2026-05-14T12:00:00.030Z'),
      new Date('2026-05-14T12:00:00.050Z'),
      new Date('2026-05-14T12:00:00.080Z'),
      new Date('2026-05-14T12:00:00.100Z'),
      new Date('2026-05-14T12:00:00.130Z'),
      new Date('2026-05-14T12:00:00.150Z'),
      new Date('2026-05-14T12:00:00.180Z'),
      new Date('2026-05-14T12:00:00.200Z'),
      new Date('2026-05-14T12:00:00.220Z'),
    ];
    let nowIndex = 0;

    const { exitCode, report } = await runRestoreDrill(
      baseOptions(source),
      {
        createDbClient: () => fakeDbClient({ picks: 42, audit_log: 7 }),
        restoreExecutor: async (): Promise<{ command: string }> => ({ command: 'pg_restore --dbname *** backup.sql' }),
        now: () => dates[Math.min(nowIndex++, dates.length - 1)]!,
      },
    );

    assert.equal(exitCode, 0);
    assert.equal(report.service, 'restore-drill');
    assert.equal(report.passed, true);
    assert.equal(report.source, source);
    assert.equal(report.target_masked, 'postgresql://***:***@localhost:5432/unit_talk_restore');
    assert.equal(report.started_at, '2026-05-14T12:00:00.000Z');
    assert.equal(report.finished_at, '2026-05-14T12:00:00.220Z');
    assert.equal(report.duration_ms, 220);
    assert.deepEqual(report.errors, []);
    assert.deepEqual(
      report.steps.map((step) => [step.name, step.status]),
      [
        ['production_guard', 'pass'],
        ['validate_artifact', 'pass'],
        ['restore_to_target', 'pass'],
        ['row_count_sanity_checks', 'pass'],
        ['timeout_check', 'pass'],
      ],
    );
    assert.deepEqual(JSON.parse(report.steps[3]?.detail ?? '{}'), { picks: 42, audit_log: 7 });
  });
});

test('runRestoreDrill propagates step failures and exits non-zero', async () => {
  await withTempBackup(async (source) => {
    const restoreExecutor: RestoreExecutor = async () => {
      throw new Error('restore command planning failed');
    };

    const { exitCode, report } = await runRestoreDrill(
      baseOptions(source),
      { restoreExecutor },
    );

    assert.equal(exitCode, 1);
    assert.equal(report.passed, false);
    assert.match(report.errors.join('\n'), /restore command planning failed/);
    assert.equal(report.steps.find((step) => step.name === 'restore_to_target')?.status, 'fail');
    assert.equal(report.steps.some((step) => step.name === 'row_count_sanity_checks'), false);
  });
});

test('runRestoreDrill detects timeout and reports the failing timeout step', async () => {
  await withTempBackup(async (source) => {
    const dates = [
      new Date('2026-05-14T12:00:00.000Z'),
      new Date('2026-05-14T12:02:00.000Z'),
      new Date('2026-05-14T12:02:00.010Z'),
      new Date('2026-05-14T12:02:00.020Z'),
    ];
    let nowIndex = 0;

    const { exitCode, report } = await runRestoreDrill(
      {
        ...baseOptions(source),
        timeoutMinutes: 1,
      },
      {
        now: () => dates[Math.min(nowIndex++, dates.length - 1)]!,
      },
    );

    assert.equal(exitCode, 1);
    assert.equal(report.passed, false);
    assert.match(report.errors.join('\n'), /exceeded timeout/);
    assert.equal(report.steps.find((step) => step.name === 'validate_artifact')?.status, 'fail');
  });
});
