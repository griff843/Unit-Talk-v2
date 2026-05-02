import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CanonicalPick } from '@unit-talk/contracts';
import { createInMemoryRepositoryBundle } from '@unit-talk/db';
import { recordGradedSettlement } from './settlement-service.js';

test('settlement confidence is estimated for stale-origin pick', async () => {
  const repos = createInMemoryRepositoryBundle();
  const event = await repos.events.upsertByExternalId({ externalId: 'stale-settle', sportId: 'nba', eventName: 'Stale Settle', eventDate: new Date().toISOString().slice(0, 10), status: 'completed', metadata: { starts_at: new Date().toISOString() } });
  const pick: CanonicalPick = { id: 'pick-stale-settle', submissionId: 'sub-stale-settle', market: 'player_points_ou', selection: 'over', line: 1, odds: -110, confidence: 0.7, source: 'system-pick-scanner', approvalStatus: 'approved', promotionStatus: 'qualified', promotionTarget: 'best-bets', lifecycleState: 'posted', metadata: { data_freshness: 'stale' }, createdAt: new Date().toISOString() };
  await repos.picks.savePick(pick);
  const result = await recordGradedSettlement(pick.id, 'win', { actualValue: 2, marketKey: 'player_points_ou', eventId: event.id, gameResultId: 'gr-stale' }, { picks: repos.picks, settlements: repos.settlements, audit: repos.audit, providerOffers: repos.providerOffers, participants: repos.participants, events: repos.events, eventParticipants: repos.eventParticipants, marketUniverse: repos.marketUniverse });
  assert.equal(result.settlementRecord.confidence, 'estimated');
});
