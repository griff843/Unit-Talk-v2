import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeProfitUnits,
  computeRoiPercent,
  printReport,
  summarizeStakeIntegrity,
  type RoiBySportRow,
} from './roi-by-sport.js';

const rows: RoiBySportRow[] = [
  {
    result: 'win',
    sport: 'NBA',
    marketType: 'player_points',
    odds: -110,
    stakeUnits: 2,
    clvStatus: 'computed',
    settledAt: '2026-05-18T00:00:00.000Z',
  },
  {
    result: 'loss',
    sport: 'NBA',
    marketType: 'player_points',
    odds: -105,
    stakeUnits: 1,
    clvStatus: null,
    settledAt: '2026-05-18T00:00:00.000Z',
  },
  {
    result: 'win',
    sport: 'MLB',
    marketType: 'moneyline',
    odds: 120,
    stakeUnits: null,
    clvStatus: null,
    settledAt: '2026-05-18T00:00:00.000Z',
  },
];

test('summarizeStakeIntegrity labels null stake rows separately', () => {
  assert.deepEqual(summarizeStakeIntegrity(rows), {
    canonicalStakeRows: 2,
    historicalUnknownStakeRows: 1,
    totalRows: 3,
  });
});

test('computeProfitUnits uses persisted stake and odds without flat fallback', () => {
  assert.equal(computeProfitUnits(rows[0]!), 1.82);
  assert.equal(computeProfitUnits(rows[1]!), -1);
  assert.equal(computeProfitUnits(rows[2]!), null);
});

test('computeRoiPercent excludes historical unknown stake rows', () => {
  assert.equal(Number(computeRoiPercent(rows)?.toFixed(2)), 27.33);
});

test('printReport emits stake-based ROI and historical unknown stake labels', () => {
  const output = printReport(rows, '2026-05-10', '2026-05-18T04:04:47.263Z');

  assert.match(output, /ROI \(stake-based\)/);
  assert.match(output, /Historical unknown-stake rows \| 1/);
  assert.match(output, /Rows with stake_units IS NULL are labeled historical_unknown/);
  assert.doesNotMatch(output, /flat -110 assumption/i);
});
