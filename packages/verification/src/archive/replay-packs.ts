import type { ReplayRegistryEntry } from './types.js';

export const CORE_REPLAY_PACKS: ReplayRegistryEntry[] = [
  {
    id: 'v2-full-lifecycle-pack',
    name: 'V2 Full Lifecycle Replay Pack',
    scenarioId: 'full-lifecycle',
    archiveSourceId: 'v2-lifecycle-fixture',
    executionMode: 'hybrid',
    expectedLifecycleCoverage: ['validated', 'queued', 'posted', 'settled'],
    suitableFor: ['lifecycle-verification', 'regression-canary'],
    expectedAssertions: [
      'Full lifecycle fixture aligns with canonical runtime stages.',
      'Settled state is present with additive evidence.'
    ],
    tags: ['v2', 'full-lifecycle'],
    status: 'active'
  },
  {
    id: 'v2-promotion-routing-pack',
    name: 'V2 Promotion Routing Replay Pack',
    scenarioId: 'promotion-routing',
    archiveSourceId: 'v2-promotion-fixture',
    executionMode: 'replay',
    expectedLifecycleCoverage: ['validated', 'queued'],
    suitableFor: ['observation', 'lifecycle-verification'],
    expectedAssertions: [
      'Best Bets and Trader Insights promotion metadata are replayable.',
      'Qualified governed picks advance to queued.'
    ],
    tags: ['v2', 'promotion', 'routing'],
    status: 'active'
  }
];
