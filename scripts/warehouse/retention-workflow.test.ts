import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { openDuckDb, quote } from './duckdb.js';
import { buildManifest, serializeManifest } from './manifest.js';
import { LocalObjectStore, sha256Hex } from './object-store.js';
import { runPsqlScript, verifyRetentionEvidence } from './retention.js';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const migrationPath = path.join(
  root,
  'supabase/migrations/20260928131714_utv2_1370_warehouse_retention.sql',
);
test('migration is allowlisted, bounded, fail-closed, and keeps legacy cron disabled', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(
    sql,
    /source_name in \('provider_offer_history', 'raw_payloads', 'odds_snapshots', 'system_runs'\)/,
  );
  assert.doesNotMatch(
    sql,
    /delete from public\.(?:picks|settlement_records|audit_log|provider_offers_legacy_quarantine)/i,
  );
  assert.doesNotMatch(sql, /on delete\s+(?:cascade|set null)/i);
  assert.match(sql, /bounded canary ceiling is 10000 rows/);
  assert.match(sql, /manifest fingerprint changed since dry run/);
  assert.match(
    sql,
    /recovery manifest fingerprint does not match execution receipt/,
  );
  assert.match(
    sql,
    /recovery object fingerprint does not match execution receipt/,
  );
  assert.match(sql, /row\(s\) became reference-protected; prune refused/);
  assert.match(sql, /legacy nightly-retention-prune is active; refusing/);
  assert.doesNotMatch(sql, /^\s*update\s+cron\.job/im);
  assert.doesNotMatch(sql, /^\s*(?:select\s+)?cron\.schedule\s*\(/im);
});

test(
  'staging lifecycle proves refusal, bounded deletion, independent receipt truth, and recovery',
  { skip: !process.env.WAREHOUSE_RETENTION_TEST_DSN },
  async (t) => {
    const dsn = process.env.WAREHOUSE_RETENTION_TEST_DSN!;
    const suffix = `${process.pid}_${Date.now().toString(36)}`;
    const proofSchema = `utv2_1370_${suffix}`;
    const proofCronSchema = `utv2_1370_cron_${suffix}`;
    const plannerRole = `utv2_1370_planner_${suffix}`;
    const executorRole = `utv2_1370_executor_${suffix}`;
    const recoveryRole = `utv2_1370_recovery_${suffix}`;
    const scopeSql = (sql: string): string =>
      sql
        .replaceAll('warehouse_retention_planner', plannerRole)
        .replaceAll('warehouse_retention_executor', executorRole)
        .replaceAll('warehouse_retention_recovery', recoveryRole)
        .replaceAll('public.', `${proofSchema}.`)
        .replaceAll('cron.', `${proofCronSchema}.`);
    const run = (sql: string, variables?: Record<string, string>) =>
      runPsqlScript(dsn, scopeSql(sql), variables);
    await runPsqlScript(
      dsn,
      `create schema ${proofSchema}; create schema ${proofCronSchema};`,
    );
    t.after(async () => {
      await runPsqlScript(
        dsn,
        `drop schema if exists ${proofSchema} cascade;
         drop schema if exists ${proofCronSchema} cascade;
         drop role if exists ${plannerRole};
         drop role if exists ${executorRole};
         drop role if exists ${recoveryRole};`,
      );
    });
    const migration = scopeSql(fs.readFileSync(migrationPath, 'utf8'));
    const fixture = `
      create table cron.job(jobname text primary key, active boolean not null);
      insert into cron.job values ('nightly-retention-prune', false);

      create table public.system_runs(id uuid primary key, started_at timestamptz not null);
      create table public.raw_payloads(id uuid primary key, snapshot_at timestamptz not null);
      create table public.odds_snapshots(
        id uuid primary key,
        snapshot_at timestamptz not null,
        raw_payload_id uuid,
        prior_snapshot_id uuid,
        constraint odds_snapshots_raw_payload_id_fkey foreign key(raw_payload_id) references public.raw_payloads(id),
        constraint odds_snapshots_prior_snapshot_id_fkey foreign key(prior_snapshot_id) references public.odds_snapshots(id)
      );
      create table public.odds_snapshot_corrections(
        snapshot_id uuid,
        new_snapshot_id uuid,
        constraint odds_snapshot_corrections_snapshot_id_fkey foreign key(snapshot_id) references public.odds_snapshots(id),
        constraint odds_snapshot_corrections_new_snapshot_id_fkey foreign key(new_snapshot_id) references public.odds_snapshots(id)
      );
      create table public.provider_offer_history(
        id uuid primary key,
        snapshot_at timestamptz not null,
        source_run_id uuid,
        constraint provider_offer_history_source_run_id_fkey foreign key(source_run_id) references public.system_runs(id)
      );
      create table public.pick_candidates(scoring_run_id uuid,
        constraint pick_candidates_scoring_run_id_fkey foreign key(scoring_run_id) references public.system_runs(id));
      create table public.pick_offer_snapshots(source_run_id uuid,
        constraint pick_offer_snapshots_source_run_id_fkey foreign key(source_run_id) references public.system_runs(id));
      create table public.provider_cycle_status(run_id uuid,
        constraint provider_cycle_status_run_id_fkey foreign key(run_id) references public.system_runs(id));
      create table public.provider_offer_current(source_run_id uuid,
        constraint provider_offer_current_source_run_id_fkey foreign key(source_run_id) references public.system_runs(id));
      create table public.provider_offer_history_compact(source_run_id uuid,
        constraint provider_offer_history_compact_source_run_id_fkey foreign key(source_run_id) references public.system_runs(id));
      create table public.provider_offer_staging(run_id uuid,
        constraint provider_offer_staging_run_id_fkey foreign key(run_id) references public.system_runs(id));
      create table public.provider_offers_legacy_quarantine(id uuid primary key);
      create table public.picks(id uuid primary key);
      create table public.audit_log(id uuid primary key);
      insert into public.provider_offers_legacy_quarantine values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      insert into public.picks values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
      insert into public.audit_log values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc');

      create function public.raw_payloads_immutable() returns trigger language plpgsql set search_path = '' as
      $$ begin raise exception 'raw immutable'; end $$;
      create trigger raw_payloads_immutable before update or delete on public.raw_payloads
        for each row execute function public.raw_payloads_immutable();
      create function public.odds_snapshots_immutable() returns trigger language plpgsql set search_path = '' as
      $$ begin raise exception 'odds immutable'; end $$;
      create trigger odds_snapshots_immutable before update or delete on public.odds_snapshots
        for each row execute function public.odds_snapshots_immutable();
    `;
    await run(fixture);
    await runPsqlScript(dsn, migration);

    const archiveRoot = fs.mkdtempSync(
      path.join(process.cwd(), '.retention-proof-'),
    );
    const archiveFile = path.join(archiveRoot, 'canary.parquet');
    const duck = await openDuckDb();
    await duck.run(
      'CREATE TABLE canary(id UUID, snapshot_at TIMESTAMPTZ, source_run_id UUID)',
    );
    await duck.run(
      `INSERT INTO canary VALUES ('11111111-1111-4111-8111-111111111111','2026-06-14T12:00:00Z',NULL)`,
    );
    await duck.run(
      `COPY canary TO ${quote(archiveFile)} (FORMAT PARQUET, COMPRESSION ZSTD)`,
    );
    await duck.close();
    const archiveBytes = fs.readFileSync(archiveFile);
    const store = new LocalObjectStore(
      path.join(archiveRoot, 'bucket'),
      'warehouse-archive',
    );
    const manifest = buildManifest({
      target: {
        kind: 'canonical',
        domain: 'markets',
        sport: 'all',
        season: '2026',
        date: '2026-06-14',
      },
      bucket: 'warehouse-archive',
      sourceRelation: 'public.provider_offer_history',
      sourceRowCount: 1,
      window: {
        column: 'snapshot_at',
        start: '2026-06-14T00:00:00.000Z',
        end: '2026-06-15T00:00:00.000Z',
      },
      exportedRowCount: 1,
      byteSize: archiveBytes.length,
      checksumSha256: sha256Hex(archiveBytes),
      columns: [
        { name: 'id', type: 'UUID' },
        { name: 'snapshot_at', type: 'TIMESTAMP WITH TIME ZONE' },
        { name: 'source_run_id', type: 'UUID' },
      ],
      rowGroupSize: 10_000,
      exporterRepoSha: 'abcdef1234567',
      exportedAt: '2026-06-15T01:00:00.000Z',
    });
    manifest.verification = {
      verified_at: '2026-06-15T01:01:00.000Z',
      object_exists: true,
      row_count_match: true,
      checksum_verified: true,
      parquet_readable: true,
      sample_readback_rows: 1,
      sample_readback_match: true,
      passed: true,
      failures: [],
    };
    await store.put(
      manifest.object.data_key,
      archiveBytes,
      'application/vnd.apache.parquet',
    );
    await store.put(
      manifest.object.manifest_key,
      Buffer.from(serializeManifest(manifest)),
      'application/json',
    );
    const evidence = await verifyRetentionEvidence({
      store,
      source: 'provider_offer_history',
      date: '2026-06-14',
      includeRows: true,
    });

    const callAs = async (role: string, query: string, params: unknown[]) => {
      const variables = Object.fromEntries(
        params.map((value, index) => [`p${index + 1}`, String(value)]),
      );
      const parameterized = query.replace(
        /\$(\d+)/g,
        (_match, index: string) => `:'p${index}'`,
      );
      const output = await run(
        `begin; set local role ${role}; ${parameterized.replace(/\s+result$/, '::text')}; commit;`,
        variables,
      );
      return JSON.parse(output) as Record<string, unknown>;
    };
    const scalar = async (query: string): Promise<string> =>
      run(query);
    const hashA = evidence.manifestSha256;
    const hashB = 'b'.repeat(64);
    const fresh = evidence.evidenceCheckedAt;

    await run(
      `insert into public.provider_offer_history values ('11111111-1111-4111-8111-111111111111', '2026-06-14T12:00:00Z', null)`,
    );
    await assert.rejects(
      callAs(
        'warehouse_retention_planner',
        `select public.warehouse_retention_plan_window($1,$2::date,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9,$10,$11) result`,
        [
          'provider_offer_history',
          '2026-06-14',
          manifest.manifest_id,
          manifest.object.manifest_key,
          hashA,
          2,
          manifest.verification.verified_at,
          fresh,
          manifest.object.checksum_sha256,
          'mismatch',
          'ci',
        ],
      ),
      /hot\/archive row count mismatch/,
    );
    await assert.rejects(
      callAs(
        'warehouse_retention_planner',
        `select public.warehouse_retention_plan_window($1,$2::date,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9,$10,$11) result`,
        [
          'provider_offer_history',
          '2026-06-14',
          manifest.manifest_id,
          manifest.object.manifest_key,
          hashA,
          1,
          manifest.verification.verified_at,
          '2020-01-01T00:00:00Z',
          manifest.object.checksum_sha256,
          'stale',
          'ci',
        ],
      ),
      /evidence is stale/,
    );

    const plan = await callAs(
      'warehouse_retention_planner',
      `select public.warehouse_retention_plan_window($1,$2::date,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9,$10,$11) result`,
      [
        'provider_offer_history',
        '2026-06-14',
        manifest.manifest_id,
        manifest.object.manifest_key,
        hashA,
        1,
        manifest.verification.verified_at,
        fresh,
        manifest.object.checksum_sha256,
        'canary',
        'ci',
      ],
    );
    assert.equal(plan.status, 'dry_run_verified');
    assert.equal(Number(plan.hot_row_count), 1);

    await assert.rejects(
      callAs(
        'warehouse_retention_executor',
        `select public.warehouse_retention_execute_window($1::uuid,$2,$3::timestamptz,$4) result`,
        [plan.plan_id, hashB, fresh, 'ci'],
      ),
      /fingerprint changed/,
    );
    const execution = await callAs(
      'warehouse_retention_executor',
      `select public.warehouse_retention_execute_window($1::uuid,$2,$3::timestamptz,$4) result`,
      [plan.plan_id, hashA, fresh, 'ci'],
    );
    assert.equal(execution.status, 'pruned');
    assert.equal(Number(execution.rows_deleted), 1);
    assert.equal(
      Number(
        await scalar('select count(*)::int from public.provider_offer_history'),
      ),
      0,
    );
    const postDeleteEvidence = await verifyRetentionEvidence({
      store,
      source: 'provider_offer_history',
      date: '2026-06-14',
      includeRows: true,
    });
    assert.equal(postDeleteEvidence.rows?.length, 1);

    const changedArchiveFile = path.join(archiveRoot, 'changed-canary.parquet');
    const changedDuck = await openDuckDb();
    await changedDuck.run(
      'CREATE TABLE changed_canary(id UUID, snapshot_at TIMESTAMPTZ, source_run_id UUID)',
    );
    await changedDuck.run(
      `INSERT INTO changed_canary VALUES ('99999999-9999-4999-8999-999999999999','2026-06-14T12:00:00Z',NULL)`,
    );
    await changedDuck.run(
      `COPY changed_canary TO ${quote(changedArchiveFile)} (FORMAT PARQUET, COMPRESSION ZSTD)`,
    );
    await changedDuck.close();
    const changedArchiveBytes = fs.readFileSync(changedArchiveFile);
    const changedManifest = structuredClone(manifest);
    changedManifest.object.byte_size = changedArchiveBytes.length;
    changedManifest.object.checksum_sha256 = sha256Hex(changedArchiveBytes);
    await store.put(
      changedManifest.object.data_key,
      changedArchiveBytes,
      'application/vnd.apache.parquet',
    );
    await store.put(
      changedManifest.object.manifest_key,
      Buffer.from(serializeManifest(changedManifest)),
      'application/json',
    );
    const changedEvidence = await verifyRetentionEvidence({
      store,
      source: 'provider_offer_history',
      date: '2026-06-14',
      includeRows: true,
    });
    assert.equal(changedEvidence.rows?.length, 1);
    await assert.rejects(
      callAs(
        'warehouse_retention_recovery',
        `select public.warehouse_retention_recover_window($1::uuid,$2::jsonb,$3,$4,$5::timestamptz,$6) result`,
        [
          execution.execution_id,
          JSON.stringify(changedEvidence.rows),
          changedEvidence.manifestSha256,
          changedEvidence.objectSha256,
          changedEvidence.evidenceCheckedAt,
          'ci',
        ],
      ),
      /recovery manifest fingerprint does not match execution receipt/,
    );
    assert.equal(
      Number(
        await scalar('select count(*)::int from public.provider_offer_history'),
      ),
      0,
    );

    await store.put(
      manifest.object.data_key,
      archiveBytes,
      'application/vnd.apache.parquet',
    );
    await store.put(
      manifest.object.manifest_key,
      Buffer.from(serializeManifest(manifest)),
      'application/json',
    );
    const exactRecoveryEvidence = await verifyRetentionEvidence({
      store,
      source: 'provider_offer_history',
      date: '2026-06-14',
      includeRows: true,
    });

    const recovery = await callAs(
      'warehouse_retention_recovery',
      `select public.warehouse_retention_recover_window($1::uuid,$2::jsonb,$3,$4,$5::timestamptz,$6) result`,
      [
        execution.execution_id,
        JSON.stringify(exactRecoveryEvidence.rows),
        exactRecoveryEvidence.manifestSha256,
        exactRecoveryEvidence.objectSha256,
        exactRecoveryEvidence.evidenceCheckedAt,
        'ci',
      ],
    );
    assert.equal(recovery.status, 'recovered');
    assert.equal(
      Number(
        await scalar('select count(*)::int from public.provider_offer_history'),
      ),
      1,
    );

    await run(
      `insert into public.raw_payloads values ('33333333-3333-4333-8333-333333333333','2026-01-02T12:00:00Z')`,
    );
    await run(
      `insert into public.odds_snapshots values ('44444444-4444-4444-8444-444444444444','2026-09-28T12:00:00Z','33333333-3333-4333-8333-333333333333',null)`,
    );
    await assert.rejects(
      run(
        `delete from public.raw_payloads where id='33333333-3333-4333-8333-333333333333'`,
      ),
      /raw_payloads rows are immutable/,
    );
    await assert.rejects(
      callAs(
        'warehouse_retention_planner',
        `select public.warehouse_retention_plan_window($1,$2::date,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9,$10,$11) result`,
        [
          'raw_payloads',
          '2026-01-02',
          'm-raw',
          'manifests/raw.json',
          hashA,
          1,
          fresh,
          fresh,
          hashB,
          'raw-protected',
          'ci',
        ],
      ),
      /reference-protected/,
    );
    await run(
      `insert into public.odds_snapshots values ('55555555-5555-4555-8555-555555555555','2026-01-03T12:00:00Z',null,null)`,
    );
    await run(
      `insert into public.odds_snapshot_corrections values ('55555555-5555-4555-8555-555555555555','44444444-4444-4444-8444-444444444444')`,
    );
    await assert.rejects(
      callAs(
        'warehouse_retention_planner',
        `select public.warehouse_retention_plan_window($1,$2::date,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9,$10,$11) result`,
        [
          'odds_snapshots',
          '2026-01-03',
          'm-odds',
          'manifests/odds.json',
          hashA,
          1,
          fresh,
          fresh,
          hashB,
          'odds-protected',
          'ci',
        ],
      ),
      /reference-protected/,
    );

    await run(
      `insert into public.system_runs values ('22222222-2222-4222-8222-222222222222','2026-01-01T12:00:00Z')`,
    );
    await run(
      `insert into public.pick_candidates values ('22222222-2222-4222-8222-222222222222')`,
    );
    await assert.rejects(
      callAs(
        'warehouse_retention_planner',
        `select public.warehouse_retention_plan_window($1,$2::date,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9,$10,$11) result`,
        [
          'system_runs',
          '2026-01-01',
          'm2',
          'manifests/y.json',
          hashA,
          1,
          fresh,
          fresh,
          hashB,
          'protected',
          'ci',
        ],
      ),
      /reference-protected/,
    );

    assert.equal(
      Number(
        await scalar(
          'select count(*)::int from public.provider_offers_legacy_quarantine',
        ),
      ),
      1,
    );
    assert.equal(
      Number(await scalar('select count(*)::int from public.picks')),
      1,
    );
    assert.equal(
      Number(await scalar('select count(*)::int from public.audit_log')),
      1,
    );
    assert.equal(
      await scalar(
        "select active from cron.job where jobname='nightly-retention-prune'",
      ),
      'f',
    );
    assert.equal(
      await scalar(
        "select has_table_privilege('warehouse_retention_executor','public.provider_offer_history','DELETE')",
      ),
      'f',
    );
    fs.rmSync(archiveRoot, { recursive: true, force: true });
  },
);
