import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGateResult,
  classifyFindings,
  extractAffectedTables,
  flattenFindings,
} from './schema-drift-gate.js';

const sampleReport = {
  generated_at: '2026-05-09T00:00:00.000Z',
  expected_label: 'repo-migrations',
  actual_label: 'supabase-live',
  compared_schema: 'public',
  drift_detected: true,
  drift_count: 3,
  diff: {
    relations: {
      missing_in_actual: [],
      missing_in_expected: [],
      changed: [],
    },
    columns: {
      missing_in_actual: [],
      missing_in_expected: [],
      changed: [
        {
          key: 'public.picks.id',
          expected: { formattedType: 'uuid', defaultExpression: null },
          actual: { formattedType: 'uuid', defaultExpression: 'gen_random_uuid()' },
        },
      ],
    },
    constraints: {
      missing_in_actual: [],
      missing_in_expected: [],
      changed: [],
    },
    indexes: {
      missing_in_actual: [],
      missing_in_expected: [
        {
          key: 'public.picks.idx_shadow_only',
          expected: null,
          actual: { definition: 'create index idx_shadow_only on picks(created_at)' },
        },
      ],
      changed: [],
    },
    policies: {
      missing_in_actual: [],
      missing_in_expected: [],
      changed: [],
    },
    triggers: {
      missing_in_actual: [],
      missing_in_expected: [],
      changed: [],
    },
    extensions: {
      missing_in_actual: [],
      missing_in_expected: [
        {
          key: 'extensions.pg_net',
          expected: null,
          actual: { schema: 'extensions', name: 'pg_net', version: '0.12.0' },
        },
      ],
      changed: [],
    },
  },
};

test('flattenFindings expands compare report diffs into individual findings', () => {
  const findings = flattenFindings(sampleReport);

  assert.deepStrictEqual(
    findings.map((finding) => `${finding.collection}:${finding.direction}:${finding.key}`),
    [
      'columns:changed:public.picks.id',
      'indexes:missing_in_expected:public.picks.idx_shadow_only',
      'extensions:missing_in_expected:extensions.pg_net',
    ],
  );
});

test('classifyFindings only allows explicitly allowlisted drift', () => {
  const findings = classifyFindings(flattenFindings(sampleReport), {
    allowedExtensions: new Set(['extensions.pg_net']),
    allowedDriftKeys: new Set(['columns:public.picks.id']),
  });

  const allowed = findings.filter((finding) => finding.allowed);
  const unauthorized = findings.filter((finding) => !finding.allowed);

  assert.deepStrictEqual(
    allowed.map((finding) => `${finding.reason}:${finding.collection}:${finding.key}`),
    [
      'explicit_drift_allowlist:columns:public.picks.id',
      'allowed_extension:extensions:extensions.pg_net',
    ],
  );
  assert.deepStrictEqual(
    unauthorized.map((finding) => `${finding.collection}:${finding.key}`),
    ['indexes:public.picks.idx_shadow_only'],
  );
});

test('extractAffectedTables de-duplicates public tables and ignores extensions', () => {
  const findings = classifyFindings(flattenFindings(sampleReport));

  assert.deepStrictEqual(extractAffectedTables(findings, 'public'), ['picks']);
});

test('buildGateResult reports FAIL when unauthorized drift remains', () => {
  const findings = classifyFindings(flattenFindings(sampleReport), {
    allowedExtensions: new Set(['extensions.pg_net']),
  });
  const result = buildGateResult(
    sampleReport,
    findings,
    {
      expectedDiagnostics: null,
      expectedSchema: null,
      actualDiagnostics: null,
      actualSchema: null,
      actualTables: [],
    },
    {
      reportPath: 'artifacts/schema-parity/live-schema-parity.json',
      artifactDir: 'artifacts/schema-parity',
    },
  );

  assert.strictEqual(result.verdict, 'FAIL');
  assert.strictEqual(result.exit_code, 1);
  assert.strictEqual(result.allowed_count, 1);
  assert.strictEqual(result.unauthorized_count, 2);
});
