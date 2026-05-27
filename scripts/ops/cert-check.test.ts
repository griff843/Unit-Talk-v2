import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateCertificationReadiness,
  parseCertCheckArgs,
} from './cert-check.js';
import type {
  CertificationDomain,
  CertificationRecord,
  ProgramId,
} from '../../packages/invariants/src/index.js';

const NOW = '2026-05-26T12:00:00.000Z';

function makeRecord(domain: CertificationDomain): CertificationRecord {
  return {
    id: `cert-${domain}`,
    programId: 'P1',
    domain,
    status: 'active',
    evidenceSha: 'a'.repeat(64),
    mergeSha: 'b'.repeat(40),
    transitionedAt: NOW,
    transitionedBy: 'test',
    transitionReason: 'test',
    expiresAt: null,
    revocationTrigger: null,
    predecessorId: null,
    createdAt: NOW,
  };
}

test('parseCertCheckArgs treats --json without --program as P1', () => {
  assert.deepEqual(parseCertCheckArgs(['--json']), {
    jsonMode: true,
    programId: 'P1',
  });
});

test('parseCertCheckArgs reads --program value independently of --json order', () => {
  assert.deepEqual(parseCertCheckArgs(['--json', '--program', 'P2']), {
    jsonMode: true,
    programId: 'P2' as ProgramId,
  });
});

test('evaluateCertificationReadiness fails closed when Program 1 domains are absent', () => {
  const readiness = evaluateCertificationReadiness('P1', {}, NOW);
  assert.equal(readiness.allCertified, false);
  assert.equal(readiness.blockers.length, 7);
});

test('evaluateCertificationReadiness passes only when all domains are active and dependencies hold', () => {
  const domains: CertificationDomain[] = [
    'replay',
    'invariant',
    'divergence',
    'quarantine',
    'proof_lineage',
    'freshness',
    'cert_evidence',
  ];
  const records: Partial<Record<CertificationDomain, CertificationRecord>> = {};
  for (const domain of domains) {
    records[domain] = makeRecord(domain);
  }

  const readiness = evaluateCertificationReadiness('P1', records, NOW);
  assert.equal(readiness.allCertified, true);
  assert.deepEqual(readiness.blockers, []);
});
