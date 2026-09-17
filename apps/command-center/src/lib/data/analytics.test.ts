import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { SRC } from '../test-support/source-walk';
import {
  classifyAttribution,
  computeStats,
  isTrackOnlyPick,
  pickProfitUnits,
  resolveCapperId,
} from './analytics.js';

/**
 * UTV2-1924 -- surface truth for human-capper statistics.
 *
 * Three things could go wrong here, and only one of them is visible to a reader
 * of the rendered page:
 *
 *  1. ROI computed from something other than the real price and the real stake.
 *     A wrong number here looks exactly like a right one.
 *  2. Attribution guessed from `picks.source` rather than read from the
 *     canonical `picks.capper_id`, which invents a capper.
 *  3. Track Only evidence folded into a published figure, which would publish a
 *     record that was never shown to anyone as if it had been.
 *
 * So the assertions below are on the arithmetic against an independently stated
 * expectation, on the source of the attribution decision, and on cohort
 * membership -- not on whether a page renders.
 */

// ── 1. Pricing ────────────────────────────────────────────────

test('pickProfitUnits prices a positive American price off the real stake', () => {
  // +150 at 2 units returns 3 units of profit.
  assert.equal(pickProfitUnits('win', 150, 2), 3);
});

test('pickProfitUnits prices a negative American price off the real stake', () => {
  // -110 at 1.1 units returns 1.1 * 100/110 = 1.0 units of profit.
  const profit = pickProfitUnits('win', -110, 1.1);
  assert.ok(profit !== null);
  assert.ok(Math.abs((profit as number) - 1) < 1e-9, `expected ~1, got ${String(profit)}`);
});

test('pickProfitUnits risks exactly the stake on a loss and nothing on a push', () => {
  assert.equal(pickProfitUnits('loss', 150, 2), -2);
  assert.equal(pickProfitUnits('loss', -250, 3), -3);
  assert.equal(pickProfitUnits('push', 150, 2), 0);
  assert.equal(pickProfitUnits('push', -250, 3), 0);
});

test('pickProfitUnits agrees with the canonical Track Only reporter arithmetic', () => {
  // scripts/ops/track-only/stats.ts -> profitUnits, restated here independently:
  // a positive price pays stake * odds/100, a negative one stake * 100/|odds|.
  for (const odds of [100, 110, 150, 275, -100, -110, -150, -333]) {
    for (const stake of [0.5, 1, 2.5]) {
      const expected = odds > 0 ? stake * (odds / 100) : stake * (100 / Math.abs(odds));
      const actual = pickProfitUnits('win', odds, stake);
      assert.ok(actual !== null, `odds ${odds} stake ${stake} should be priceable`);
      assert.ok(
        Math.abs((actual as number) - expected) < 1e-9,
        `odds ${odds} stake ${stake}: expected ${expected}, got ${String(actual)}`,
      );
    }
  }
});

test('pickProfitUnits refuses rather than returning 0 when it cannot price', () => {
  // Each of these is a real row shape that must not silently contribute a zero,
  // because a zero is indistinguishable from a genuine break-even.
  assert.equal(pickProfitUnits('win', null, 1), null, 'null odds');
  assert.equal(pickProfitUnits('win', 150, null), null, 'null stake');
  assert.equal(pickProfitUnits('win', 150, 0), null, 'zero stake');
  assert.equal(pickProfitUnits('win', 150, -1), null, 'negative stake');
  assert.equal(pickProfitUnits('win', 50, 1), null, 'odds inside (-100, 100)');
  assert.equal(pickProfitUnits('win', -50, 1), null, 'odds inside (-100, 100)');
  assert.equal(pickProfitUnits('win', 0, 1), null, 'zero odds');
  assert.equal(pickProfitUnits('win', '150' as unknown, 1), null, 'odds as a string');
  assert.equal(pickProfitUnits('win', 150, '1' as unknown), null, 'stake as a string');
  assert.equal(pickProfitUnits('win', Number.NaN, 1), null, 'NaN odds');
});

// ── 2. Cohort statistics ──────────────────────────────────────

const decided = (result: string, odds: number | null, stake: number | null) => ({
  result,
  odds,
  stake_units: stake,
});

test('computeStats units-weights ROI over the priced picks', () => {
  // +100 win at 1u (+1), -110 loss at 1u (-1), push at 1u (0).
  // staked 3, net 0 -> 0.0% ROI, which is a MEASURED break-even.
  const stats = computeStats([
    decided('win', 100, 1),
    decided('loss', -110, 1),
    decided('push', 120, 1),
  ]);
  assert.equal(stats.settled, 3);
  assert.equal(stats.wins, 1);
  assert.equal(stats.losses, 1);
  assert.equal(stats.pushes, 1);
  assert.equal(stats.unitsStaked, 3);
  assert.equal(stats.unitsNet, 0);
  assert.equal(stats.roiPct, 0);
  assert.equal(stats.unpriced, 0);
});

test('computeStats reports an unmeasurable cohort as null ROI, never as 0', () => {
  const stats = computeStats([decided('win', null, 1), decided('loss', 150, null)]);
  assert.equal(stats.roiPct, null, 'ROI must be null, not 0');
  assert.equal(stats.unitsStaked, null);
  assert.equal(stats.unitsNet, null);
  assert.equal(stats.unpriced, 2, 'both decided picks must be named as unpriced');
  // The record itself is still real and still reported.
  assert.equal(stats.wins, 1);
  assert.equal(stats.losses, 1);
});

test('computeStats never silently absorbs an unpriceable pick as a zero', () => {
  // One priceable +100 win at 1u, one unpriceable loss. If the unpriceable loss
  // were absorbed as a 0 it would halve the ROI to +50%.
  const stats = computeStats([decided('win', 100, 1), decided('loss', null, 1)]);
  assert.equal(stats.roiPct, 100, 'ROI describes only the picks that could be priced');
  assert.equal(stats.unitsStaked, 1);
  assert.equal(stats.unitsNet, 1);
  assert.equal(stats.unpriced, 1, 'the excluded pick is counted, not hidden');
});

test('computeStats excludes pushes from the hit rate but keeps them in the record', () => {
  const stats = computeStats([
    decided('win', 100, 1),
    decided('loss', 100, 1),
    decided('push', 100, 1),
  ]);
  assert.equal(stats.hitRatePct, 50, 'pushes must not dilute the hit rate');
  assert.equal(stats.settled, 3);
});

test('computeStats reports an empty cohort as null ROI', () => {
  const stats = computeStats([]);
  assert.equal(stats.total, 0);
  assert.equal(stats.settled, 0);
  assert.equal(stats.roiPct, null);
  assert.equal(stats.unitsStaked, null);
  assert.equal(stats.unitsNet, null);
});

test('per-capper partitions reconcile against the aggregate by construction', () => {
  // The invariant the operator actually checks: the capper totals sum to the
  // Unit Talk aggregate. It holds because both are the SAME function over
  // disjoint partitions of one cohort, not because they were tuned to agree.
  const griff = [decided('win', 150, 2), decided('loss', -110, 1)];
  const other = [decided('win', -110, 1), decided('push', 100, 1)];
  const aggregate = computeStats([...griff, ...other]);
  const a = computeStats(griff);
  const b = computeStats(other);

  assert.equal(a.settled + b.settled, aggregate.settled);
  assert.equal(a.wins + b.wins, aggregate.wins);
  assert.equal(a.losses + b.losses, aggregate.losses);
  assert.equal(a.pushes + b.pushes, aggregate.pushes);
  assert.ok(
    Math.abs((a.unitsStaked ?? 0) + (b.unitsStaked ?? 0) - (aggregate.unitsStaked ?? 0)) < 1e-9,
    'staked units must sum',
  );
  assert.ok(
    Math.abs((a.unitsNet ?? 0) + (b.unitsNet ?? 0) - (aggregate.unitsNet ?? 0)) < 1e-9,
    'net units must sum',
  );
});

// ── 3. Attribution ────────────────────────────────────────────

test('attribution reads picks.capper_id and nothing else', () => {
  assert.equal(resolveCapperId({ capper_id: 'griff843', source: 'board-construction' }), 'griff843');
  assert.equal(classifyAttribution({ capper_id: 'griff843', source: 'board-construction' }), 'capper');
});

test('a source that merely looks like a capper is not an attribution', () => {
  // `picks.source` names the intake path. Before UTV2-1907 a substring match on
  // it invented a capper; a pick with no `capper_id` has no capper, full stop.
  for (const source of ['smart-form', 'capper-submission', 'griff843-import', 'board-construction']) {
    assert.equal(resolveCapperId({ capper_id: null, source }), null, source);
    assert.equal(classifyAttribution({ capper_id: null, source }), 'system', source);
  }
});

test('an empty or blank capper_id is not an attribution', () => {
  assert.equal(resolveCapperId({ capper_id: '' }), null);
  assert.equal(resolveCapperId({}), null);
  assert.equal(classifyAttribution({ capper_id: '' }), 'system');
});

test('analytics.ts contains no string-guessed capper attribution', () => {
  // The unit assertions above cannot see a SECOND attribution path added later
  // somewhere else in the file, which is exactly how the original defect got in.
  const source = readFileSync(join(SRC, 'lib', 'data', 'analytics.ts'), 'utf8');
  for (const forbidden of ['extractCapperName', 'classifySource', "includes('capper", 'startsWith(\'capper']) {
    assert.ok(
      !source.includes(forbidden),
      `analytics.ts must not reintroduce \`${forbidden}\` -- attribution is capper_id only`,
    );
  }
});

// ── 4. Track Only exclusion ───────────────────────────────────

test('a Track Only pick is recognised from its persisted distributionMode', () => {
  assert.equal(isTrackOnlyPick({ metadata: { distributionMode: 'track-only' } }), true);
});

test('a pick without track-only distributionMode is publishable', () => {
  assert.equal(isTrackOnlyPick({ metadata: { distributionMode: 'member' } }), false);
  assert.equal(isTrackOnlyPick({ metadata: {} }), false);
  assert.equal(isTrackOnlyPick({}), false);
  assert.equal(isTrackOnlyPick({ metadata: null }), false);
});

test('excluding Track Only changes the published figure, so the filter is load-bearing', () => {
  // A published +100 win at 1u, plus a Track Only -110 loss at 1u. Folding the
  // Track Only row in would turn +100% into a loss -- the test fails if the
  // exclusion is removed, rather than passing vacuously.
  const rows = [
    { capper_id: 'griff843', metadata: { distributionMode: 'member' }, ...decided('win', 100, 1) },
    { capper_id: 'griff843', metadata: { distributionMode: 'track-only' }, ...decided('loss', -110, 1) },
  ];
  const published = rows.filter((r) => !isTrackOnlyPick(r));
  assert.equal(published.length, 1);
  assert.equal(computeStats(published).roiPct, 100);
  assert.notEqual(computeStats(rows).roiPct, computeStats(published).roiPct);
});

test('Track Only rows are still measured, just measured separately', () => {
  const rows = [
    { metadata: { distributionMode: 'track-only' }, ...decided('win', 100, 1) },
    { metadata: { distributionMode: 'track-only' }, ...decided('loss', -110, 1) },
  ];
  const trackOnly = rows.filter(isTrackOnlyPick);
  assert.equal(trackOnly.length, 2, 'exclusion from published is not deletion');
  assert.equal(computeStats(trackOnly).settled, 2);
});
