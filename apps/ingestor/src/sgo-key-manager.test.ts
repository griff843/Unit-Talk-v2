import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSgoKeyResolutionDiagnostic,
  collectConfiguredSgoApiKeyCandidates,
  describeSgoApiKey,
  type SgoApiKeyCandidate,
  type SgoApiKeyProbe,
} from './sgo-key-manager.js';

// UTV2-1272: confirm SGO key candidate generation and the resolution diagnostic
// that prevents "SGO_API_KEY missing" false alarms when keys ARE configured but
// the live probe failed for a cycle.

test('collectConfiguredSgoApiKeyCandidates yields a non-empty masked candidate list from a singular key', () => {
  const candidates = collectConfiguredSgoApiKeyCandidates({
    SGO_API_KEY: 'sk-primary-abcd1234',
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.source, 'SGO_API_KEY');
  // Tag is masked — never the full secret.
  assert.equal(candidates[0]!.tag, 'sk-p...1234');
  assert.notEqual(candidates[0]!.tag, 'sk-primary-abcd1234');
});

test('collectConfiguredSgoApiKeyCandidates folds SGO_API_KEYS, singular, and fallback and dedupes', () => {
  const candidates = collectConfiguredSgoApiKeyCandidates({
    SGO_API_KEYS: ['key-aaaa1111', 'key-bbbb2222'],
    SGO_API_KEY: 'key-aaaa1111', // duplicate of SGO_API_KEYS[0] → deduped
    SGO_API_KEY_FALLBACK: 'key-cccc3333',
  });

  assert.deepEqual(
    candidates.map((c) => c.apiKey),
    ['key-aaaa1111', 'key-bbbb2222', 'key-cccc3333'],
  );
  assert.equal(candidates.length, 3);
});

test('collectConfiguredSgoApiKeyCandidates returns empty when nothing configured', () => {
  assert.deepEqual(collectConfiguredSgoApiKeyCandidates({}), []);
});

test('describeSgoApiKey masks long keys and never returns the raw secret', () => {
  assert.equal(describeSgoApiKey('sk-supersecretkey-9999'), 'sk-s...9999');
  assert.equal(describeSgoApiKey('short'), 'short'); // <= 8 chars: no useful prefix/suffix to mask
});

test('buildSgoKeyResolutionDiagnostic returns null when an active key is resolved', () => {
  const active: SgoApiKeyCandidate = { apiKey: 'key-aaaa1111', source: 'SGO_API_KEY', tag: 'key-...1111' };
  const diagnostic = buildSgoKeyResolutionDiagnostic({ candidateCount: 1, active, probes: [] });
  assert.equal(diagnostic, null);
});

test('buildSgoKeyResolutionDiagnostic flags UNCONFIGURED only when no candidates exist', () => {
  const diagnostic = buildSgoKeyResolutionDiagnostic({ candidateCount: 0, active: null, probes: [] });

  assert.ok(diagnostic);
  assert.equal(diagnostic.healthCode, 'SGO_KEY_UNCONFIGURED');
  assert.equal(diagnostic.sgoKeyCandidateCount, 0);
});

test('buildSgoKeyResolutionDiagnostic flags PROBE_FAILED (not missing) when keys exist but probe fails', () => {
  const probes: SgoApiKeyProbe[] = [
    { source: 'SGO_API_KEY', tag: 'sk-p...1234', status: 'error', reason: 'usage probe timed out' },
  ];

  const diagnostic = buildSgoKeyResolutionDiagnostic({ candidateCount: 1, active: null, probes });

  assert.ok(diagnostic);
  assert.equal(diagnostic.healthCode, 'SGO_KEY_PROBE_FAILED');
  assert.equal(diagnostic.sgoKeyCandidateCount, 1);
  assert.match(diagnostic.message, /not a missing key/);
  // Probe tags are masked; no raw key material is surfaced.
  assert.equal(diagnostic.probes[0]!.tag, 'sk-p...1234');
  assert.equal(JSON.stringify(diagnostic).includes('supersecret'), false);
});
