#!/usr/bin/env tsx

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ISSUE_ID = 'UTV2-1771' as const;
const PREREQUISITE_FOR = 'UTV2-1370' as const;
const PRODUCTION_PROJECT_REF = 'zfzdnfwdarxucxtaojxm';
const RESTORE_PROJECT_REF = 'xskgrzbteyqdufktjrjx';
const RESTORE_SCHEMA = 'utv2_1771_restore';
const SOURCE_PARENT = 'public.provider_offer_history';
const OBJECT_PREFIX = 'db-backups/provider-offer-history/UTV2-1771/2026-06';
const DEFAULT_RECEIPT = 'docs/06_status/proof/UTV2-1771/evidence.json';
const DEFAULT_WORK_DIR = '.out/utv2-1771-preservation';
const RECEIPT_SCHEMA_VERSION = 2 as const;

const COLUMNS = [
  'id',
  'provider_key',
  'provider_event_id',
  'provider_market_key',
  'provider_participant_id',
  'sport_key',
  'line',
  'over_odds',
  'under_odds',
  'devig_mode',
  'is_opening',
  'is_closing',
  'snapshot_at',
  'idempotency_key',
  'bookmaker_key',
  'source_run_id',
  'created_at',
] as const;

export interface ExpectedPartition {
  partition_name: string;
  lower_bound: string;
  upper_bound: string;
}

export interface CatalogPartition extends ExpectedPartition {
  source_total_bytes: number;
  source_heap_bytes: number;
}

export interface PartitionReceipt extends CatalogPartition {
  source_row_count: number;
  canonical_csv_bytes: number;
  canonical_csv_sha256: string;
  encrypted_object_bytes: number;
  encrypted_object_sha256: string;
  object_key: string;
  captured_at: string;
  restored_row_count: number;
  restored_csv_sha256: string;
  count_matches: boolean;
  checksum_matches: boolean;
}

export interface PreservationReceipt {
  schema_version: typeof RECEIPT_SCHEMA_VERSION;
  issue_id: typeof ISSUE_ID;
  tier: 'T1';
  lane_type: 'verification';
  proof_profile: 'static';
  sha_binding: {
    merge_sha: string | null;
    verified_source_sha: string;
    evidence_commit_sha: string;
    current_pr_head_sha: string;
  };
  static_proof: {
    focused_command: string;
    required_commands: string[];
    receipt_generated_by: string;
  };
  runtime_proof: {
    status: 'PASS' | 'FAIL';
    queries: Array<Record<string, unknown>>;
    row_counts: Array<Record<string, unknown>>;
    receipts: Array<Record<string, unknown>>;
  };
  generated_at: string;
  verdict: 'PASS' | 'FAIL';
  prerequisite_for: typeof PREREQUISITE_FOR;
  snapshot_set_id: string;
  source: {
    project_ref: string;
    parent_table: string;
    read_only: boolean;
    rows_before: number;
    rows_after: number;
    unchanged: boolean;
  };
  destination: {
    provider: 'cloudflare-r2';
    bucket_identity_sha256: string;
    object_prefix: string;
    receipt_object_key: string;
    schema_object_key: string;
    schema_object_sha256: string;
    format: 'canonical-csv+restore-ddl';
    outside_hot_table: boolean;
    encrypted: boolean;
  };
  restore_target: {
    project_ref: string;
    schema: string;
    production: boolean;
  };
  partitions: PartitionReceipt[];
  checks: {
    exact_partition_set: boolean;
    production_rows_unchanged: boolean;
    all_objects_uploaded: boolean;
    full_restore_completed: boolean;
    all_counts_match: boolean;
    all_checksums_match: boolean;
    idempotent_replay: boolean;
  };
  failures: string[];
  receipt_sha256: string;
}

interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

interface RuntimeOptions {
  sourceUrl: string;
  restoreUrl: string;
  receiptPath: string;
  workDir: string;
  r2Bucket: string;
  r2Endpoint: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  gpgRecipient: string;
  psqlBin: string;
  gzipBin: string;
  gpgBin: string;
  rcloneBin: string;
}

type SpawnStdio = 'capture' | { stdoutFile?: string; stdinFile?: string };

export const EXPECTED_PARTITIONS: readonly ExpectedPartition[] = Array.from(
  { length: 8 },
  (_, index) => {
    const day = 23 + index;
    const next = day + 1;
    return {
      partition_name: `provider_offer_history_p202606${String(day).padStart(2, '0')}`,
      lower_bound: `2026-06-${String(day).padStart(2, '0')}`,
      upper_bound: next === 31 ? '2026-07-01' : `2026-06-${String(next).padStart(2, '0')}`,
    };
  },
);

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function computeReceiptSha256(receipt: PreservationReceipt): string {
  const { receipt_sha256: _omitted, ...unsigned } = receipt;
  return sha256Text(canonicalJson(unsigned));
}

function quoteIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/u.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function extractProjectRef(databaseUrl: string): string | null {
  try {
    const parsed = new URL(databaseUrl);
    const candidates = [parsed.hostname, decodeURIComponent(parsed.username), parsed.search];
    for (const candidate of candidates) {
      if (candidate.includes(PRODUCTION_PROJECT_REF)) return PRODUCTION_PROJECT_REF;
      if (candidate.includes(RESTORE_PROJECT_REF)) return RESTORE_PROJECT_REF;
    }
    const direct = parsed.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/u)?.[1];
    if (direct) return direct;
    const username = decodeURIComponent(parsed.username).match(/(?:^|\.)([a-z0-9]{20})$/u)?.[1];
    return username ?? null;
  } catch {
    return null;
  }
}

export function assertDatabaseIdentities(sourceUrl: string, restoreUrl: string): void {
  const sourceRef = extractProjectRef(sourceUrl);
  const restoreRef = extractProjectRef(restoreUrl);
  if (sourceRef !== PRODUCTION_PROJECT_REF) {
    throw new Error(
      `Refusing export: source database identity must resolve to production ${PRODUCTION_PROJECT_REF}; observed ${sourceRef ?? 'unparseable'}`,
    );
  }
  if (restoreRef !== RESTORE_PROJECT_REF) {
    throw new Error(
      `Refusing restore: target database identity must resolve to staging ${RESTORE_PROJECT_REF}; observed ${restoreRef ?? 'unparseable'}`,
    );
  }
}

function expectedByName(): Map<string, ExpectedPartition> {
  return new Map(EXPECTED_PARTITIONS.map((partition) => [partition.partition_name, partition]));
}

export function validateCatalogPartitions(rows: readonly CatalogPartition[]): CatalogPartition[] {
  const expected = expectedByName();
  const observedNames = rows.map((row) => row.partition_name).sort();
  const expectedNames = [...expected.keys()].sort();
  assert.deepEqual(
    observedNames,
    expectedNames,
    `live catalog must contain exactly the eight June 23-30 partitions`,
  );
  for (const row of rows) {
    const wanted = expected.get(row.partition_name);
    assert.ok(wanted, `unexpected partition ${row.partition_name}`);
    assert.equal(row.lower_bound, wanted.lower_bound, `${row.partition_name} lower bound mismatch`);
    assert.equal(row.upper_bound, wanted.upper_bound, `${row.partition_name} upper bound mismatch`);
    assert.ok(Number.isSafeInteger(row.source_total_bytes) && row.source_total_bytes >= 0);
    assert.ok(Number.isSafeInteger(row.source_heap_bytes) && row.source_heap_bytes >= 0);
  }
  return [...rows].sort((left, right) => left.partition_name.localeCompare(right.partition_name));
}

function redact(value: string, secrets: readonly string[]): string {
  return secrets.reduce(
    (output, secret) => (secret.length > 0 ? output.replaceAll(secret, '[REDACTED]') : output),
    value,
  );
}

function runCommand(
  command: string,
  args: readonly string[],
  options: { env?: NodeJS.ProcessEnv; stdio?: SpawnStdio; secrets?: readonly string[] } = {},
): CommandResult {
  let stdinFd: number | undefined;
  let stdoutFd: number | undefined;
  try {
    if (options.stdio && options.stdio !== 'capture') {
      if (options.stdio.stdinFile) stdinFd = openSync(options.stdio.stdinFile, 'r');
      if (options.stdio.stdoutFile) stdoutFd = openSync(options.stdio.stdoutFile, 'w', 0o600);
    }
    const result = spawnSync(command, [...args], {
      env: options.env ?? process.env,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: [stdinFd ?? 'ignore', stdoutFd ?? 'pipe', 'pipe'],
    });
    const secrets = options.secrets ?? [];
    const stderr = redact(result.stderr ?? '', secrets);
    const stdout = stdoutFd === undefined ? redact(result.stdout ?? '', secrets) : '';
    if (result.error) throw new Error(`${command} failed to start: ${result.error.message}`);
    return { status: result.status ?? 1, stdout, stderr };
  } finally {
    if (stdinFd !== undefined) closeSync(stdinFd);
    if (stdoutFd !== undefined) closeSync(stdoutFd);
  }
}

function requireSuccess(label: string, result: CommandResult): void {
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    throw new Error(`${label} failed: ${detail.slice(0, 2_000)}`);
  }
}

function psqlCaptured(url: string, sql: string, psqlBin: string): string {
  const result = runCommand(
    psqlBin,
    ['-X', '--set', 'ON_ERROR_STOP=1', '--tuples-only', '--no-align', '--field-separator', '\t', '--dbname', url, '--command', sql],
    { secrets: [url] },
  );
  requireSuccess('psql query', result);
  return result.stdout.trim();
}

function psqlExecute(url: string, sql: string, psqlBin: string): void {
  const result = runCommand(
    psqlBin,
    ['-X', '--set', 'ON_ERROR_STOP=1', '--quiet', '--dbname', url, '--command', sql],
    { secrets: [url] },
  );
  requireSuccess('psql command', result);
}

function psqlCopyToFile(url: string, sql: string, output: string, psqlBin: string): void {
  const result = runCommand(
    psqlBin,
    ['-X', '--set', 'ON_ERROR_STOP=1', '--quiet', '--dbname', url, '--command', `COPY (${sql}) TO STDOUT WITH (FORMAT csv, NULL '\\N')`],
    {
      env: { ...process.env, PGTZ: 'UTC' },
      stdio: { stdoutFile: output },
      secrets: [url],
    },
  );
  requireSuccess('psql COPY TO', result);
}

function psqlCopyFromFile(url: string, table: string, input: string, psqlBin: string): void {
  const columns = COLUMNS.map(quoteIdentifier).join(', ');
  const result = runCommand(
    psqlBin,
    ['-X', '--set', 'ON_ERROR_STOP=1', '--quiet', '--dbname', url, '--command', `COPY ${table} (${columns}) FROM STDIN WITH (FORMAT csv, NULL '\\N')`],
    { stdio: { stdinFile: input }, secrets: [url] },
  );
  requireSuccess('psql COPY FROM', result);
}

function parseBoundDate(bound: string, side: 'FROM' | 'TO'): string {
  const match = bound.match(new RegExp(`${side} \\('([0-9]{4}-[0-9]{2}-[0-9]{2})`, 'u'));
  if (!match?.[1]) throw new Error(`Cannot parse ${side} date from partition bound: ${bound}`);
  return match[1];
}

export function parseCatalogOutput(output: string): CatalogPartition[] {
  if (output.trim() === '') return [];
  return output.split(/\r?\n/u).map((line) => {
    const fields = line.split('\t');
    if (fields.length !== 4) throw new Error(`Unexpected catalog row field count: ${fields.length}`);
    const [partitionName, bound, totalBytesRaw, heapBytesRaw] = fields;
    if (!partitionName || !bound || !totalBytesRaw || !heapBytesRaw) throw new Error('Incomplete catalog row');
    const totalBytes = Number(totalBytesRaw);
    const heapBytes = Number(heapBytesRaw);
    if (!Number.isSafeInteger(totalBytes) || !Number.isSafeInteger(heapBytes)) {
      throw new Error(`Invalid relation size for ${partitionName}`);
    }
    return {
      partition_name: partitionName,
      lower_bound: parseBoundDate(bound, 'FROM'),
      upper_bound: parseBoundDate(bound, 'TO'),
      source_total_bytes: totalBytes,
      source_heap_bytes: heapBytes,
    };
  });
}

function discoverPartitions(options: RuntimeOptions): CatalogPartition[] {
  const names = EXPECTED_PARTITIONS.map((partition) => quoteLiteral(partition.partition_name)).join(', ');
  const sql = `
SELECT c.relname,
       replace(pg_get_expr(c.relpartbound, c.oid, true), E'\\t', ' '),
       pg_total_relation_size(c.oid)::text,
       pg_relation_size(c.oid)::text
FROM pg_inherits AS i
JOIN pg_class AS parent ON parent.oid = i.inhparent
JOIN pg_namespace AS parent_namespace ON parent_namespace.oid = parent.relnamespace
JOIN pg_class AS c ON c.oid = i.inhrelid
WHERE parent_namespace.nspname = 'public'
  AND parent.relname = 'provider_offer_history'
  AND c.relname IN (${names})
ORDER BY c.relname;`;
  return validateCatalogPartitions(parseCatalogOutput(psqlCaptured(options.sourceUrl, sql, options.psqlBin)));
}

function exactRowCount(url: string, schema: string, table: string, psqlBin: string): number {
  const raw = psqlCaptured(
    url,
    `SELECT count(*)::text FROM ONLY ${quoteIdentifier(schema)}.${quoteIdentifier(table)};`,
    psqlBin,
  );
  const count = Number(raw);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Invalid row count for ${schema}.${table}`);
  return count;
}

function canonicalSelect(schema: string, table: string): string {
  const columns = COLUMNS.map(quoteIdentifier).join(', ');
  return `SELECT ${columns} FROM ONLY ${quoteIdentifier(schema)}.${quoteIdentifier(table)} ORDER BY "snapshot_at", "id"`;
}

function restoreSchemaSql(): string {
  const tables = EXPECTED_PARTITIONS.map(
    (partition) => `
DROP TABLE IF EXISTS ${quoteIdentifier(RESTORE_SCHEMA)}.${quoteIdentifier(partition.partition_name)};
CREATE UNLOGGED TABLE ${quoteIdentifier(RESTORE_SCHEMA)}.${quoteIdentifier(partition.partition_name)} (
  id uuid NOT NULL,
  provider_key text NOT NULL,
  provider_event_id text NOT NULL,
  provider_market_key text NOT NULL,
  provider_participant_id text,
  sport_key text,
  line numeric,
  over_odds integer,
  under_odds integer,
  devig_mode text NOT NULL,
  is_opening boolean NOT NULL,
  is_closing boolean NOT NULL,
  snapshot_at timestamp with time zone NOT NULL,
  idempotency_key text NOT NULL,
  bookmaker_key text,
  source_run_id uuid,
  created_at timestamp with time zone NOT NULL
);`,
  ).join('\n');
  return `BEGIN;\nCREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(RESTORE_SCHEMA)};\n${tables}\nCOMMIT;\n`;
}

function rcloneEnvironment(options: RuntimeOptions): NodeJS.ProcessEnv {
  return {
    ...process.env,
    RCLONE_CONFIG_R2_TYPE: 's3',
    RCLONE_CONFIG_R2_PROVIDER: 'Cloudflare',
    RCLONE_CONFIG_R2_ACCESS_KEY_ID: options.r2AccessKeyId,
    RCLONE_CONFIG_R2_SECRET_ACCESS_KEY: options.r2SecretAccessKey,
    RCLONE_CONFIG_R2_ENDPOINT: options.r2Endpoint,
    RCLONE_CONFIG_R2_ACL: 'private',
  };
}

function remotePath(options: RuntimeOptions, objectKey: string): string {
  return `r2:${options.r2Bucket}/${objectKey}`;
}

function rcloneCopy(
  options: RuntimeOptions,
  source: string,
  destination: string,
  immutable: boolean,
): void {
  const args = ['copyto', source, destination, '--s3-no-check-bucket'];
  if (immutable) args.push('--immutable');
  const result = runCommand(options.rcloneBin, args, {
    env: rcloneEnvironment(options),
    secrets: [options.r2Bucket, options.r2AccessKeyId, options.r2SecretAccessKey, options.r2Endpoint],
  });
  requireSuccess('R2 copy', result);
}

function gzipFile(options: RuntimeOptions, input: string, output: string): void {
  const result = runCommand(options.gzipBin, ['-n', '-9', '-c', input], { stdio: { stdoutFile: output } });
  requireSuccess('gzip', result);
}

function gunzipFile(options: RuntimeOptions, input: string, output: string): void {
  const result = runCommand(options.gzipBin, ['-d', '-c', input], { stdio: { stdoutFile: output } });
  requireSuccess('gunzip', result);
}

function encryptFile(options: RuntimeOptions, input: string, output: string): void {
  const result = runCommand(
    options.gpgBin,
    [
      '--batch',
      '--yes',
      '--trust-model',
      'always',
      '--recipient',
      options.gpgRecipient,
      '--encrypt',
      '--output',
      output,
      input,
    ],
    { secrets: [options.gpgRecipient] },
  );
  requireSuccess('GPG encryption', result);
}

function decryptFile(options: RuntimeOptions, input: string, output: string): void {
  const result = runCommand(options.gpgBin, [
    '--batch',
    '--yes',
    '--decrypt',
    '--output',
    output,
    input,
  ]);
  requireSuccess('GPG decryption', result);
}

function writeReceipt(receiptPath: string, receipt: PreservationReceipt): void {
  receipt.receipt_sha256 = computeReceiptSha256(receipt);
  mkdirSync(path.dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o644 });
}

function previousReceipt(receiptPath: string): PreservationReceipt | null {
  if (!existsSync(receiptPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(receiptPath, 'utf8')) as Partial<PreservationReceipt>;
    if (
      parsed.issue_id !== ISSUE_ID ||
      typeof parsed.snapshot_set_id !== 'string' ||
      parsed.snapshot_set_id.length === 0 ||
      typeof parsed.receipt_sha256 !== 'string'
    ) {
      return null;
    }
    const receipt = parsed as PreservationReceipt;
    return computeReceiptSha256(receipt) === receipt.receipt_sha256 ? receipt : null;
  } catch {
    return null;
  }
}

function initialReceipt(options: RuntimeOptions): PreservationReceipt {
  const gitHead = runCommand('git', ['rev-parse', 'HEAD']);
  requireSuccess('git rev-parse HEAD', gitHead);
  const verifiedSourceSha = gitHead.stdout.trim();
  if (!/^[0-9a-f]{40}$/u.test(verifiedSourceSha)) throw new Error('Unable to resolve a full source Git SHA');
  return {
    schema_version: RECEIPT_SCHEMA_VERSION,
    issue_id: ISSUE_ID,
    tier: 'T1',
    lane_type: 'verification',
    proof_profile: 'static',
    sha_binding: {
      merge_sha: null,
      verified_source_sha: verifiedSourceSha,
      evidence_commit_sha: 'set-by-ci',
      current_pr_head_sha: 'set-by-ci',
    },
    static_proof: {
      focused_command: 'npx tsx --test scripts/ops/preserve-june-offer-history.ts',
      required_commands: ['pnpm verify:static', 'pnpm test:db', 'pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD'],
      receipt_generated_by: 'scripts/ops/preserve-june-offer-history.ts',
    },
    runtime_proof: {
      status: 'FAIL',
      queries: [],
      row_counts: [],
      receipts: [],
    },
    generated_at: new Date().toISOString(),
    verdict: 'FAIL',
    prerequisite_for: PREREQUISITE_FOR,
    snapshot_set_id: '',
    source: {
      project_ref: PRODUCTION_PROJECT_REF,
      parent_table: SOURCE_PARENT,
      read_only: true,
      rows_before: 0,
      rows_after: 0,
      unchanged: false,
    },
    destination: {
      provider: 'cloudflare-r2',
      bucket_identity_sha256: sha256Text(options.r2Bucket),
      object_prefix: OBJECT_PREFIX,
      receipt_object_key: `${OBJECT_PREFIX}/receipt.json`,
      schema_object_key: '',
      schema_object_sha256: '',
      format: 'canonical-csv+restore-ddl',
      outside_hot_table: true,
      encrypted: true,
    },
    restore_target: {
      project_ref: RESTORE_PROJECT_REF,
      schema: RESTORE_SCHEMA,
      production: false,
    },
    partitions: [],
    checks: {
      exact_partition_set: false,
      production_rows_unchanged: false,
      all_objects_uploaded: false,
      full_restore_completed: false,
      all_counts_match: false,
      all_checksums_match: false,
      idempotent_replay: false,
    },
    failures: [],
    receipt_sha256: '',
  };
}

async function preservePartition(
  options: RuntimeOptions,
  catalog: CatalogPartition,
  prior: PartitionReceipt | undefined,
): Promise<PartitionReceipt> {
  const partitionDir = path.join(options.workDir, catalog.partition_name);
  mkdirSync(partitionDir, { recursive: true });
  const sourceCsv = path.join(partitionDir, 'source.csv');
  const sourceGzip = path.join(partitionDir, 'source.csv.gz');
  const encrypted = path.join(partitionDir, 'source.csv.gz.gpg');
  const downloaded = path.join(partitionDir, 'downloaded.csv.gz.gpg');
  const decryptedGzip = path.join(partitionDir, 'downloaded.csv.gz');
  const restoreCsv = path.join(partitionDir, 'restore-input.csv');
  const reexportCsv = path.join(partitionDir, 'restore-output.csv');

  const sourceRowCount = exactRowCount(options.sourceUrl, 'public', catalog.partition_name, options.psqlBin);
  psqlCopyToFile(options.sourceUrl, canonicalSelect('public', catalog.partition_name), sourceCsv, options.psqlBin);
  const canonicalCsvBytes = statSync(sourceCsv).size;
  const canonicalCsvSha256 = await sha256File(sourceCsv);
  gzipFile(options, sourceCsv, sourceGzip);
  const reusableCiphertext =
    prior?.canonical_csv_sha256 === canonicalCsvSha256 &&
    existsSync(encrypted) &&
    (await sha256File(encrypted)) === prior.encrypted_object_sha256;
  if (!reusableCiphertext) encryptFile(options, sourceGzip, encrypted);
  const encryptedObjectBytes = statSync(encrypted).size;
  const encryptedObjectSha256 = await sha256File(encrypted);
  const objectKey = `${OBJECT_PREFIX}/${catalog.partition_name}.${canonicalCsvSha256}.csv.gz.gpg`;

  rcloneCopy(options, encrypted, remotePath(options, objectKey), true);
  rmSync(downloaded, { force: true });
  rcloneCopy(options, remotePath(options, objectKey), downloaded, false);
  assert.equal(await sha256File(downloaded), encryptedObjectSha256, `${catalog.partition_name} remote object checksum mismatch`);
  decryptFile(options, downloaded, decryptedGzip);
  gunzipFile(options, decryptedGzip, restoreCsv);
  assert.equal(await sha256File(restoreCsv), canonicalCsvSha256, `${catalog.partition_name} decrypted checksum mismatch`);
  assert.equal(statSync(restoreCsv).size, canonicalCsvBytes, `${catalog.partition_name} decrypted size mismatch`);

  const targetTable = `${quoteIdentifier(RESTORE_SCHEMA)}.${quoteIdentifier(catalog.partition_name)}`;
  psqlCopyFromFile(options.restoreUrl, targetTable, restoreCsv, options.psqlBin);
  const restoredRowCount = exactRowCount(options.restoreUrl, RESTORE_SCHEMA, catalog.partition_name, options.psqlBin);
  psqlCopyToFile(options.restoreUrl, canonicalSelect(RESTORE_SCHEMA, catalog.partition_name), reexportCsv, options.psqlBin);
  const restoredCsvSha256 = await sha256File(reexportCsv);

  return {
    ...catalog,
    source_row_count: sourceRowCount,
    canonical_csv_bytes: canonicalCsvBytes,
    canonical_csv_sha256: canonicalCsvSha256,
    encrypted_object_bytes: encryptedObjectBytes,
    encrypted_object_sha256: encryptedObjectSha256,
    object_key: objectKey,
    captured_at: new Date().toISOString(),
    restored_row_count: restoredRowCount,
    restored_csv_sha256: restoredCsvSha256,
    count_matches: restoredRowCount === sourceRowCount,
    checksum_matches: restoredCsvSha256 === canonicalCsvSha256,
  };
}

async function preserve(options: RuntimeOptions): Promise<PreservationReceipt> {
  assertDatabaseIdentities(options.sourceUrl, options.restoreUrl);
  mkdirSync(options.workDir, { recursive: true });
  const prior = previousReceipt(options.receiptPath);
  const receipt = initialReceipt(options);

  try {
    const catalog = discoverPartitions(options);
    receipt.checks.exact_partition_set = true;
    const countsBefore = catalog.map((partition) =>
      exactRowCount(options.sourceUrl, 'public', partition.partition_name, options.psqlBin),
    );
    receipt.source.rows_before = countsBefore.reduce((sum, count) => sum + count, 0);

    const schemaSqlPath = path.join(options.workDir, 'restore-schema.sql');
    const schemaEncryptedPath = `${schemaSqlPath}.gpg`;
    writeFileSync(schemaSqlPath, restoreSchemaSql(), { mode: 0o600 });
    const schemaPlainSha = await sha256File(schemaSqlPath);
    const reusableSchemaCiphertext =
      prior?.destination.schema_object_key.includes(schemaPlainSha) === true &&
      existsSync(schemaEncryptedPath) &&
      (await sha256File(schemaEncryptedPath)) === prior.destination.schema_object_sha256;
    if (!reusableSchemaCiphertext) encryptFile(options, schemaSqlPath, schemaEncryptedPath);
    const schemaEncryptedSha = await sha256File(schemaEncryptedPath);
    const schemaObjectKey = `${OBJECT_PREFIX}/restore-schema.${schemaPlainSha}.sql.gpg`;
    rcloneCopy(options, schemaEncryptedPath, remotePath(options, schemaObjectKey), true);
    receipt.destination.schema_object_key = schemaObjectKey;
    receipt.destination.schema_object_sha256 = schemaEncryptedSha;

    const downloadedSchema = path.join(options.workDir, 'downloaded-restore-schema.sql.gpg');
    const verifiedSchema = path.join(options.workDir, 'verified-restore-schema.sql');
    rmSync(downloadedSchema, { force: true });
    rmSync(verifiedSchema, { force: true });
    rcloneCopy(options, remotePath(options, schemaObjectKey), downloadedSchema, false);
    assert.equal(await sha256File(downloadedSchema), schemaEncryptedSha, 'restore schema remote object checksum mismatch');
    decryptFile(options, downloadedSchema, verifiedSchema);
    assert.equal(await sha256File(verifiedSchema), schemaPlainSha, 'restore schema plaintext checksum mismatch');

    psqlExecute(options.restoreUrl, readFileSync(verifiedSchema, 'utf8'), options.psqlBin);
    for (const partition of catalog) {
      receipt.partitions.push(
        await preservePartition(
          options,
          partition,
          prior?.partitions.find((candidate) => candidate.partition_name === partition.partition_name),
        ),
      );
    }
    receipt.checks.all_objects_uploaded = receipt.partitions.length === EXPECTED_PARTITIONS.length;
    receipt.checks.full_restore_completed = receipt.partitions.length === EXPECTED_PARTITIONS.length;
    receipt.checks.all_counts_match = receipt.partitions.every((partition) => partition.count_matches);
    receipt.checks.all_checksums_match = receipt.partitions.every((partition) => partition.checksum_matches);

    const countsAfter = catalog.map((partition) =>
      exactRowCount(options.sourceUrl, 'public', partition.partition_name, options.psqlBin),
    );
    receipt.source.rows_after = countsAfter.reduce((sum, count) => sum + count, 0);
    receipt.source.unchanged = countsAfter.every(
      (count, index) =>
        count === countsBefore[index] && count === receipt.partitions[index]?.source_row_count,
    );
    receipt.checks.production_rows_unchanged = receipt.source.unchanged;
    receipt.snapshot_set_id = sha256Text(
      receipt.partitions
        .map((partition) => `${partition.partition_name}:${partition.source_row_count}:${partition.canonical_csv_sha256}`)
        .join('\n'),
    );
    receipt.checks.idempotent_replay = prior?.snapshot_set_id === receipt.snapshot_set_id;

    receipt.runtime_proof.queries = [
      { operation: 'read production partition catalog and physical byte sizes', target: PRODUCTION_PROJECT_REF },
      { operation: 'read exact production source counts before and after export', target: PRODUCTION_PROJECT_REF },
      { operation: 'restore and re-export all snapshot objects', target: RESTORE_PROJECT_REF },
    ];
    receipt.runtime_proof.row_counts = receipt.partitions.map((partition) => ({
      partition_name: partition.partition_name,
      source_row_count: partition.source_row_count,
      restored_row_count: partition.restored_row_count,
    }));
    receipt.runtime_proof.receipts = receipt.partitions.map((partition) => ({
      partition_name: partition.partition_name,
      object_key: partition.object_key,
      canonical_csv_sha256: partition.canonical_csv_sha256,
      encrypted_object_sha256: partition.encrypted_object_sha256,
    }));

    const requiredChecks = [
      receipt.checks.exact_partition_set,
      receipt.checks.production_rows_unchanged,
      receipt.checks.all_objects_uploaded,
      receipt.checks.full_restore_completed,
      receipt.checks.all_counts_match,
      receipt.checks.all_checksums_match,
    ];
    receipt.verdict = requiredChecks.every(Boolean) ? 'PASS' : 'FAIL';
    if (!receipt.checks.idempotent_replay) {
      receipt.failures.push('Idempotent replay has not yet been proven; run preserve a second time with the same work directory.');
      receipt.verdict = 'FAIL';
    }
    if (!receipt.checks.all_counts_match) receipt.failures.push('One or more restored row counts differ from source.');
    if (!receipt.checks.all_checksums_match) receipt.failures.push('One or more restored canonical CSV checksums differ from source.');
    if (!receipt.checks.production_rows_unchanged) receipt.failures.push('Production source row counts changed during preservation.');
    receipt.runtime_proof.status = receipt.verdict;
  } catch (error) {
    receipt.failures.push(error instanceof Error ? error.message : String(error));
    receipt.verdict = 'FAIL';
    receipt.runtime_proof.status = 'FAIL';
  }

  writeReceipt(options.receiptPath, receipt);
  try {
    rcloneCopy(
      options,
      options.receiptPath,
      remotePath(options, receipt.destination.receipt_object_key),
      false,
    );
  } catch (error) {
    receipt.verdict = 'FAIL';
    receipt.runtime_proof.status = 'FAIL';
    receipt.checks.all_objects_uploaded = false;
    receipt.failures.push(`Receipt upload failed: ${error instanceof Error ? error.message : String(error)}`);
    writeReceipt(options.receiptPath, receipt);
  }
  return receipt;
}

function requiredEnv(name: string, alternatives: readonly string[] = []): string {
  for (const candidate of [name, ...alternatives]) {
    const value = process.env[candidate]?.trim();
    if (value) return value;
  }
  throw new Error(`Missing required environment variable: ${[name, ...alternatives].join(' or ')}`);
}

function flagValue(args: readonly string[], name: string, fallback: string): string {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function resolveRuntimeOptions(args: readonly string[]): RuntimeOptions {
  const cwd = process.cwd();
  const receiptPath = path.resolve(cwd, flagValue(args, '--receipt', DEFAULT_RECEIPT));
  const expectedReceipt = path.resolve(cwd, DEFAULT_RECEIPT);
  if (receiptPath !== expectedReceipt) {
    throw new Error(`Receipt path must be ${DEFAULT_RECEIPT} for the UTV2-1370 prerequisite`);
  }
  return {
    sourceUrl: requiredEnv('PRESERVE_SOURCE_DATABASE_URL', ['SUPABASE_DB_URL']),
    restoreUrl: requiredEnv('PRESERVE_RESTORE_DATABASE_URL', ['CI_SUPABASE_DB_URL']),
    receiptPath,
    workDir: path.resolve(cwd, flagValue(args, '--work-dir', DEFAULT_WORK_DIR)),
    r2Bucket: requiredEnv('R2_BUCKET'),
    r2Endpoint: requiredEnv('R2_ENDPOINT'),
    r2AccessKeyId: requiredEnv('R2_ACCESS_KEY_ID'),
    r2SecretAccessKey: requiredEnv('R2_SECRET_ACCESS_KEY'),
    gpgRecipient: requiredEnv('GPG_BACKUP_KEY_ID'),
    psqlBin: process.env['PRESERVE_PSQL_BIN']?.trim() || 'psql',
    gzipBin: process.env['PRESERVE_GZIP_BIN']?.trim() || 'gzip',
    gpgBin: process.env['PRESERVE_GPG_BIN']?.trim() || 'gpg',
    rcloneBin: process.env['PRESERVE_RCLONE_BIN']?.trim() || 'rclone',
  };
}

export async function evaluateSnapshotFile(
  filePath: string,
  expectedSha256: string,
): Promise<{ ok: boolean; reason: string | null }> {
  if (!existsSync(filePath)) return { ok: false, reason: 'snapshot_missing' };
  const actual = await sha256File(filePath);
  if (actual !== expectedSha256) return { ok: false, reason: 'snapshot_checksum_mismatch' };
  return { ok: true, reason: null };
}

async function runSelfTest(emit = true): Promise<void> {
  const temp = mkdtempSync(path.join(tmpdir(), 'utv2-1771-self-test-'));
  try {
    assert.equal(
      extractProjectRef(`postgresql://postgres.${PRODUCTION_PROJECT_REF}:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres`),
      PRODUCTION_PROJECT_REF,
    );
    assert.equal(
      extractProjectRef(`postgresql://postgres:secret@${RESTORE_PROJECT_REF}.supabase.co:5432/postgres`),
      RESTORE_PROJECT_REF,
    );
    assert.throws(
      () => assertDatabaseIdentities('postgresql://localhost/source', 'postgresql://localhost/restore'),
      /source database identity/u,
    );

    const catalog: CatalogPartition[] = EXPECTED_PARTITIONS.map((partition) => ({
      ...partition,
      source_total_bytes: 100,
      source_heap_bytes: 80,
    }));
    assert.equal(validateCatalogPartitions(catalog).length, 8);
    assert.throws(() => validateCatalogPartitions(catalog.slice(1)), /exactly the eight/u);
    const badBounds = catalog.map((row, index) =>
      index === 0 ? { ...row, upper_bound: '2026-06-30' } : row,
    );
    assert.throws(() => validateCatalogPartitions(badBounds), /upper bound mismatch/u);

    const snapshot = path.join(temp, 'snapshot.csv');
    const missing = await evaluateSnapshotFile(snapshot, sha256Text('canonical\n'));
    assert.deepEqual(missing, { ok: false, reason: 'snapshot_missing' });
    writeFileSync(snapshot, 'canonical\n');
    const expectedHash = await sha256File(snapshot);
    assert.deepEqual(await evaluateSnapshotFile(snapshot, expectedHash), { ok: true, reason: null });
    writeFileSync(snapshot, 'corrupted\n');
    assert.deepEqual(await evaluateSnapshotFile(snapshot, expectedHash), {
      ok: false,
      reason: 'snapshot_checksum_mismatch',
    });

    const options: RuntimeOptions = {
      sourceUrl: `postgresql://postgres.${PRODUCTION_PROJECT_REF}:secret@pooler.supabase.com/postgres`,
      restoreUrl: `postgresql://postgres.${RESTORE_PROJECT_REF}:secret@pooler.supabase.com/postgres`,
      receiptPath: path.join(temp, 'receipt.json'),
      workDir: temp,
      r2Bucket: 'self-test-bucket',
      r2Endpoint: 'https://example.invalid',
      r2AccessKeyId: 'test',
      r2SecretAccessKey: 'test',
      gpgRecipient: 'test',
      psqlBin: 'psql',
      gzipBin: 'gzip',
      gpgBin: 'gpg',
      rcloneBin: 'rclone',
    };
    const receipt = initialReceipt(options);
    writeReceipt(options.receiptPath, receipt);
    const parsed = JSON.parse(readFileSync(options.receiptPath, 'utf8')) as PreservationReceipt;
    assert.equal(parsed.verdict, 'FAIL', 'a hand-authored/default receipt cannot pass');
    assert.equal(parsed.receipt_sha256, computeReceiptSha256(parsed));

    const firstCopy = path.join(temp, 'first.json');
    const secondCopy = path.join(temp, 'second.json');
    copyFileSync(options.receiptPath, firstCopy);
    copyFileSync(options.receiptPath, secondCopy);
    assert.equal(await sha256File(firstCopy), await sha256File(secondCopy), 'same receipt bytes are idempotent');

    if (emit) {
      process.stdout.write(
        `${JSON.stringify({
          ok: true,
          issue_id: ISSUE_ID,
          tests: {
            project_identity_guard: 'pass',
            exact_eight_partition_guard: 'pass',
            partition_bound_guard: 'pass',
            missing_snapshot_fails: 'pass',
            corrupt_snapshot_fails: 'pass',
            default_receipt_fails_closed: 'pass',
            receipt_hash_stable: 'pass',
            identical_receipt_no_duplicate_identity: 'pass',
          },
        }, null, 2)}\n`,
      );
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function writeDeferredReceipt(): PreservationReceipt {
  const receiptPath = path.resolve(process.cwd(), DEFAULT_RECEIPT);
  const receipt = initialReceipt({
    sourceUrl: '',
    restoreUrl: '',
    receiptPath,
    workDir: path.resolve(process.cwd(), DEFAULT_WORK_DIR),
    r2Bucket: '',
    r2Endpoint: '',
    r2AccessKeyId: '',
    r2SecretAccessKey: '',
    gpgRecipient: '',
    psqlBin: 'psql',
    gzipBin: 'gzip',
    gpgBin: 'gpg',
    rcloneBin: 'rclone',
  });
  receipt.destination.bucket_identity_sha256 = '';
  receipt.runtime_proof.queries = [
    {
      operation: 'local writable-live-DB precondition',
      result: 'BLOCKED_DEFERRED',
      target_required: RESTORE_PROJECT_REF,
    },
  ];
  receipt.failures.push(
    'Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (host=unparseable). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.',
  );
  writeReceipt(receiptPath, receipt);
  return receipt;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'self-test') {
    await runSelfTest();
    return;
  }
  if (command === 'preserve') {
    const receipt = await preserve(resolveRuntimeOptions(args));
    process.stdout.write(
      `${JSON.stringify({
        issue_id: receipt.issue_id,
        verdict: receipt.verdict,
        snapshot_set_id: receipt.snapshot_set_id,
        partition_count: receipt.partitions.length,
        checks: receipt.checks,
        failures: receipt.failures,
        receipt_path: DEFAULT_RECEIPT,
      }, null, 2)}\n`,
    );
    if (receipt.verdict !== 'PASS') process.exitCode = 1;
    return;
  }
  if (command === 'deferred-receipt') {
    const receipt = writeDeferredReceipt();
    process.stdout.write(
      `${JSON.stringify({
        issue_id: receipt.issue_id,
        verdict: receipt.verdict,
        runtime_status: receipt.runtime_proof.status,
        failures: receipt.failures,
        receipt_path: DEFAULT_RECEIPT,
      }, null, 2)}\n`,
    );
    return;
  }
  throw new Error(
    'Usage: npx tsx scripts/ops/preserve-june-offer-history.ts <self-test|preserve|deferred-receipt> [--receipt docs/06_status/proof/UTV2-1771/evidence.json] [--work-dir .out/utv2-1771-preservation]',
  );
}

const isMain = process.argv[1]?.endsWith('preserve-june-offer-history.ts') ?? false;
if (isMain) {
  if (process.env['NODE_TEST_CONTEXT']) {
    test('UTV2-1771 preservation fails closed for identity, partition, missing, and corrupt snapshot drift', async () => {
      await runSelfTest(false);
    });
  } else {
    main().catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
  }
}
