import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { assertPostgresConnectionAllowed } from '@unit-talk/db/privileged-client-boundary';

import {
  PRODUCTION_CREDENTIAL_ENV_KEYS,
  WAREHOUSE_ENV_KEYS,
  classifyPresence,
} from './config.js';
import {
  DEFAULT_RETENTION_POLICY,
  decideRetentionEligibility,
} from './conveyor.js';
import { openDuckDb, quote } from './duckdb.js';
import { type ArchiveManifestV1, parseManifest } from './manifest.js';
import {
  type ObjectStore,
  createResearchObjectStoreFromEnv,
  sha256Hex,
} from './object-store.js';

export const RETENTION_DSN_KEYS = {
  plan: 'UNIT_TALK_WAREHOUSE_RETENTION_PLAN_DSN',
  execute: 'UNIT_TALK_WAREHOUSE_RETENTION_EXECUTE_DSN',
  recover: 'UNIT_TALK_WAREHOUSE_RETENTION_RECOVERY_DSN',
} as const;

export type RetentionMode = keyof typeof RETENTION_DSN_KEYS;
export type RetentionSource =
  | 'provider_offer_history'
  | 'raw_payloads'
  | 'odds_snapshots'
  | 'system_runs';

export interface ArchiveEvidence {
  manifest: ArchiveManifestV1;
  manifestSha256: string;
  evidenceCheckedAt: string;
  rows?: Array<Record<string, unknown>>;
}

export interface RetentionDb {
  plan(input: {
    source: RetentionSource;
    date: string;
    evidence: ArchiveEvidence;
    idempotencyKey: string;
    requestedBy: string;
  }): Promise<unknown>;
  execute(input: {
    planId: string;
    manifestSha256: string;
    evidenceCheckedAt: string;
    requestedBy: string;
  }): Promise<unknown>;
  recover(input: {
    executionId: string;
    rows: Array<Record<string, unknown>>;
    evidenceCheckedAt: string;
    requestedBy: string;
  }): Promise<unknown>;
  close(): Promise<void>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function required(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function requireDate(value: string): string {
  if (
    !ISO_DATE.test(value) ||
    Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
  ) {
    throw new Error(
      `date must be an ISO UTC day (YYYY-MM-DD), received ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function requireUuid(value: string, label: string): string {
  if (!UUID.test(value)) throw new Error(`${label} must be a UUID`);
  return value;
}

export function requireSource(value: string): RetentionSource {
  if (
    ![
      'provider_offer_history',
      'raw_payloads',
      'odds_snapshots',
      'system_runs',
    ].includes(value)
  ) {
    throw new Error(
      `${value || '(empty)'} is not in the governed retention allowlist`,
    );
  }
  return value as RetentionSource;
}

export function resolveRetentionDsn(
  mode: RetentionMode,
  env: NodeJS.ProcessEnv,
): string {
  const selected = RETENTION_DSN_KEYS[mode];
  const wrongPhase = Object.values(RETENTION_DSN_KEYS).filter(
    (key) => key !== selected && classifyPresence(env[key]) !== 'missing',
  );
  const broad = [
    WAREHOUSE_ENV_KEYS.accessKeyId,
    WAREHOUSE_ENV_KEYS.secretAccessKey,
    WAREHOUSE_ENV_KEYS.sourceDsn,
    ...PRODUCTION_CREDENTIAL_ENV_KEYS,
  ].filter((key) => classifyPresence(env[key]) !== 'missing');
  if (wrongPhase.length > 0 || broad.length > 0) {
    throw new Error(
      `Refusing retention ${mode}: unexpected credential variables are present: ${[
        ...wrongPhase,
        ...broad,
      ].join(
        ', ',
      )}. Use only the reader key and the phase-specific least-privilege DSN.`,
    );
  }
  return required(env[selected], selected);
}

function policyFor(source: RetentionSource) {
  const entry = DEFAULT_RETENTION_POLICY.find(
    (candidate) => candidate.relation === `public.${source}`,
  );
  if (!entry)
    throw new Error(
      `canonical retention policy has no entry for public.${source}`,
    );
  return entry;
}

export async function verifyRetentionEvidence(input: {
  store: ObjectStore;
  source: RetentionSource;
  date: string;
  now?: Date;
  includeRows?: boolean;
}): Promise<ArchiveEvidence> {
  const date = requireDate(input.date);
  const now = input.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const entry = policyFor(input.source);
  const location = decideRetentionEligibility({
    entry,
    windowDate: date,
    today,
    manifest: null,
  });
  if (!location.manifest_key)
    throw new Error(
      `could not derive the manifest key for ${input.source} ${date}`,
    );

  const manifestBytes = await input.store.get(location.manifest_key);
  if (!manifestBytes)
    throw new Error(`archive manifest is missing: ${location.manifest_key}`);
  const manifest = parseManifest(manifestBytes.toString('utf8'));
  const decision = decideRetentionEligibility({
    entry,
    windowDate: date,
    today,
    manifest,
  });
  if (!decision.eligible) {
    throw new Error(`archive evidence refused: ${decision.reasons.join(', ')}`);
  }

  const objectHead = await input.store.head(manifest.object.data_key);
  const objectBytes = await input.store.get(manifest.object.data_key);
  if (!objectHead || !objectBytes)
    throw new Error(`archive object is missing: ${manifest.object.data_key}`);
  if (
    objectHead.size !== manifest.object.byte_size ||
    objectBytes.byteLength !== manifest.object.byte_size
  ) {
    throw new Error(
      'archive object byte size no longer matches its verified manifest',
    );
  }
  if (sha256Hex(objectBytes) !== manifest.object.checksum_sha256) {
    throw new Error(
      'archive object checksum no longer matches its verified manifest',
    );
  }

  const workDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'unit-talk-retention-'),
  );
  const parquetPath = path.join(workDir, 'verified.parquet');
  const duck = await openDuckDb();
  try {
    fs.writeFileSync(parquetPath, objectBytes);
    const countResult = await duck.all(
      `SELECT count(*) AS row_count FROM read_parquet(${quote(parquetPath)})`,
    );
    const count = Number(countResult[0]?.row_count ?? -1);
    if (
      count !== manifest.source.row_count ||
      count !== manifest.export.exported_row_count
    ) {
      throw new Error(
        `independent archive row count mismatch: parquet=${count} source=${manifest.source.row_count} export=${manifest.export.exported_row_count}`,
      );
    }
    const serializedRows = input.includeRows
      ? await duck.all(
          `SELECT to_json(row_value) AS row_json FROM read_parquet(${quote(parquetPath)}) row_value ORDER BY ALL LIMIT 10001`,
        )
      : undefined;
    const rows = serializedRows?.map((row) => {
      const value = row.row_json;
      if (typeof value === 'string') {
        return JSON.parse(value) as Record<string, unknown>;
      }
      if (value && typeof value === 'object') {
        return value as Record<string, unknown>;
      }
      throw new Error('archive recovery row could not be serialized as JSON');
    });
    if (rows && rows.length !== count) {
      throw new Error(
        `recovery payload is outside the 10000-row bound or incomplete: expected=${count} read=${rows.length}`,
      );
    }
    return {
      manifest,
      manifestSha256: crypto
        .createHash('sha256')
        .update(manifestBytes)
        .digest('hex'),
      evidenceCheckedAt: now.toISOString(),
      rows,
    };
  } finally {
    await duck.close();
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

export function createRetentionDb(dsn: string): RetentionDb {
  assertPostgresConnectionAllowed(dsn, 'warehouse retention phase');
  const one = async (
    query: string,
    variables: Record<string, string>,
  ): Promise<unknown> => {
    const output = await runPsqlScript(
      dsn,
      query,
      variables,
      'warehouse retention phase',
    );
    return JSON.parse(output) as unknown;
  };
  return {
    plan: (input) =>
      one(
        `select public.warehouse_retention_plan_window(
          :'source', :'date'::date, :'manifest_id', :'manifest_key', :'manifest_sha256',
          :'row_count'::bigint, :'verified_at'::timestamptz, :'checked_at'::timestamptz,
          :'object_sha256', :'idempotency_key', :'requested_by'
        )::text`,
        {
          source: input.source,
          date: input.date,
          manifest_id: input.evidence.manifest.manifest_id,
          manifest_key: input.evidence.manifest.object.manifest_key,
          manifest_sha256: input.evidence.manifestSha256,
          row_count: String(input.evidence.manifest.source.row_count),
          verified_at: required(
            input.evidence.manifest.verification.verified_at ?? undefined,
            'manifest verified_at',
          ),
          checked_at: input.evidence.evidenceCheckedAt,
          object_sha256: input.evidence.manifest.object.checksum_sha256,
          idempotency_key: input.idempotencyKey,
          requested_by: input.requestedBy,
        },
      ),
    execute: (input) =>
      one(
        `select public.warehouse_retention_execute_window(
          :'plan_id'::uuid, :'manifest_sha256', :'checked_at'::timestamptz, :'requested_by'
        )::text`,
        {
          plan_id: input.planId,
          manifest_sha256: input.manifestSha256,
          checked_at: input.evidenceCheckedAt,
          requested_by: input.requestedBy,
        },
      ),
    recover: (input) =>
      one(
        `select public.warehouse_retention_recover_window(
          :'execution_id'::uuid, :'rows'::jsonb, :'checked_at'::timestamptz, :'requested_by'
        )::text`,
        {
          execution_id: input.executionId,
          rows: JSON.stringify(input.rows),
          checked_at: input.evidenceCheckedAt,
          requested_by: input.requestedBy,
        },
      ),
    close: async () => undefined,
  };
}

function postgresEnvironment(dsn: string): NodeJS.ProcessEnv {
  const url = new URL(dsn);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error(
      'retention DSN must use the postgres:// or postgresql:// scheme',
    );
  }
  const host = url.hostname;
  return {
    PATH: process.env.PATH,
    PGHOST: host,
    PGPORT: url.port || '5432',
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, '')),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE:
      url.searchParams.get('sslmode') ??
      (['localhost', '127.0.0.1', '::1'].includes(host)
        ? 'disable'
        : 'require'),
    PGCONNECT_TIMEOUT: '15',
  };
}

export async function runPsqlScript(
  dsn: string,
  sql: string,
  variables: Record<string, string> = {},
  purpose = 'warehouse retention staging proof',
): Promise<string> {
  assertPostgresConnectionAllowed(dsn, purpose);
  const args = ['-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1'];
  for (const [key, value] of Object.entries(variables)) {
    if (!/^[a-z][a-z0-9_]*$/.test(key)) {
      throw new Error(`unsafe psql variable name: ${key}`);
    }
    args.push('-v', `${key}=${value}`);
  }
  return new Promise<string>((resolve, reject) => {
    const child = spawn('psql', args, {
      env: postgresEnvironment(dsn),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (stdout += chunk));
    child.stderr.on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (error) =>
      reject(new Error(`psql could not start: ${error.message}`)),
    );
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else
        reject(
          new Error(
            `psql refused the operation (exit ${code}): ${stderr.trim()}`,
          ),
        );
    });
    child.stdin.end(sql);
  });
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    const value = argv[i + 1];
    if (!key || value === undefined)
      throw new Error(`arguments must be --name value pairs`);
    args[key] = value;
  }
  return args;
}

export async function runRetentionCli(
  argv = process.argv.slice(2),
  env = process.env,
): Promise<unknown> {
  const mode = argv.shift() as RetentionMode | undefined;
  if (!mode || !(mode in RETENTION_DSN_KEYS))
    throw new Error('mode must be plan, execute, or recover');
  const args = parseArgs(argv);
  const source = requireSource(required(args.source, '--source'));
  const date = requireDate(required(args.date, '--date'));
  const requestedBy = required(
    args['requested-by'] ?? env.GITHUB_ACTOR ?? env.USER,
    '--requested-by',
  );
  const storeResolution = createResearchObjectStoreFromEnv(env);
  if (!storeResolution.ok) throw new Error(storeResolution.message);
  const dsn = resolveRetentionDsn(mode, env);
  const evidence = await verifyRetentionEvidence({
    store: storeResolution.store,
    source,
    date,
    includeRows: mode === 'recover',
  });
  const db = createRetentionDb(dsn);
  try {
    if (mode === 'plan') {
      return db.plan({
        source,
        date,
        evidence,
        idempotencyKey: required(args['idempotency-key'], '--idempotency-key'),
        requestedBy,
      });
    }
    if (mode === 'execute') {
      return db.execute({
        planId: requireUuid(
          required(args['plan-id'], '--plan-id'),
          '--plan-id',
        ),
        manifestSha256: evidence.manifestSha256,
        evidenceCheckedAt: evidence.evidenceCheckedAt,
        requestedBy,
      });
    }
    return db.recover({
      executionId: requireUuid(
        required(args['execution-id'], '--execution-id'),
        '--execution-id',
      ),
      rows: evidence.rows ?? [],
      evidenceCheckedAt: evidence.evidenceCheckedAt,
      requestedBy,
    });
  } finally {
    await db.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runRetentionCli()
    .then((result) =>
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`),
    )
    .catch((error: unknown) => {
      process.stderr.write(
        `warehouse retention refused: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
