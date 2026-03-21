import type { ArchiveSource } from './types.js';

export const CORE_ARCHIVE_SOURCES: ArchiveSource[] = [
  {
    id: 'v2-lifecycle-fixture',
    name: 'V2 Lifecycle Fixture',
    type: 'fixture',
    fixturePath: 'v2-lifecycle-events.jsonl',
    description: 'Deterministic full lifecycle fixture covering validation through settlement.',
    eventCount: 4,
    pickCount: 1,
    sports: ['NBA'],
    markets: ['player-prop'],
    lifecycleStages: ['validated', 'queued', 'posted', 'settled'],
    replayDateRange: { from: '2026-03-20', to: '2026-03-20' },
    deterministicReplayVerified: true,
    suitableFor: ['lifecycle-verification', 'regression-canary'],
    provenance: 'Week 14 V2-native fixture',
    status: 'active',
    tags: ['v2', 'lifecycle', 'proof']
  },
  {
    id: 'v2-promotion-fixture',
    name: 'V2 Promotion Fixture',
    type: 'fixture',
    fixturePath: 'v2-promotion-events.jsonl',
    description: 'Deterministic governed-promotion fixture covering best-bets and trader-insights.',
    eventCount: 4,
    pickCount: 2,
    sports: ['NBA', 'MLB'],
    markets: ['player-prop', 'total-bases'],
    lifecycleStages: ['validated', 'queued'],
    replayDateRange: { from: '2026-03-20', to: '2026-03-20' },
    deterministicReplayVerified: true,
    suitableFor: ['observation', 'lifecycle-verification', 'regression-canary'],
    provenance: 'Week 14 V2-native fixture',
    status: 'active',
    tags: ['v2', 'promotion', 'governed-routing']
  }
];
