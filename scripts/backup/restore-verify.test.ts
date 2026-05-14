import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildOptions,
  type CommandRunner,
  runRestoreVerify,
  type RestoreVerifyOptions,
} from './restore-verify.js';

function baseOptions(dumpFile: string): RestoreVerifyOptions {
  return {
    dumpFile,
    targetUrl: 'postgresql://restore_user:secret@localhost:5432/unit_talk_restore',
    targetEnvironment: 'restore-drill',
    dryRun: false,
    schema: 'public',
    expectedTables: ['picks', 'audit_log'],
    now: new Date('2026-05-14T12:00:00.000Z'),
  };
}

function withTempDump(run: (dumpFile: string) => Promise<void> | void): Promise<void> | void {
  const dir = mkdtempSync(join(tmpdir(), 'restore-verify-'));
  const dumpFile = join(dir, 'dump.sql');
  writeFileSync(dumpFile, '-- test dump\n', 'utf8');
  const result = run(dumpFile);
  if (result instanceof Promise) {
    return result.finally(() => rmSync(dir, { recursive: true, force: true }));
  }
  rmSync(dir, { recursive: true, force: true });
  return undefined;
}

test('buildOptions supports dry-run mode from CLI arguments', () => {
  const options = buildOptions(
    [
      '--dry-run',
      '--dump-file',
      'backup.sql',
      '--target-url',
      'postgresql://localhost/unit_talk_restore',
      '--target-environment',
      'restore-drill',
      '--schema',
      'public',
      '--expected-table',
      'picks',
    ],
    {},
    new Date('2026-05-14T12:00:00.000Z'),
  );

  assert.equal(options.dryRun, true);
  assert.equal(options.dumpFile, 'backup.sql');
  assert.equal(options.targetEnvironment, 'restore-drill');
  assert.deepEqual(options.expectedTables, ['picks']);
});

test('runRestoreVerify dry-run emits a pass report without invoking commands', async () => {
  await withTempDump(async (dumpFile) => {
    let commandCount = 0;
    const runner: CommandRunner = async () => {
      commandCount += 1;
      return { status: 0, stdout: '', stderr: '' };
    };

    const { exitCode, report } = await runRestoreVerify(
      { ...baseOptions(dumpFile), dryRun: true },
      runner,
    );

    assert.equal(exitCode, 0);
    assert.equal(commandCount, 0);
    assert.equal(report.status, 'pass');
    assert.equal(report.dryRun, true);
    assert.equal(report.restore.attempted, false);
    assert.equal(report.restore.command, 'none');
  });
});

test('runRestoreVerify rejects production targets before restore', async () => {
  await withTempDump(async (dumpFile) => {
    let commandCount = 0;
    const runner: CommandRunner = async () => {
      commandCount += 1;
      return { status: 0, stdout: '', stderr: '' };
    };

    const { exitCode, report } = await runRestoreVerify(
      {
        ...baseOptions(dumpFile),
        targetEnvironment: 'production',
        targetUrl: 'postgresql://postgres:secret@db.zfzdnfwdarxucxtaojxm.supabase.co:5432/postgres',
      },
      runner,
    );

    assert.equal(exitCode, 1);
    assert.equal(commandCount, 0);
    assert.equal(report.target.productionGuard, 'rejected');
    assert.match(report.errors.join('\n'), /production/i);
  });
});

test('runRestoreVerify returns failure exit code when restore command fails', async () => {
  await withTempDump(async (dumpFile) => {
    const runner: CommandRunner = async (command) => {
      assert.equal(command, 'psql');
      return { status: 2, stdout: '', stderr: 'restore failed' };
    };

    const { exitCode, report } = await runRestoreVerify(baseOptions(dumpFile), runner);

    assert.equal(exitCode, 1);
    assert.equal(report.status, 'fail');
    assert.equal(report.restore.attempted, true);
    assert.equal(report.restore.exitCode, 2);
    assert.match(report.errors.join('\n'), /restore failed/);
  });
});

test('runRestoreVerify report includes observability fields, schema sanity, and row counts', async () => {
  await withTempDump(async (dumpFile) => {
    const runner: CommandRunner = async (command, args) => {
      assert.equal(command, 'psql');
      const sql = args.at(-1) ?? '';
      if (sql.includes('information_schema.tables')) {
        return { status: 0, stdout: 'audit_log\npicks\n', stderr: '' };
      }
      if (sql.includes('"picks"')) {
        return { status: 0, stdout: '42\n', stderr: '' };
      }
      if (sql.includes('"audit_log"')) {
        return { status: 0, stdout: '7\n', stderr: '' };
      }
      return { status: 0, stdout: 'restore ok', stderr: '' };
    };

    const { exitCode, report } = await runRestoreVerify(baseOptions(dumpFile), runner);

    assert.equal(exitCode, 0);
    assert.equal(report.service, 'backup-restore-verify');
    assert.equal(report.status, 'pass');
    assert.equal(report.target.environment, 'restore-drill');
    assert.equal(report.target.productionGuard, 'passed');
    assert.equal(report.dump.exists, true);
    assert.equal(report.restore.attempted, true);
    assert.deepEqual(report.checks.schema.missingTables, []);
    assert.deepEqual(report.checks.rowCounts, { picks: 42, audit_log: 7 });
    assert.equal(typeof report.durationMs, 'number');
    assert.equal(report.ts, '2026-05-14T12:00:00.000Z');
  });
});
