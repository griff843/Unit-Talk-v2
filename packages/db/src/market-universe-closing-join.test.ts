import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// UTV2-727: Join behavior tests for closing-line evidence logic.
// Logic inlined from scripts/sgo-r5-replay-readiness.ts — do NOT import from there.

interface MarketUniverseRow {
  provider_key: string;
  provider_event_id: string;
  provider_market_key: string;
  provider_participant_id: string | null;
  opening_line: number | null;
  opening_over_odds: number | null;
  opening_under_odds: number | null;
  closing_line: number | null;
  closing_over_odds: number | null;
  closing_under_odds: number | null;
}

interface MarketEvidence {
  opening: boolean;
  closing: boolean;
}

function naturalKey(row: Pick<
  MarketUniverseRow,
  'provider_key' | 'provider_event_id' | 'provider_participant_id' | 'provider_market_key'
>): string {
  return [
    row.provider_key,
    row.provider_event_id,
    row.provider_participant_id ?? '',
    row.provider_market_key,
  ].join('|');
}

function hasClosing(
  row: MarketUniverseRow | undefined,
  evidence: Map<string, MarketEvidence>,
): boolean {
  return Boolean(
    row &&
      ((row.closing_line !== null &&
        row.closing_over_odds !== null &&
        row.closing_under_odds !== null) ||
        evidence.get(naturalKey(row))?.closing),
  );
}

function hasOpening(
  row: MarketUniverseRow | undefined,
  evidence: Map<string, MarketEvidence>,
): boolean {
  return Boolean(
    row &&
      ((row.opening_line !== null &&
        row.opening_over_odds !== null &&
        row.opening_under_odds !== null) ||
        evidence.get(naturalKey(row))?.opening),
  );
}

const BASE_ROW: MarketUniverseRow = {
  provider_key: 'sgo',
  provider_event_id: 'evt-001',
  provider_market_key: 'player_points',
  provider_participant_id: 'player-42',
  opening_line: null,
  opening_over_odds: null,
  opening_under_odds: null,
  closing_line: null,
  closing_over_odds: null,
  closing_under_odds: null,
};

describe('hasClosing — market_universe fields', () => {
  it('returns true when all three closing fields are non-null', () => {
    const row = { ...BASE_ROW, closing_line: 24.5, closing_over_odds: -110, closing_under_odds: -110 };
    assert.equal(hasClosing(row, new Map()), true);
  });

  it('returns false when closing_line is null', () => {
    const row = { ...BASE_ROW, closing_line: null, closing_over_odds: -110, closing_under_odds: -110 };
    assert.equal(hasClosing(row, new Map()), false);
  });

  it('returns false when closing_over_odds is null', () => {
    const row = { ...BASE_ROW, closing_line: 24.5, closing_over_odds: null, closing_under_odds: -110 };
    assert.equal(hasClosing(row, new Map()), false);
  });

  it('returns false when closing_under_odds is null', () => {
    const row = { ...BASE_ROW, closing_line: 24.5, closing_over_odds: -110, closing_under_odds: null };
    assert.equal(hasClosing(row, new Map()), false);
  });

  it('returns false when all closing fields are null', () => {
    assert.equal(hasClosing(BASE_ROW, new Map()), false);
  });

  it('returns false when row is undefined', () => {
    assert.equal(hasClosing(undefined, new Map()), false);
  });
});

describe('hasClosing — provider_offer evidence map', () => {
  it('returns true when evidence map has closing=true for the natural key', () => {
    const key = naturalKey(BASE_ROW);
    const evidence = new Map([[key, { opening: false, closing: true }]]);
    assert.equal(hasClosing(BASE_ROW, evidence), true);
  });

  it('returns false when evidence map has closing=false for the natural key', () => {
    const key = naturalKey(BASE_ROW);
    const evidence = new Map([[key, { opening: true, closing: false }]]);
    assert.equal(hasClosing(BASE_ROW, evidence), false);
  });

  it('returns false when evidence map has no entry for the natural key', () => {
    const evidence = new Map([['different|key|x|y', { opening: true, closing: true }]]);
    assert.equal(hasClosing(BASE_ROW, evidence), false);
  });

  it('market_universe closing fields take precedence over missing evidence entry', () => {
    const row = { ...BASE_ROW, closing_line: 24.5, closing_over_odds: -110, closing_under_odds: -110 };
    assert.equal(hasClosing(row, new Map()), true);
  });
});

describe('hasOpening — market_universe fields', () => {
  it('returns true when all three opening fields are non-null', () => {
    const row = { ...BASE_ROW, opening_line: 24.5, opening_over_odds: -110, opening_under_odds: -110 };
    assert.equal(hasOpening(row, new Map()), true);
  });

  it('returns false when any opening field is null', () => {
    const row = { ...BASE_ROW, opening_line: null, opening_over_odds: -110, opening_under_odds: -110 };
    assert.equal(hasOpening(row, new Map()), false);
  });
});

describe('naturalKey construction', () => {
  it('uses provider_participant_id when present', () => {
    const key = naturalKey({ ...BASE_ROW, provider_participant_id: 'player-99' });
    assert.equal(key, 'sgo|evt-001|player-99|player_points');
  });

  it('converts null provider_participant_id to empty string', () => {
    const key = naturalKey({ ...BASE_ROW, provider_participant_id: null });
    assert.equal(key, 'sgo|evt-001||player_points');
  });

  it('two markets with null participant produce the same key when other fields match', () => {
    const a = naturalKey({ ...BASE_ROW, provider_participant_id: null });
    const b = naturalKey({ ...BASE_ROW, provider_participant_id: null });
    assert.equal(a, b);
  });

  it('two markets with different participants produce different keys', () => {
    const a = naturalKey({ ...BASE_ROW, provider_participant_id: 'player-1' });
    const b = naturalKey({ ...BASE_ROW, provider_participant_id: 'player-2' });
    assert.notEqual(a, b);
  });
});
