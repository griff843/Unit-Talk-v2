#!/usr/bin/env tsx
/**
 * schema-roundtrip-hash — Emits the SHA-256 hash of the current Postgres public
 * schema DDL so migration reversibility drills can verify a down script returns
 * the schema to a bit-identical prior state.
 *
 * Usage:
 *   tsx scripts/ci/schema-roundtrip-hash.ts [--output <path>] [--json]
 *
 * Requires: SUPABASE_DB_URL or POSTGRES_URL env var (connection string).
 * Exit 0 on success, 1 on error.
 */

import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

function usage(): void {
  process.stderr.write('Usage: tsx scripts/ci/schema-roundtrip-hash.ts [--output <path>] [--json]\n');
}

interface ParsedArgs {
  outputPath: string | null;
  json: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let outputPath: string | null = null;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--output' && argv[i + 1]) {
      outputPath = argv[++i]!;
    } else if (argv[i] === '--json') {
      json = true;
    } else if (argv[i] === '--help') {
      usage();
      process.exit(0);
    }
  }
  return { outputPath, json };
}

function getConnectionString(): string {
  const url = process.env['SUPABASE_DB_URL'] ?? process.env['POSTGRES_URL'];
  if (!url) {
    throw new Error(
      'Missing SUPABASE_DB_URL or POSTGRES_URL environment variable. ' +
      'For a scratch drill, set POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/postgres',
    );
  }
  return url;
}

function dumpPublicSchema(connectionString: string): string {
  // pg_dump with --schema-only --schema=public produces reproducible DDL
  // sorted by object name via --no-owner --no-acl --no-comments.
  const result = execSync(
    `pg_dump "${connectionString}" ` +
    '--schema-only --schema=public ' +
    '--no-owner --no-acl --no-comments ' +
    '--no-publications --no-subscriptions',
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  // Strip header comment (includes timestamp) to make output deterministic.
  return result.replace(/^--.*\n/gm, '').trim();
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

interface HashResult {
  schema_version: 1;
  hash: string;
  byte_length: number;
  captured_at: string;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  let connectionString: string;
  try {
    connectionString = getConnectionString();
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exit(1);
  }

  let ddl: string;
  try {
    ddl = dumpPublicSchema(connectionString);
  } catch (err) {
    process.stderr.write(`pg_dump failed: ${(err as Error).message}\n`);
    process.exit(1);
  }

  const hash = sha256(ddl);
  const result: HashResult = {
    schema_version: 1,
    hash,
    byte_length: Buffer.byteLength(ddl, 'utf8'),
    captured_at: new Date().toISOString(),
  };

  const output = args.json ? JSON.stringify(result, null, 2) : result.hash;

  if (args.outputPath) {
    writeFileSync(args.outputPath, args.json ? output : result.hash + '\n');
  } else {
    process.stdout.write(output + '\n');
  }
}

main();
