import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateCapabilityMap, validateCapabilityMapFile } from './capability-map-check.js';

function fixtureRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'utv2-capability-map-'));
  mkdirSync(path.join(root, '.claude', 'agents'), { recursive: true });
  mkdirSync(path.join(root, '.claude', 'commands'), { recursive: true });
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { 'ops:brief': 'tsx scripts/ops-brief.ts', 'ops:truth-check': 'tsx scripts/truth.ts' } }));
  writeFileSync(path.join(root, '.claude', 'agents', 'lane-governor.md'), '# Lane governor\n');
  writeFileSync(path.join(root, '.claude', 'commands', 'verification.md'), '# Verification\n');
  return root;
}

function validMap() {
  return {
    schema_version: 1,
    authority_levels: { authoritative: 'decides', advisory: 'signals' },
    field_contract: { situation: 'trigger', capability: 'primary', kind: 'type', authority: 'level', fallback: 'backup' },
    situations: [
      { situation: 'Start of session', capability: 'pnpm ops:brief', kind: 'command', authority: 'authoritative', fallback: 'lane-governor' },
      { situation: 'Before dispatch', capability: 'lane-governor', kind: 'agent', authority: 'advisory', fallback: 'pnpm ops:brief' },
      { situation: 'Proof review', capability: 'verification', kind: 'skill', authority: 'advisory', fallback: 'pnpm ops:truth-check <ID> --dry-run' },
    ],
  };
}

function withFixture(action: (root: string) => void): void {
  const root = fixtureRoot();
  try {
    action(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('passes a complete map whose commands, agents, skills, and fallback command arguments resolve', () => {
  withFixture((root) => {
    const report = validateCapabilityMap(validMap(), { root });
    assert.equal(report.verdict, 'PASS', JSON.stringify(report.findings));
    assert.equal(report.entries_checked, 3);
  });
});

test('fails closed for a missing map or malformed JSON', () => {
  withFixture((root) => {
    assert.equal(validateCapabilityMapFile({ root }).findings[0]?.code, 'CAPABILITY_MAP_MISSING');
    mkdirSync(path.join(root, 'docs', '05_operations'), { recursive: true });
    writeFileSync(path.join(root, 'docs', '05_operations', 'CAPABILITY_MAP.json'), '{ bad json');
    assert.equal(validateCapabilityMapFile({ root }).findings[0]?.code, 'CAPABILITY_MAP_INVALID_JSON');
  });
});

test('rejects incomplete entries, undeclared authority, and duplicate situations', () => {
  withFixture((root) => {
    const map = validMap();
    map.situations.push({ situation: 'Start of session', capability: '', kind: 'unknown', authority: 'blocking', fallback: '' });
    const codes = validateCapabilityMap(map, { root }).findings.map((finding) => finding.code);
    assert.ok(codes.includes('CAPABILITY_MAP_DUPLICATE_SITUATION'));
    assert.ok(codes.includes('CAPABILITY_MAP_CAPABILITY'));
    assert.ok(codes.includes('CAPABILITY_MAP_KIND'));
    assert.ok(codes.includes('CAPABILITY_MAP_AUTHORITY'));
    assert.ok(codes.includes('CAPABILITY_MAP_FALLBACK'));
  });
});

test('rejects missing primary and fallback references, including an invalid command form', () => {
  withFixture((root) => {
    const map = validMap();
    map.situations[0] = {
      situation: 'Broken route',
      capability: 'pnpm ops:not-real',
      kind: 'command',
      authority: 'advisory',
      fallback: 'not-a-real-agent',
    };
    const codes = validateCapabilityMap(map, { root }).findings.map((finding) => finding.code);
    assert.ok(codes.includes('CAPABILITY_MAP_UNRESOLVED_CAPABILITY'));
    assert.ok(codes.includes('CAPABILITY_MAP_UNRESOLVED_FALLBACK'));
  });
});

test('requires the declared schema surfaces before accepting otherwise valid entries', () => {
  withFixture((root) => {
    const map = validMap();
    delete (map as { schema_version?: number }).schema_version;
    delete (map as { field_contract?: object }).field_contract;
    delete (map as { authority_levels?: object }).authority_levels;
    const codes = validateCapabilityMap(map, { root }).findings.map((finding) => finding.code);
    assert.ok(codes.includes('CAPABILITY_MAP_SCHEMA_VERSION'));
    assert.ok(codes.includes('CAPABILITY_MAP_FIELD_CONTRACT'));
    assert.ok(codes.includes('CAPABILITY_MAP_AUTHORITY_LEVELS'));
  });
});

// Acceptance criterion 2 names these two cases explicitly. They were previously
// proven only by ad-hoc mutation against the real map during review, which is
// evidence that expires the moment nobody repeats it by hand.

test('fallback: null is valid, but an omitted fallback key is not', () => {
  withFixture((root) => {
    const withNull = validMap();
    withNull.situations[0].fallback = null as unknown as string;
    assert.equal(
      validateCapabilityMap(withNull, { root }).verdict,
      'PASS',
      'null means "escalation is the only remaining step" and is a declared state',
    );

    const withoutKey = validMap();
    delete (withoutKey.situations[0] as Record<string, unknown>).fallback;
    const report = validateCapabilityMap(withoutKey, { root });
    assert.equal(report.verdict, 'FAIL', 'an absent key is not the same as an explicit null');
    assert.ok(
      report.findings.some((finding) => finding.code === 'CAPABILITY_MAP_FALLBACK'),
      `expected CAPABILITY_MAP_FALLBACK, got ${JSON.stringify(report.findings)}`,
    );
  });
});

test('both sides of a " / " two-alternative command are resolved', () => {
  withFixture((root) => {
    const bothReal = validMap();
    bothReal.situations[0].capability = 'pnpm ops:brief / pnpm ops:truth-check';
    assert.equal(validateCapabilityMap(bothReal, { root }).verdict, 'PASS');

    // Corrupt only the SECOND alternative: a parser that validates the first
    // token and stops would pass this, which is the whole point of the case.
    const secondBroken = validMap();
    secondBroken.situations[0].capability = 'pnpm ops:brief / pnpm ops:does-not-exist';
    const report = validateCapabilityMap(secondBroken, { root });
    assert.equal(report.verdict, 'FAIL', 'a non-existent second alternative must fail');
    assert.ok(
      report.findings.some((finding) => finding.code === 'CAPABILITY_MAP_UNRESOLVED_CAPABILITY'),
      `expected CAPABILITY_MAP_UNRESOLVED_CAPABILITY, got ${JSON.stringify(report.findings)}`,
    );
  });
});
