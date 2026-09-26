#!/usr/bin/env tsx
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  describeConfig,
  formatRedactedJson,
  redactMessage,
  renderDoctorSummary,
  resolveSourceDsn,
} from './config.js';
import { openDuckDb } from './duckdb.js';
import {
  CONVEYOR_HEARTBEAT_KEY,
  DEFAULT_RETENTION_POLICY,
  planConveyorRun,
  readStaleness,
  runConveyor,
  type RetentionPolicyEntry,
} from './conveyor.js';
import { assertSourceNotRowFiltered, attachPostgres, qualifyAttached } from './export-partition.js';
import { createObjectStoreFromEnv, createResearchObjectStoreFromEnv } from './object-store.js';
import { BACKFILL_SOURCES, isPruneHeldRelation, planBackfill, runBackfill } from './backfill.js';
import { REPRESENTATIVE_QUERY, runWarehouseQuery } from './query.js';
import { assessArchiveCandidate, runDbAudit, type SqlRunner } from './db-audit.js';
import { decidePrune } from './verify-archive.js';
import { parseManifest } from './manifest.js';

/**
 * Operator entry point for the historical-data warehouse.
 *
 * Every subcommand prints one JSON document and exits non-zero on failure, so a
 * scheduled run, a CI step and an operator at a terminal all read the same
 * thing. No subcommand prints a secret: every JSON document and log event goes
 * through `formatRedactedJson`, and error text through `redactMessage`, before
 * it reaches stdout or stderr. Both fail closed to fixed text.
 *
 * There is no `prune` subcommand, and adding one is a separate, PM-gated
 * decision. This lane archives and verifies; it does not delete.
 */

const USAGE = `unit-talk warehouse

  doctor    [--research]          Report configuration presence (never values)
  plan      [--policy <file>] [--today YYYY-MM-DD] [--window-date YYYY-MM-DD]
  conveyor  [--policy <file>] [--today YYYY-MM-DD] [--window-date YYYY-MM-DD] [--dry-run]
  backfill  --source ${Object.keys(BACKFILL_SOURCES).join('|')}
            --from YYYY-MM-DD --to YYYY-MM-DD [--max-windows N] [--today YYYY-MM-DD] [--dry-run]
  staleness [--max-age-hours N]   Read the conveyor heartbeat from the bucket
  query     --prefix <p> [--sql <file>]   Reader key only; refuses beside the writer
  verify    --manifest <key>      Re-decide prune eligibility from a stored manifest
  audit     [--rules <file>] [--top N]
  candidate --relation <schema.relation> [--time-column <col>]

Configuration is read from the environment; see
docs/05_operations/WAREHOUSE_OBJECT_STORAGE_PROVISIONING.md.
`;

interface Args {
  command: string;
  flags: Map<string, string>;
  bools: Set<string>;
}

function parseArgs(argv: string[]): Args {
  const [command = 'help', ...rest] = argv;
  const flags = new Map<string, string>();
  const bools = new Set<string>();
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) continue;
    const name = token.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) {
      bools.add(name);
    } else {
      flags.set(name, next);
      i += 1;
    }
  }
  return { command, flags, bools };
}

function emit(value: unknown): void {
  process.stdout.write(`${formatRedactedJson(value, 2)}\n`);
}

/** The log sink handed to the conveyor and the backfill: one redacted line per event. */
function logEvent(event: Record<string, unknown>): void {
  process.stdout.write(`${formatRedactedJson(event)}\n`);
}

function repoSha(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return process.env.GITHUB_SHA?.trim() ?? 'unknown';
  }
}

function loadJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8')) as T;
}

function requireFlag(args: Args, name: string): string {
  const value = args.flags.get(name);
  if (!value) {
    throw new Error(`--${name} is required. Run \`warehouse help\` for the full invocation.`);
  }
  return value;
}

/**
 * The policy file is optional. Omitting it runs `DEFAULT_RETENTION_POLICY`,
 * which is the policy the scheduled workflow is meant to run; a file is for a
 * one-off backfill of something the schedule does not cover.
 */
function loadPolicy(args: Args): RetentionPolicyEntry[] {
  const file = args.flags.get('policy');
  return file ? loadJsonFile<RetentionPolicyEntry[]>(file) : DEFAULT_RETENTION_POLICY;
}

/**
 * Every required flag checked at once, so a missing-argument failure names the
 * whole corrected invocation rather than one flag per attempt.
 */
function requireFlags(args: Args, names: string[], invocation: string): Map<string, string> {
  const missing = names.filter((name) => !args.flags.get(name));
  if (missing.length > 0) {
    throw new Error(
      `${missing.map((name) => `--${name}`).join(', ')} ${missing.length === 1 ? 'is' : 'are'} required. ` +
        `Full invocation: ${invocation}`,
    );
  }
  return new Map(names.map((name) => [name, args.flags.get(name)!]));
}

function parseMaxWindows(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) {
    throw new Error(`--max-windows must be a positive integer; received ${JSON.stringify(value)}`);
  }
  return Number(value);
}

function requireStore(): ReturnType<typeof createObjectStoreFromEnv> & { ok: true } {
  const resolved = createObjectStoreFromEnv();
  if (!resolved.ok) {
    throw new Error(resolved.message);
  }
  return resolved;
}

/** DuckDB-backed SQL runner over the attached operational database. */
async function withPostgres<T>(
  run: (query: SqlRunner) => Promise<T>,
): Promise<T> {
  const dsn = resolveSourceDsn();
  if (!dsn.ok) {
    throw new Error(dsn.message);
  }
  const connection = await openDuckDb();
  const attached = await attachPostgres(connection, dsn.config.dsn);
  try {
    const query: SqlRunner = async (sql) => {
      // DuckDB's postgres extension forwards an arbitrary statement to the
      // server through postgres_query. Everything passed here originates in
      // db-audit.ts's constants.
      const escaped = sql.replaceAll("'", "''");
      return connection.all(`SELECT * FROM postgres_query('src', '${escaped}')`);
    };
    return await run(query);
  } finally {
    await attached.detach();
    await connection.close();
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case 'doctor': {
      const description = describeConfig();
      emit({ command: 'doctor', ...description });
      const summaryPath = process.env.GITHUB_STEP_SUMMARY;
      if (summaryPath) {
        fs.appendFileSync(summaryPath, renderDoctorSummary(description));
      }
      if (args.bools.has('research')) {
        // The reader's question, not the conveyor's: can a research command
        // start here? Names of any refusing credential, never their values.
        if (!description.research_ready) {
          const reason =
            description.research_forbidden_present.length > 0
              ? `refused beside ${description.research_forbidden_present.join(', ')}`
              : 'the reader key does not resolve';
          process.stderr.write(`warehouse research: not ready -- ${reason}\n`);
        }
        return description.research_ready ? 0 : 1;
      }
      if (description.archive_state !== 'ready') {
        process.stderr.write(`warehouse archive: ${description.archive_state} -- nothing was archived\n`);
      }
      return description.archive_state === 'ready' ? 0 : 1;
    }

    case 'plan': {
      const policy = loadPolicy(args);
      const plan = planConveyorRun({
        policy,
        today: args.flags.get('today') ?? new Date().toISOString().slice(0, 10),
        windowDate: args.flags.get('window-date'),
      });
      emit({ command: 'plan', ...plan });
      return 0;
    }

    case 'conveyor': {
      const policy = loadPolicy(args);
      const plan = planConveyorRun({
        policy,
        today: args.flags.get('today') ?? new Date().toISOString().slice(0, 10),
        windowDate: args.flags.get('window-date'),
      });
      if (args.bools.has('dry-run')) {
        emit({ command: 'conveyor', dry_run: true, ...plan });
        return 0;
      }

      const store = requireStore().store;
      const dsn = resolveSourceDsn();
      if (!dsn.ok) {
        throw new Error(dsn.message);
      }
      const connection = await openDuckDb();
      const attached = await attachPostgres(connection, dsn.config.dsn);
      try {
        for (const relation of new Set(plan.items.map((item) => item.relation))) {
          await assertSourceNotRowFiltered(connection, 'src', relation);
        }
        const result = await runConveyor({
          plan,
          connection,
          store,
          relationExpr: (item) => qualifyAttached('src', item.relation),
          exporterRepoSha: repoSha(),
          log: logEvent,
        });
        emit({ command: 'conveyor', ...result });
        return result.ok ? 0 : 1;
      } finally {
        await attached.detach();
        await connection.close();
      }
    }

    case 'backfill': {
      const flags = requireFlags(
        args,
        ['source', 'from', 'to'],
        `warehouse backfill --source ${Object.keys(BACKFILL_SOURCES).join('|')} --from YYYY-MM-DD --to YYYY-MM-DD [--max-windows N] [--dry-run]`,
      );
      const plan = planBackfill({
        source: flags.get('source')!,
        from: flags.get('from')!,
        to: flags.get('to')!,
        today: args.flags.get('today') ?? new Date().toISOString().slice(0, 10),
        maxWindows: parseMaxWindows(args.flags.get('max-windows')),
      });
      const planned = {
        source: plan.source,
        relation: plan.relation,
        from: plan.from,
        to: plan.to,
        run_date: plan.run_date,
        prune_hold: plan.prune_hold,
        ledger_key: plan.ledger_key,
        windows: plan.windows.map((window) => ({
          date: window.date,
          data_key: window.data_key,
          manifest_key: window.manifest_key,
        })),
      };
      if (args.bools.has('dry-run')) {
        // Plan only. No store is resolved and no source is attached, so a dry
        // run cannot write a ledger, a manifest or an object.
        emit({ command: 'backfill', dry_run: true, ...planned });
        return 0;
      }

      const store = requireStore().store;
      const dsn = resolveSourceDsn();
      if (!dsn.ok) {
        throw new Error(dsn.message);
      }
      const connection = await openDuckDb();
      const attached = await attachPostgres(connection, dsn.config.dsn);
      try {
        await assertSourceNotRowFiltered(connection, 'src', plan.relation);
        const result = await runBackfill({
          plan,
          connection,
          store,
          relationExpr: (item) => qualifyAttached('src', item.relation),
          exporterRepoSha: repoSha(),
          log: logEvent,
        });
        emit({ command: 'backfill', ...result });
        return result.ok ? 0 : 1;
      } finally {
        await attached.detach();
        await connection.close();
      }
    }

    case 'staleness': {
      const store = requireStore().store;
      const verdict = await readStaleness(store, {
        maxAgeHours: Number(args.flags.get('max-age-hours') ?? 36),
      });
      emit({ command: 'staleness', heartbeat_key: CONVEYOR_HEARTBEAT_KEY, ...verdict });
      return verdict.stale ? 1 : 0;
    }

    case 'query': {
      // The reader key only. With the writer or a production credential in
      // this environment, this refuses before anything is opened.
      const resolved = createResearchObjectStoreFromEnv();
      if (!resolved.ok) {
        throw new Error(resolved.message);
      }
      const store = resolved.store;
      const sqlFile = args.flags.get('sql');
      const result = await runWarehouseQuery({
        store,
        prefix: requireFlag(args, 'prefix'),
        sql: sqlFile ? fs.readFileSync(path.resolve(sqlFile), 'utf8') : REPRESENTATIVE_QUERY,
      });
      emit({ command: 'query', ...result });
      return 0;
    }

    case 'verify': {
      const store = requireStore().store;
      const key = requireFlag(args, 'manifest');
      const body = await store.get(key);
      if (body === null) {
        throw new Error(`no manifest object at ${key}`);
      }
      const manifest = parseManifest(body.toString('utf8'));
      const decision = decidePrune(manifest);
      // A verified manifest for a held source still reports not eligible: the
      // hold is policy, and no manifest can lift it. The exit code reports the
      // verification, which the hold does not change.
      const held = isPruneHeldRelation(manifest.source.relation);
      emit({
        command: 'verify',
        manifest_key: key,
        ...decision,
        verified: decision.eligible,
        prune_hold: held,
        eligible: decision.eligible && !held,
        reasons: held ? [...decision.reasons, 'prune_hold'] : decision.reasons,
      });
      return decision.eligible ? 0 : 1;
    }

    case 'audit': {
      const rulesFile = args.flags.get('rules');
      const report = await withPostgres((query) =>
        runDbAudit({
          query,
          rules: rulesFile ? loadJsonFile(rulesFile) : [],
          topRelations: Number(args.flags.get('top') ?? 40),
        }),
      );
      emit({ command: 'audit', ...report });
      return 0;
    }

    case 'candidate': {
      const relation = requireFlag(args, 'relation');
      const [schema, name] = relation.includes('.') ? relation.split('.') : ['public', relation];
      const assessment = await withPostgres((query) =>
        assessArchiveCandidate({
          query,
          schema,
          relation: name,
          timeColumn: args.flags.get('time-column'),
        }),
      );
      emit({ command: 'candidate', ...assessment });
      return 0;
    }

    case 'help':
    default:
      process.stdout.write(USAGE);
      return args.command === 'help' ? 0 : 1;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${redactMessage(message)}\n`);
    process.exitCode = 1;
  });
