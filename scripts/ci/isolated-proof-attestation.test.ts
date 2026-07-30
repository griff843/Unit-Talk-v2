import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ATTESTATION_MARKER,
  buildIsolatedProofAttestation,
  CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF,
  extractProjectRefFromUrl,
  formatAttestationLine,
  parseAttestations,
  verifyIsolatedProofEvidence,
} from './isolated-proof-attestation.js';
import { requiresIsolatedTargetAttestation } from '../ops/proof-auditor-gate.js';

const ISOLATED_REF = 'wgfgqfxnnwjmrbubqhcj';
const ISOLATED_URL = `https://${ISOLATED_REF}.supabase.co`;
const PRODUCTION_URL = `https://${CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`;
const TAP = '# pass 7\n# fail 0\n# skipped 0';

function proofFor(url: string, command = 'pnpm test:db'): string {
  return [
    '## Verification',
    `Ran \`${command}\` against the isolated target.`,
    formatAttestationLine(buildIsolatedProofAttestation(url, command)),
    TAP,
  ].join('\n');
}

// --- host-structure extraction -------------------------------------------

test('extracts the project ref from the leftmost label of a Supabase host', () => {
  assert.equal(extractProjectRefFromUrl(ISOLATED_URL).projectRef, ISOLATED_REF);
});

test('decodes percent-encoding so a disguised production host is recognized', () => {
  // %6d is 'm' — this is a live, working production URL.
  const disguised = 'https://zfzdnfwdarxucxtaojx%6d.supabase.co';
  assert.equal(
    extractProjectRefFromUrl(disguised).projectRef,
    CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF,
  );
});

for (const [label, url] of [
  ['custom domain', 'https://db.unit-talk.com'],
  ['pooler host', 'https://aws-0-us-east-1.pooler.supabase.com'],
  ['loopback tunnel', 'http://127.0.0.1:54321'],
  ['multi-label supabase host', 'https://a.b.supabase.co'],
  ['20-char run on a foreign host', 'https://abcdefghijklmnopqrst.evil.example'],
  ['unparseable', 'not-a-url'],
] as const) {
  test(`yields no project ref for ${label} — identity is not determinable`, () => {
    assert.equal(extractProjectRefFromUrl(url).projectRef, null);
  });
}

// --- verdicts -------------------------------------------------------------

test('accepts a proof attested against the isolated project', () => {
  const verdict = verifyIsolatedProofEvidence(proofFor(ISOLATED_URL), 'pnpm test:db');
  assert.equal(verdict.ok, true, verdict.reason);
  assert.match(verdict.reason, new RegExp(ISOLATED_REF));
});

test('REJECTS a proof attested against canonical production', () => {
  const verdict = verifyIsolatedProofEvidence(proofFor(PRODUCTION_URL), 'pnpm test:db');
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /canonical production/);
});

test('rejects a proof carrying TAP but no attestation at all', () => {
  const bare = ['## Verification', 'Ran `pnpm test:db`.', TAP].join('\n');
  const verdict = verifyIsolatedProofEvidence(bare, 'pnpm test:db');
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /no isolated-db-proof-attestation/);
});

for (const [label, url] of [
  ['custom domain', 'https://db.unit-talk.com'],
  ['pooler', 'https://aws-0-us-east-1.pooler.supabase.com'],
  ['tunnel', 'http://127.0.0.1:54321'],
] as const) {
  test(`rejects an unidentifiable target (${label}) — may front production`, () => {
    const verdict = verifyIsolatedProofEvidence(proofFor(url), 'pnpm test:db');
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /could not identify a Supabase project ref/);
  });
}

test('does not trust the attestation’s own canonicalProduction claim', () => {
  // A hand-edited receipt that names production but claims it is not.
  const forged = [
    '## Verification',
    'Ran `pnpm test:db`.',
    `[${ATTESTATION_MARKER}] ${JSON.stringify({
      schema: ATTESTATION_MARKER,
      observedProjectRef: CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF,
      targetHost: `${CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`,
      canonicalProduction: false, // <- lie
      command: 'pnpm test:db',
    })}`,
    TAP,
  ].join('\n');
  const verdict = verifyIsolatedProofEvidence(forged, 'pnpm test:db');
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /canonical production/);
});

test('an attestation for a different command does not satisfy this one', () => {
  const other = proofFor(ISOLATED_URL, 'pnpm test:live-db');
  const verdict = verifyIsolatedProofEvidence(other, 'pnpm test:db');
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /no isolated-db-proof-attestation/);
});

test('a malformed attestation does not count as a valid one', () => {
  const broken = ['## Verification', `[${ATTESTATION_MARKER}] {not json`, TAP].join('\n');
  assert.deepEqual(parseAttestations(broken), []);
  assert.equal(verifyIsolatedProofEvidence(broken, 'pnpm test:db').ok, false);
});

// --- gate scoping ---------------------------------------------------------

test('DB commands require an isolated attestation; non-DB commands do not', () => {
  for (const command of ['pnpm test:db', 'pnpm test:live-db', 'pnpm test:t1-proof:live', 'pnpm ci:db-smoke']) {
    assert.equal(requiresIsolatedTargetAttestation(command), true, command);
  }
  for (const command of ['pnpm test', 'pnpm verify:static', 'pnpm type-check']) {
    assert.equal(requiresIsolatedTargetAttestation(command), false, command);
  }
});
