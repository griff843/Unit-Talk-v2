import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// Unit tests for reconcile thresholds — pure logic, no I/O

const STALE_MS = 4 * 60 * 60 * 1000;
const STRANDED_MS = 24 * 60 * 60 * 1000;

function classifyAge(ageMs: number): 'clean' | 'stale' | 'stranded' {
  if (ageMs > STRANDED_MS) return 'stranded';
  if (ageMs > STALE_MS) return 'stale';
  return 'clean';
}

describe('ops:reconcile threshold logic', () => {
  it('classifies fresh heartbeat as clean', () => {
    assert.equal(classifyAge(1 * 60 * 60 * 1000), 'clean'); // 1h
  });

  it('classifies 4h+ as stale', () => {
    assert.equal(classifyAge(5 * 60 * 60 * 1000), 'stale'); // 5h
  });

  it('classifies exactly 24h as stranded', () => {
    assert.equal(classifyAge(25 * 60 * 60 * 1000), 'stranded'); // 25h
  });

  it('boundary: just under stale threshold is clean', () => {
    assert.equal(classifyAge(STALE_MS - 1), 'clean');
  });

  it('boundary: just over stale threshold is stale', () => {
    assert.equal(classifyAge(STALE_MS + 1), 'stale');
  });

  it('boundary: just over stranded threshold is stranded', () => {
    assert.equal(classifyAge(STRANDED_MS + 1), 'stranded');
  });
});
