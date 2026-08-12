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
