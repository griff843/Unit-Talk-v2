import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  buildQuery,
  formatResult,
  parseCliArgs,
  resolveConnectionString,
  sanitizeIdentifier,
} from './lib.js';

test('parseCliArgs defaults to diagnostics text output', () => {
  const args = parseCliArgs([]);
  assert.deepEqual(args, {
    command: 'diagnostics',
    connectionString: undefined,
    format: 'text',
    help: false,
    limit: 25,
    schema: 'public',
    table: undefined,
  });
});

test('parseCliArgs accepts schema command json format and capped limit', () => {
  const args = parseCliArgs(['schema', '--schema', 'analytics', '--format', 'json', '--limit', '999']);
  assert.equal(args.command, 'schema');
  assert.equal(args.schema, 'analytics');
  assert.equal(args.format, 'json');
  assert.equal(args.limit, 200);
});

test('parseCliArgs requires table name for table command', () => {
  assert.throws(() => parseCliArgs(['table']), /requires --table/);
});

test('sanitizeIdentifier rejects unsafe identifiers', () => {
  assert.throws(() => sanitizeIdentifier('public;drop table picks', 'schema'), /Unsafe schema identifier/);
});

test('buildQuery table command escapes literals and includes only read-only introspection', () => {
  const sql = buildQuery({
    command: 'table',
    connectionString: undefined,
    format: 'text',
    help: false,
    limit: 25,
    schema: 'public',
    table: 'picks',
  }).sql;

  assert.match(sql, /information_schema\.columns/);
  assert.match(sql, /pg_indexes/);
  assert.doesNotMatch(sql, /\b(update|delete|insert|alter|drop|truncate)\b/i);
});

test('resolveConnectionString prefers explicit value over env files', () => {
  const resolved = resolveConnectionString('postgres://readonly@localhost/dbname');
  assert.equal(resolved, 'postgres://readonly@localhost/dbname');
});

test('formatResult renders text output with target metadata', () => {
  const text = formatResult(
    {
      command: 'table',
      generatedAt: '2026-05-08T00:00:00.000Z',
      schema: 'public',
      target: 'public.picks',
      payload: {
        relation: 'public.picks',
        columns: [{ name: 'id', type: 'uuid' }],
      },
    },
    'text',
  );

  assert.match(text, /command: table/);
  assert.match(text, /target: public\.picks/);
  assert.match(text, /columns:/);
  assert.match(text, /name: id/);
});
