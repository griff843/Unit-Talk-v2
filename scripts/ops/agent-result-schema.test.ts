import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildAgentResult, isAgentResult, type AgentResult } from './agent-result-schema.js';

const validResult: AgentResult = {
  schema_version: 1,
  agent: 'runtime-verifier',
  verdict: 'PASS',
  issueId: 'UTV2-1007',
  sha: 'abc123',
  generatedAt: '2026-05-17T12:00:00.000Z',
  failures: [],
  warnings: [],
  evidenceRefs: [
    {
      path: 'scripts/ops/agent-result-schema.ts',
      sha: 'abc123',
      description: 'Canonical schema file',
    },
  ],
};

test('isAgentResult returns true for a valid AgentResult object', () => {
  assert.equal(isAgentResult(validResult), true);
});

test('isAgentResult returns false for missing required fields', () => {
  const requiredFields = [
    'schema_version',
    'agent',
    'verdict',
    'failures',
    'warnings',
    'evidenceRefs',
    'generatedAt',
  ] as const;

  for (const field of requiredFields) {
    const candidate: Record<string, unknown> = { ...validResult };
    delete candidate[field];
    assert.equal(isAgentResult(candidate), false, `${field} should be required`);
  }
});

test('buildAgentResult produces a valid AgentResult', () => {
  const result = buildAgentResult('proof-auditor', 'PASS', {
    issueId: 'UTV2-1007',
    sha: 'def456',
    warnings: ['non-blocking warning'],
    evidenceRefs: [{ path: 'proof.json', sha: 'def456' }],
    detail: { checked: true },
  });

  assert.equal(isAgentResult(result), true);
  assert.equal(result.agent, 'proof-auditor');
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.issueId, 'UTV2-1007');
  assert.equal(result.sha, 'def456');
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.warnings, ['non-blocking warning']);
  assert.deepEqual(result.evidenceRefs, [{ path: 'proof.json', sha: 'def456' }]);
  assert.deepEqual(result.detail, { checked: true });
});

test('buildAgentResult with FAIL verdict has correct shape', () => {
  const result = buildAgentResult('lane-reconciler', 'FAIL', {
    failures: ['lane manifest missing'],
    evidenceRefs: [{ path: 'lane.json', sha: null, description: 'Missing lane evidence' }],
  });

  assert.equal(isAgentResult(result), true);
  assert.equal(result.verdict, 'FAIL');
  assert.deepEqual(result.failures, ['lane manifest missing']);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.evidenceRefs, [
    { path: 'lane.json', sha: null, description: 'Missing lane evidence' },
  ]);
});

test('schema_version is always 1', () => {
  for (const verdict of ['PASS', 'FAIL', 'WARN', 'SKIP'] as const) {
    assert.equal(buildAgentResult('runtime-verifier', verdict).schema_version, 1);
  }
});

test('generatedAt is a valid ISO-8601 string', () => {
  const result = buildAgentResult('runtime-verifier', 'PASS');

  assert.match(result.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(new Date(result.generatedAt).toISOString(), result.generatedAt);
});

test('evidenceRefs is always an array', () => {
  const defaultResult = buildAgentResult('runtime-verifier', 'PASS');
  const populatedResult = buildAgentResult('runtime-verifier', 'WARN', {
    evidenceRefs: [{ path: 'evidence.json', sha: null }],
  });

  assert.equal(Array.isArray(defaultResult.evidenceRefs), true);
  assert.equal(Array.isArray(populatedResult.evidenceRefs), true);
});
