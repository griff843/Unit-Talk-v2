import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_SLIP_LEGS,
  addLeg,
  describeIncompleteLeg,
  findCombinedPriceKeys,
  isMultiLegSlip,
  legRefusalMessages,
  moveLeg,
  multiLegSubmissionRefusal,
  refusalForLeg,
  refusalLegId,
  removeLeg,
  revalidateSlip,
  summarizeSlip,
  type SlipLeg,
} from '../lib/bet-slip';
import type { BetFormValues } from '../lib/form-schema';

let counter = 0;
const nextId = () => `leg-${++counter}`;

function moneylineLeg(overrides: Partial<BetFormValues> = {}): Partial<BetFormValues> {
  return {
    sport: 'NFL',
    marketType: 'moneyline',
    eventName: 'Lions @ Bears',
    team: 'Lions',
    odds: -110,
    units: 1,
    capperConviction: 7,
    gameDate: '2026-09-15',
    sportsbook: 'fanatics',
    trackOnly: true,
    ...overrides,
  };
}

function spreadLeg(overrides: Partial<BetFormValues> = {}): Partial<BetFormValues> {
  return moneylineLeg({ marketType: 'spread', line: -3.5, odds: -105, ...overrides });
}

function seed(count: number): readonly SlipLeg[] {
  let legs: readonly SlipLeg[] = [];
  for (let i = 0; i < count; i += 1) {
    const result = addLeg(legs, moneylineLeg({ team: `Team ${i}` }), nextId);
    assert.equal(result.ok, true);
    if (result.ok) legs = result.legs;
  }
  return legs;
}

describe('addLeg', () => {
  it('appends a complete leg and preserves the parsed values', () => {
    const result = addLeg([], spreadLeg(), nextId);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.legs.length, 1);
    assert.equal(result.added.values.marketType, 'spread');
    assert.equal(result.added.values.line, -3.5);
  });

  it('refuses an incomplete leg and names the missing base field', () => {
    const result = addLeg([], moneylineLeg({ odds: undefined }), nextId);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.refusal.code, 'leg_incomplete');
    if (result.refusal.code !== 'leg_incomplete') return;
    assert.ok(result.refusal.fields.includes('Odds'));
  });

  it('refuses a leg missing only its market-specific field', () => {
    // Measured, not assumed: zod runs `.superRefine` only after the base object
    // parses, so a leg missing BOTH a base field and a market-specific one is
    // reported one stage at a time. Asserting both at once would have passed
    // for the wrong reason or failed for a reason that is not a defect — this
    // pair states the staging instead of hiding it.
    const result = addLeg([], moneylineLeg({ team: undefined }), nextId);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.refusal.code, 'leg_incomplete');
    if (result.refusal.code !== 'leg_incomplete') return;
    assert.deepEqual(result.refusal.fields, ['Team']);
  });

  it('leaves the existing legs untouched when it refuses', () => {
    const legs = seed(2);
    const result = addLeg(legs, moneylineLeg({ odds: undefined }), nextId);
    assert.equal(result.ok, false);
    // The operator's already-added legs survive a validation error rather than
    // being discarded with the refused one.
    assert.deepEqual(result.legs, legs);
    assert.equal(result.legs.length, 2);
  });

  it('refuses a leg beyond the slip ceiling instead of truncating', () => {
    const legs = seed(MAX_SLIP_LEGS);
    const result = addLeg(legs, moneylineLeg({ team: 'Overflow' }), nextId);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.refusal.code, 'slip_full');
    assert.equal(result.legs.length, MAX_SLIP_LEGS);
  });

  it('keeps both legs when two legs share a market identity — no silent dedupe', () => {
    const first = addLeg([], moneylineLeg(), nextId);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const second = addLeg(first.legs, moneylineLeg(), nextId);
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.legs.length, 2);
    assert.notEqual(second.legs[0].id, second.legs[1].id);
  });
});

describe('describeIncompleteLeg', () => {
  it('is empty for a complete leg', () => {
    assert.deepEqual(describeIncompleteLeg(moneylineLeg()), []);
  });

  it('names the player-prop fields a prop leg is missing', () => {
    const fields = describeIncompleteLeg(
      moneylineLeg({ marketType: 'player-prop', team: undefined }),
    );
    assert.ok(fields.includes('Player'));
    assert.ok(fields.includes('Stat'));
    assert.ok(fields.includes('Over or under'));
    assert.ok(fields.includes('Line'));
  });
});

describe('removeLeg', () => {
  it('removes exactly the named leg', () => {
    const legs = seed(3);
    const next = removeLeg(legs, legs[1].id);
    assert.equal(next.length, 2);
    assert.deepEqual(next.map((leg) => leg.id), [legs[0].id, legs[2].id]);
  });

  it('returns the list unchanged for an unknown id', () => {
    const legs = seed(2);
    assert.deepEqual(removeLeg(legs, 'no-such-leg'), legs);
  });
});

describe('moveLeg', () => {
  it('moves a leg up one position', () => {
    const legs = seed(3);
    const next = moveLeg(legs, legs[2].id, 'up');
    assert.deepEqual(next.map((leg) => leg.id), [legs[0].id, legs[2].id, legs[1].id]);
  });

  it('moves a leg down one position', () => {
    const legs = seed(3);
    const next = moveLeg(legs, legs[0].id, 'down');
    assert.deepEqual(next.map((leg) => leg.id), [legs[1].id, legs[0].id, legs[2].id]);
  });

  it('does not wrap at either end', () => {
    const legs = seed(3);
    assert.deepEqual(moveLeg(legs, legs[0].id, 'up'), legs);
    assert.deepEqual(moveLeg(legs, legs[2].id, 'down'), legs);
  });

  it('preserves every leg and its values', () => {
    const legs = seed(4);
    const next = moveLeg(legs, legs[3].id, 'up');
    assert.equal(next.length, legs.length);
    assert.deepEqual(
      [...next].map((leg) => leg.id).sort(),
      [...legs].map((leg) => leg.id).sort(),
    );
  });
});

describe('summarizeSlip', () => {
  it('renders one summary per leg, in slip order', () => {
    const legs = seed(3);
    const summaries = summarizeSlip(legs);
    assert.equal(summaries.length, 3);
    assert.deepEqual(summaries.map((s) => s.id), legs.map((leg) => leg.id));
    assert.equal(summaries[0].selection, 'Team 0');
    assert.equal(summaries[0].marketLabel.length > 0, true);
  });

  it('computes no combined price of any kind', () => {
    const legs = seed(3);
    // The control for "the UI never prices a parlay": pricing lives once, in
    // @unit-talk/contracts. A combined-price field on the summary turns this red.
    assert.deepEqual(findCombinedPriceKeys(summarizeSlip(legs)), []);
  });
});

describe('multi-leg submission', () => {
  it('a one-leg slip is not a multi-leg ticket and is submittable', () => {
    const legs = seed(1);
    assert.equal(isMultiLegSlip(legs), false);
    assert.equal(multiLegSubmissionRefusal(legs), null);
  });

  it('a two-leg slip is refused with a stated reason rather than silently failing', () => {
    const legs = seed(2);
    assert.equal(isMultiLegSlip(legs), true);
    const refusal = multiLegSubmissionRefusal(legs);
    assert.ok(refusal);
    assert.match(refusal, /cannot be submitted yet/);
  });
});

// UTV2-1916 — a refusal must say which thing it is about. UTV2-1915 rendered
// every refusal in one region above the leg list, so in a three-leg slip the
// operator could not tell which row a message meant. These assertions are about
// the *identity* carried on the value, not about where it happens to render.
describe('refusal scope', () => {
  it('a refusal about a committed leg carries that leg\u2019s identity', () => {
    const legs = seed(3);
    // A leg that no longer satisfies the schema. Constructed directly rather
    // than through addLeg, because addLeg is exactly what refuses to admit one
    // — which is the guarantee this test must not weaken to reach its subject.
    const broken: readonly SlipLeg[] = [
      legs[0],
      { id: legs[1].id, values: { ...legs[1].values, odds: undefined as unknown as number } },
      legs[2],
    ];

    const refusals = revalidateSlip(broken);
    assert.equal(refusals.length, 1, 'exactly the broken leg is refused');

    const [refusal] = refusals;
    // The assertion that fails when a refusal is emitted without the identity
    // of the leg it refers to: scope.kind would not be 'leg', so refusalLegId
    // returns null and this is the line that goes red.
    assert.equal(
      refusalLegId(refusal),
      broken[1].id,
      'a leg-scoped refusal must name the leg it is about',
    );
    assert.notEqual(refusalLegId(refusal), broken[0].id);
    assert.notEqual(refusalLegId(refusal), broken[2].id);
    assert.equal(refusal.code, 'leg_incomplete');
    if (refusal.code !== 'leg_incomplete') return;
    assert.deepEqual(refusal.fields, ['Odds']);

    // Identity, not position: the refusal follows its leg through a reorder.
    const reordered = moveLeg(broken, broken[1].id, 'up');
    assert.equal(reordered[0].id, broken[1].id);
    assert.equal(refusalForLeg(revalidateSlip(reordered), broken[1].id)?.code, 'leg_incomplete');
    assert.equal(refusalForLeg(revalidateSlip(reordered), broken[0].id), null);
  });

  it('a slip-scoped refusal is not attributed to any leg', () => {
    const legs = seed(MAX_SLIP_LEGS);
    const result = addLeg(legs, moneylineLeg({ team: 'One too many' }), nextId);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.refusal.code, 'slip_full');

    // The ceiling is a property of the ticket. Naming a leg here would mark a
    // leg the operator added correctly as the cause of a condition it did not
    // cause — so this is the line that fails if slip_full is ever leg-scoped.
    assert.equal(result.refusal.scope.kind, 'slip');
    assert.equal(
      refusalLegId(result.refusal),
      null,
      'a slip-scoped refusal must not name a leg',
    );

    // And it structurally cannot reach a row: the renderer reads this map.
    assert.deepEqual(legRefusalMessages([result.refusal]), {});
    for (const leg of legs) {
      assert.equal(refusalForLeg([result.refusal], leg.id), null);
    }
  });

  it('a refusal for the candidate leg is draft-scoped, because no row holds it', () => {
    const legs = seed(2);
    const result = addLeg(legs, moneylineLeg({ odds: undefined }), nextId);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.refusal.scope.kind, 'draft');
    assert.equal(refusalLegId(result.refusal), null);
    assert.deepEqual(legRefusalMessages([result.refusal]), {});
    // UTV2-1915's entry-survival guarantee, restated here so a scope change
    // cannot quietly discard committed legs: the list is returned unchanged.
    assert.deepEqual(result.legs, legs);
  });

  it('a slip whose legs all validate carries no leg-scoped refusal', () => {
    const legs = seed(3);
    assert.deepEqual(revalidateSlip(legs), []);
    assert.deepEqual(legRefusalMessages(revalidateSlip(legs)), {});
  });

  it('legRefusalMessages keys every leg-scoped refusal by its own leg', () => {
    const legs = seed(2);
    const broken: readonly SlipLeg[] = legs.map((leg) => ({
      id: leg.id,
      values: { ...leg.values, odds: undefined as unknown as number },
    }));
    const messages = legRefusalMessages(revalidateSlip(broken));
    assert.deepEqual(Object.keys(messages).sort(), [legs[0].id, legs[1].id].sort());
    for (const leg of legs) {
      assert.match(messages[leg.id], /no longer complete/);
    }
  });
});
