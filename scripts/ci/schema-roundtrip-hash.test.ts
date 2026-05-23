import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizePgDumpSchemaDump } from './schema-roundtrip-hash.js';

test('normalizePgDumpSchemaDump removes volatile pg_dump restrict guards', () => {
  const left = normalizePgDumpSchemaDump(`
-- PostgreSQL database dump
\\restrict abc123

CREATE TABLE public.example (
    id uuid NOT NULL
);

\\unrestrict abc123
`);

  const right = normalizePgDumpSchemaDump(`
-- PostgreSQL database dump
\\restrict zyx987

CREATE TABLE public.example (
    id uuid NOT NULL
);

\\unrestrict zyx987
`);

  assert.equal(left, right);
  assert.equal(
    left,
    'CREATE TABLE public.example (\n    id uuid NOT NULL\n);',
  );
});
