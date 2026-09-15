import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PARLAY_MAX_LEGS,
  PARLAY_MIN_LEGS,
  americanToDecimal,
  decimalToAmerican,
  isValidAmericanOdds,
  deriveParlayTicketIdentity,
  parlayStatContribution,
  priceParlay,
  priceSettledParlay,
  resolveParlayTicketOutcome,
  validateParlayTicket,
  type ParlayLegInput,
  type ParlayLegResult,
  type ParlayTicketPayload,
} from './ticket.js';

function leg(overrides: Partial<ParlayLegInput> & { id: string }): ParlayLegInput {
  return {
    eventName: `Game ${overrides.id}`,
    market: 'spread',
    selection: 'Home -3.5',
    odds: -110,
    ...overrides,
  };
}

function ticket(overrides: Partial<ParlayTicketPayload> = {}): ParlayTicketPayload {
  return {
    ticketType: 'parlay',
    legs: [leg({ id: 'a' }), leg({ id: 'b' })],
    stakeUnits: 1,
    ...overrides,
  };
}

// ── American odds ────────────────────────────────────────────────────────────

test('American odds between -99 and +99 are not prices', () => {
  assert.equal(isValidAmericanOdds(-110), true);
  assert.equal(isValidAmericanOdds(100), true);
  assert.equal(isValidAmericanOdds(-100), true);
  assert.equal(isValidAmericanOdds(0), false);
  assert.equal(isValidAmericanOdds(50), false);
  assert.equal(isValidAmericanOdds(-99), false);
  assert.equal(isValidAmericanOdds(99), false);
  assert.equal(isValidAmericanOdds(-110.5), false, 'a fractional American price is not a price');
  assert.equal(isValidAmericanOdds(Number.NaN), false);
  assert.equal(isValidAmericanOdds(Number.POSITIVE_INFINITY), false);
  assert.equal(isValidAmericanOdds('-110'), false, 'a string is not a price');
  assert.equal(isValidAmericanOdds(null), false);
  assert.equal(isValidAmericanOdds(undefined), false);
});

test('americanToDecimal converts both signs and refuses an illegal price', () => {
  assert.equal(americanToDecimal(100), 2);
  assert.equal(americanToDecimal(-100), 2);
  assert.equal(americanToDecimal(150), 2.5);
  assert.ok(Math.abs(americanToDecimal(-110) - 1.909090909090909) < 1e-12);
  assert.throws(() => americanToDecimal(0), RangeError);
  assert.throws(() => americanToDecimal(50), RangeError);
});

test('decimalToAmerican round-trips and resolves even money to +100', () => {
  for (const odds of [-250, -150, -110, -100, 100, 120, 150, 400]) {
    assert.equal(
      decimalToAmerican(americanToDecimal(odds)),
      odds === -100 ? 100 : odds,
      `round trip failed for ${odds}`,
    );
  }
  assert.equal(decimalToAmerican(2), 100, 'even money takes the positive form');
  assert.throws(() => decimalToAmerican(1), RangeError);
  assert.throws(() => decimalToAmerican(0.5), RangeError);
  assert.throws(() => decimalToAmerican(Number.NaN), RangeError);
});

// ── Pricing ──────────────────────────────────────────────────────────────────

test('priceParlay multiplies decimal prices and rounds once, at the end', () => {
  // -110 x -110 = 1.909090909... ^2 = 3.64462809... → +264 (not +263, which is
  // what rounding each leg to 1.91 first would produce).
  // Computed rather than written out: the exact value needs more digits than a
  // TypeScript number literal may legally carry (no-loss-of-precision).
  const exact = (1 + 100 / 110) ** 2;
  const pricing = priceParlay([leg({ id: 'a' }), leg({ id: 'b' })], 1);
  assert.ok(Math.abs(pricing.decimalOdds - exact) < 1e-12);
  assert.equal(pricing.americanOdds, 264);
  assert.ok(Math.abs(pricing.payoutUnits - (exact - 1)) < 1e-12);
});

test('priceParlay scales the payout with the stake and excludes it', () => {
  const single = priceParlay([leg({ id: 'a', odds: 100 }), leg({ id: 'b', odds: 100 })], 1);
  assert.equal(single.decimalOdds, 4);
  assert.equal(single.payoutUnits, 3, 'profit only — the stake is returned separately');
  const triple = priceParlay([leg({ id: 'a', odds: 100 }), leg({ id: 'b', odds: 100 })], 3);
  assert.equal(triple.payoutUnits, 9);
});

test('priceParlay refuses an empty ticket and a non-positive stake', () => {
  assert.throws(() => priceParlay([], 1), RangeError);
  assert.throws(() => priceParlay([leg({ id: 'a' })], 0), RangeError);
  assert.throws(() => priceParlay([leg({ id: 'a' })], -1), RangeError);
  assert.throws(() => priceParlay([leg({ id: 'a' })], Number.NaN), RangeError);
});

// ── Validation ───────────────────────────────────────────────────────────────

test('a two-leg parlay with distinct markets validates', () => {
  const result = validateParlayTicket(ticket());
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test('leg count is bounded at both ends', () => {
  const one = validateParlayTicket(ticket({ legs: [leg({ id: 'a' })] }));
  assert.equal(one.ok, false);
  assert.ok(one.errors.some((e) => e.includes(`at least ${PARLAY_MIN_LEGS} legs`)));

  const many = validateParlayTicket(
    ticket({
      legs: Array.from({ length: PARLAY_MAX_LEGS + 1 }, (_, i) => leg({ id: `l${i}` })),
    }),
  );
  assert.equal(many.ok, false);
  assert.ok(many.errors.some((e) => e.includes(`at most ${PARLAY_MAX_LEGS} legs`)));

  const atCap = validateParlayTicket(
    ticket({ legs: Array.from({ length: PARLAY_MAX_LEGS }, (_, i) => leg({ id: `l${i}` })) }),
  );
  assert.equal(atCap.ok, true, 'the cap itself is legal');
});

test('the same side of the same market cannot appear twice', () => {
  const duplicate = validateParlayTicket(
    ticket({
      legs: [
        leg({ id: 'a', eventName: 'Lions @ Bears', market: 'spread', selection: 'Lions -3.5' }),
        leg({ id: 'b', eventName: ' lions @ bears ', market: 'SPREAD', selection: 'LIONS -3.5' }),
      ],
    }),
  );
  assert.equal(duplicate.ok, false);
  assert.ok(duplicate.errors.some((e) => e.includes('duplicates an earlier leg')));

  const otherSide = validateParlayTicket(
    ticket({
      legs: [
        leg({ id: 'a', eventName: 'Lions @ Bears', market: 'spread', selection: 'Lions -3.5' }),
        leg({ id: 'b', eventName: 'Lions @ Bears', market: 'total', selection: 'Over 44.5' }),
      ],
    }),
  );
  assert.deepEqual(otherSide.errors, [], 'a different market in the same game is legal');
});

test('duplicate leg ids are refused even when the markets differ', () => {
  const result = validateParlayTicket(
    ticket({
      legs: [
        leg({ id: 'a', market: 'spread' }),
        leg({ id: 'a', market: 'total', selection: 'Over 44.5' }),
      ],
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("duplicate leg id 'a'")));
});

test('validation reports every error rather than the first', () => {
  const result = validateParlayTicket({
    ticketType: 'parlay',
    legs: [leg({ id: '', odds: 0 }), leg({ id: 'b', eventName: '  ', line: Number.NaN })],
    stakeUnits: 0,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('stakeUnits')));
  assert.ok(result.errors.some((e) => e.includes('leg 0: id is required')));
  assert.ok(result.errors.some((e) => e.includes('leg 0: odds is not a valid American price')));
  assert.ok(result.errors.some((e) => e.includes('leg 1: eventName is required')));
  assert.ok(result.errors.some((e) => e.includes('leg 1: line must be a finite number')));
  assert.ok(result.errors.length >= 5, `expected every error, got ${result.errors.length}`);
});

test('a quoted price is checked as a price, not against the computed one', () => {
  const quoted = validateParlayTicket(ticket({ quotedOdds: 260 }));
  assert.deepEqual(quoted.errors, [], 'a book price that differs from the computed one is normal');
  assert.equal(priceParlay(ticket().legs, 1).americanOdds, 264);

  const illegal = validateParlayTicket(ticket({ quotedOdds: 50 }));
  assert.equal(illegal.ok, false);
  assert.ok(illegal.errors.some((e) => e.includes('quotedOdds')));
});

test('a ticket that is not a parlay is refused by this contract', () => {
  const result = validateParlayTicket({
    ...ticket(),
    ticketType: 'teaser' as unknown as 'parlay',
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("ticketType must be 'parlay'")));
});

// ── Outcome resolution ───────────────────────────────────────────────────────

const legs = [leg({ id: 'a' }), leg({ id: 'b' }), leg({ id: 'c' })];
const results = (...outcomes: ParlayLegResult['outcome'][]): ParlayLegResult[] =>
  outcomes.map((outcome, i) => ({ legId: legs[i]!.id, outcome }));

test('every leg winning wins the ticket', () => {
  const resolution = resolveParlayTicketOutcome(legs, results('win', 'win', 'win'));
  assert.equal(resolution.outcome, 'win');
  assert.deepEqual(resolution.survivingLegIds, ['a', 'b', 'c']);
  assert.equal(resolution.reason, 'every leg won');
});

test('one lost leg loses the ticket even with a leg still ungraded', () => {
  const resolution = resolveParlayTicketOutcome(legs, results('win', 'loss', 'pending'));
  assert.equal(resolution.outcome, 'loss', 'a loss is determinative and is not deferred');
  assert.deepEqual(resolution.survivingLegIds, []);
  assert.ok(resolution.reason.includes('b'));
});

test('an ungraded leg leaves a would-be winner unresolved', () => {
  const resolution = resolveParlayTicketOutcome(legs, results('win', 'win', 'pending'));
  assert.equal(resolution.outcome, null, 'never declare a win on partial information');
  assert.ok(resolution.reason.includes('not yet graded'));
  assert.deepEqual(resolution.survivingLegIds, []);
});

test('a pushed leg drops out and the rest still win', () => {
  const resolution = resolveParlayTicketOutcome(legs, results('win', 'push', 'win'));
  assert.equal(resolution.outcome, 'win');
  assert.deepEqual(resolution.survivingLegIds, ['a', 'c']);
  assert.ok(resolution.reason.includes('1 leg(s) pushed or voided'));
});

test('a voided leg drops out exactly as a pushed one does', () => {
  const resolution = resolveParlayTicketOutcome(legs, results('win', 'void', 'win'));
  assert.equal(resolution.outcome, 'win');
  assert.deepEqual(resolution.survivingLegIds, ['a', 'c']);
});

test('every leg pushing or voiding is a push, not a win', () => {
  const resolution = resolveParlayTicketOutcome(legs, results('push', 'void', 'push'));
  assert.equal(resolution.outcome, 'push');
  assert.deepEqual(resolution.survivingLegIds, []);
  assert.equal(resolution.reason, 'every leg pushed or voided');
});

test('a missing leg result is refused rather than assumed', () => {
  const resolution = resolveParlayTicketOutcome(legs, [
    { legId: 'a', outcome: 'win' },
    { legId: 'b', outcome: 'win' },
  ]);
  assert.equal(resolution.outcome, null);
  assert.ok(resolution.reason.includes('no result for leg(s): c'));
});

test('a result naming a leg the ticket does not carry is refused', () => {
  const resolution = resolveParlayTicketOutcome(legs, [
    ...results('win', 'win', 'win'),
    { legId: 'zz', outcome: 'win' },
  ]);
  assert.equal(resolution.outcome, null);
  assert.ok(resolution.reason.includes("leg 'zz'"));
});

test('two results for one leg are refused rather than reconciled', () => {
  const resolution = resolveParlayTicketOutcome(legs, [
    ...results('win', 'win', 'win'),
    { legId: 'a', outcome: 'loss' },
  ]);
  assert.equal(resolution.outcome, null);
  assert.ok(resolution.reason.includes('more than one result'));
});

test('a ticket with no legs resolves to nothing', () => {
  const resolution = resolveParlayTicketOutcome([], []);
  assert.equal(resolution.outcome, null);
  assert.equal(resolution.reason, 'ticket has no legs');
});

test('an empty result set never resolves a ticket', () => {
  const resolution = resolveParlayTicketOutcome(legs, []);
  assert.equal(resolution.outcome, null);
  assert.ok(resolution.reason.includes('no result for leg(s)'));
});

// ── Settled pricing ──────────────────────────────────────────────────────────

test('a pushed leg re-prices the ticket down to the legs that survived', () => {
  const evenLegs = [
    leg({ id: 'a', odds: 100 }),
    leg({ id: 'b', odds: 100 }),
    leg({ id: 'c', odds: 100 }),
  ];
  const quoted = priceParlay(evenLegs, 1);
  assert.equal(quoted.payoutUnits, 7, 'three even-money legs pay 7 units on 1');

  const resolution = resolveParlayTicketOutcome(evenLegs, [
    { legId: 'a', outcome: 'win' },
    { legId: 'b', outcome: 'push' },
    { legId: 'c', outcome: 'win' },
  ]);
  const settled = priceSettledParlay(evenLegs, resolution, 1);
  assert.ok(settled);
  assert.equal(settled.payoutUnits, 3, 'the pushed leg is not paid on');
});

test('only a win has a parlay price', () => {
  assert.equal(
    priceSettledParlay(legs, resolveParlayTicketOutcome(legs, results('win', 'loss', 'win')), 1),
    null,
  );
  assert.equal(
    priceSettledParlay(legs, resolveParlayTicketOutcome(legs, results('push', 'push', 'push')), 1),
    null,
  );
  assert.equal(
    priceSettledParlay(legs, resolveParlayTicketOutcome(legs, results('win', 'win', 'pending')), 1),
    null,
  );
});

// ── Ticket identity / idempotency ────────────────────────────────────────────

test('ticket identity is order-independent: reordering legs is the same bet', () => {
  const a = ticket({ legs: [leg({ id: 'a' }), leg({ id: 'b' }), leg({ id: 'c' })] });
  const b = ticket({ legs: [leg({ id: 'c' }), leg({ id: 'a' }), leg({ id: 'b' })] });
  assert.equal(deriveParlayTicketIdentity(a), deriveParlayTicketIdentity(b));
});

test('ticket identity separates different stakes on the same selections', () => {
  const small = ticket({ legs: [leg({ id: 'a' }), leg({ id: 'b' })], stakeUnits: 1 });
  const large = ticket({ legs: [leg({ id: 'a' }), leg({ id: 'b' })], stakeUnits: 5 });
  assert.notEqual(deriveParlayTicketIdentity(small), deriveParlayTicketIdentity(large));
});

test('ticket identity separates the same selections taken at different prices', () => {
  const cheap = ticket({ legs: [leg({ id: 'a' }), leg({ id: 'b', odds: -110 })] });
  const rich = ticket({ legs: [leg({ id: 'a' }), leg({ id: 'b', odds: 150 })] });
  assert.notEqual(deriveParlayTicketIdentity(cheap), deriveParlayTicketIdentity(rich));
});

test('ticket identity separates the same market at different lines', () => {
  const low = ticket({ legs: [leg({ id: 'a' }), leg({ id: 'b', line: -3.5 })] });
  const high = ticket({ legs: [leg({ id: 'a' }), leg({ id: 'b', line: -7.5 })] });
  assert.notEqual(deriveParlayTicketIdentity(low), deriveParlayTicketIdentity(high));
});

test('ticket identity is insensitive to case and whitespace, as duplicate detection is', () => {
  const plain = ticket({ legs: [leg({ id: 'a', selection: 'Home -3.5' }), leg({ id: 'b' })] });
  const messy = ticket({ legs: [leg({ id: 'a', selection: '  home -3.5 ' }), leg({ id: 'b' })] });
  assert.equal(deriveParlayTicketIdentity(plain), deriveParlayTicketIdentity(messy));
});

// ── Statistics semantics ─────────────────────────────────────────────────────

const won = (ids: string[]): ParlayLegResult[] => ids.map((id) => ({ legId: id, outcome: 'win' }));

test('a settled parlay is ONE record, never one per leg', () => {
  const legs = [leg({ id: 'a' }), leg({ id: 'b' }), leg({ id: 'c' }), leg({ id: 'd' })];
  const resolution = resolveParlayTicketOutcome(legs, won(['a', 'b', 'c', 'd']));
  const stat = parlayStatContribution(legs, resolution, 1);
  assert.equal(stat.records, 1);
  assert.equal(stat.wins, 1);
  assert.equal(stat.legCount, 4);
});

test('a pending parlay contributes nothing at all, not a zero record', () => {
  const legs = [leg({ id: 'a' }), leg({ id: 'b' })];
  const resolution = resolveParlayTicketOutcome(legs, [
    { legId: 'a', outcome: 'win' },
    { legId: 'b', outcome: 'pending' },
  ]);
  assert.equal(resolution.outcome, null);
  const stat = parlayStatContribution(legs, resolution, 3);
  assert.equal(stat.records, 0);
  assert.equal(stat.unitsDelta, 0);
});

test('a losing parlay returns the stake negated, whatever the legs were priced at', () => {
  const legs = [leg({ id: 'a' }), leg({ id: 'b', odds: 900 })];
  const resolution = resolveParlayTicketOutcome(legs, [
    { legId: 'a', outcome: 'loss' },
    { legId: 'b', outcome: 'win' },
  ]);
  const stat = parlayStatContribution(legs, resolution, 2.5);
  assert.equal(stat.records, 1);
  assert.equal(stat.losses, 1);
  assert.equal(stat.unitsDelta, -2.5);
});

test('an all-push parlay is a record with zero units, not a win and not a skip', () => {
  const legs = [leg({ id: 'a' }), leg({ id: 'b' })];
  const resolution = resolveParlayTicketOutcome(legs, [
    { legId: 'a', outcome: 'push' },
    { legId: 'b', outcome: 'push' },
  ]);
  const stat = parlayStatContribution(legs, resolution, 4);
  assert.equal(stat.records, 1);
  assert.equal(stat.pushes, 1);
  assert.equal(stat.wins, 0);
  assert.equal(stat.unitsDelta, 0);
});

test('a win pays the SURVIVING parlay, so a pushed leg does not pay the quoted price', () => {
  const legs = [leg({ id: 'a' }), leg({ id: 'b' }), leg({ id: 'c' })];
  const full = resolveParlayTicketOutcome(legs, won(['a', 'b', 'c']));
  const pushed = resolveParlayTicketOutcome(legs, [
    { legId: 'a', outcome: 'win' },
    { legId: 'b', outcome: 'win' },
    { legId: 'c', outcome: 'push' },
  ]);
  const fullStat = parlayStatContribution(legs, full, 1);
  const pushedStat = parlayStatContribution(legs, pushed, 1);
  assert.equal(fullStat.wins, 1);
  assert.equal(pushedStat.wins, 1);
  assert.ok(
    pushedStat.unitsDelta < fullStat.unitsDelta,
    `a two-leg survivor must pay less than the three-leg ticket: ${pushedStat.unitsDelta} vs ${fullStat.unitsDelta}`,
  );
  // And it must pay exactly the two-leg price, not some discounted three-leg one.
  const twoLeg = priceSettledParlay(legs, pushed, 1);
  assert.equal(pushedStat.unitsDelta, twoLeg?.payoutUnits);
});

test('units scale with the stake rather than being fixed per ticket', () => {
  const legs = [leg({ id: 'a' }), leg({ id: 'b' })];
  const resolution = resolveParlayTicketOutcome(legs, won(['a', 'b']));
  const one = parlayStatContribution(legs, resolution, 1);
  const three = parlayStatContribution(legs, resolution, 3);
  assert.ok(Math.abs(three.unitsDelta - one.unitsDelta * 3) < 1e-12);
  assert.equal(three.records, 1);
});
