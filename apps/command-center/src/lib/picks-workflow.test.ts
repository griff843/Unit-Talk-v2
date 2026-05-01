import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOperatorPickCsv,
  filterOperatorPicks,
  normalizeOperatorPick,
  sortOperatorPicks,
  type PicksWorkflowFilters,
} from './picks-workflow.js';

const baseFilters: PicksWorkflowFilters = {
  sport: 'All',
  tiers: [],
  status: 'all',
  dateFrom: '',
  dateTo: '',
  search: '',
};

test('normalizeOperatorPick derives tier, status label, and player search text', () => {
  const pick = normalizeOperatorPick({
    id: 'pick-1',
    source: 'system-pick-scanner',
    market: 'player_points_ou',
    selection: 'Jalen Brunson over 24.5',
    status: 'awaiting_approval',
    approval_status: 'approved',
    created_at: '2026-04-29T12:00:00.000Z',
    metadata: {
      player: 'Jalen Brunson',
      sport: 'NBA',
      confidence: 82,
      ev: 6.4,
      tier: 'A',
    },
  });

  assert.equal(pick.tier, 'A');
  assert.equal(pick.statusLabel, 'Pending');
  assert.equal(pick.confidence, 82);
  assert.equal(pick.ev, 6.4);
  assert.match(pick.playerSearchText, /jalen brunson/);
});

test('filterOperatorPicks applies sport, tier, status, date, and search filters together', () => {
  const picks = [
    normalizeOperatorPick({
      id: 'pick-a',
      source: 'scanner',
      market: 'moneyline',
      selection: 'Yankees ML',
      status: 'queued',
      approval_status: 'approved',
      created_at: '2026-04-28T10:00:00.000Z',
      metadata: { sport: 'MLB', team: 'Yankees', tier: 'S' },
    }),
    normalizeOperatorPick({
      id: 'pick-b',
      source: 'scanner',
      market: 'player_points_ou',
      selection: 'Jalen Brunson over 24.5',
      status: 'awaiting_approval',
      approval_status: 'approved',
      created_at: '2026-04-29T10:00:00.000Z',
      metadata: { sport: 'NBA', player: 'Jalen Brunson', tier: 'A' },
    }),
  ];

  const filtered = filterOperatorPicks(picks, {
    ...baseFilters,
    sport: 'NBA',
    tiers: ['A'],
    status: 'Pending',
    dateFrom: '2026-04-29',
    search: 'brunson',
  });

  assert.deepEqual(filtered.map((pick) => pick.id), ['pick-b']);
});

test('sortOperatorPicks sorts by tier rank and submitted date', () => {
  const picks = [
    normalizeOperatorPick({
      id: 'pick-a',
      source: 'scanner',
      market: 'spread',
      selection: 'Pick A',
      status: 'queued',
      approval_status: 'approved',
      created_at: '2026-04-29T10:00:00.000Z',
      metadata: { tier: 'C' },
    }),
    normalizeOperatorPick({
      id: 'pick-b',
      source: 'scanner',
      market: 'spread',
      selection: 'Pick B',
      status: 'queued',
      approval_status: 'approved',
      created_at: '2026-04-28T10:00:00.000Z',
      metadata: { tier: 'S' },
    }),
  ];

  assert.deepEqual(sortOperatorPicks(picks, 'tier', 'asc').map((pick) => pick.id), ['pick-b', 'pick-a']);
  assert.deepEqual(sortOperatorPicks(picks, 'submitted', 'desc').map((pick) => pick.id), ['pick-a', 'pick-b']);
});

test('buildOperatorPickCsv emits a header row and escaped payloads', () => {
  const csv = buildOperatorPickCsv([
    normalizeOperatorPick({
      id: 'pick-1',
      source: 'scanner',
      market: 'moneyline',
      selection: 'Team, Inc. ML',
      status: 'queued',
      approval_status: 'approved',
      created_at: '2026-04-29T10:00:00.000Z',
      metadata: { team: 'Team, Inc.', sport: 'NBA', tier: 'B' },
    }),
  ]);

  assert.match(csv, /^id,tier,player,sport,market,odds,ev,confidence,status,submitted/m);
  assert.match(csv, /"team, inc\./i);
});
