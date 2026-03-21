import type { ScenarioDefinition } from './types.js';

export const CORE_SCENARIOS: ScenarioDefinition[] = [
  {
    id: 'submission-validation',
    name: 'Submission and Validation',
    mode: 'replay',
    fixturePath: 'v2-lifecycle-events.jsonl',
    lifecycleStagesExpected: ['validated'],
    expectedAssertions: [
      'A fresh submission reaches the validated lifecycle stage.',
      'Submission metadata remains intact in fixture replay.'
    ],
    tags: ['submission', 'validation', 'canonical']
  },
  {
    id: 'promotion-routing',
    name: 'Promotion Evaluation and Routing',
    mode: 'replay',
    fixturePath: 'v2-promotion-events.jsonl',
    lifecycleStagesExpected: ['validated', 'queued'],
    expectedAssertions: [
      'Governed promotion metadata is present for active targets.',
      'Qualified picks advance from validated to queued.'
    ],
    tags: ['promotion', 'routing', 'best-bets', 'trader-insights']
  },
  {
    id: 'distribution-delivery',
    name: 'Distribution and Delivery',
    mode: 'hybrid',
    fixturePath: 'v2-promotion-events.jsonl',
    lifecycleStagesExpected: ['queued', 'posted'],
    expectedAssertions: [
      'Queued picks can be delivered to governed Discord targets.',
      'Posted lifecycle evidence is recorded after delivery.'
    ],
    tags: ['distribution', 'delivery', 'discord']
  },
  {
    id: 'settlement-resolution',
    name: 'Settlement and Correction',
    mode: 'replay',
    fixturePath: 'v2-lifecycle-events.jsonl',
    lifecycleStagesExpected: ['posted', 'settled'],
    expectedAssertions: [
      'A posted pick can be settled through the canonical API.',
      'Correction chains remain additive and traceable.'
    ],
    tags: ['settlement', 'correction', 'audit']
  },
  {
    id: 'full-lifecycle',
    name: 'Full Lifecycle End-to-End',
    mode: 'hybrid',
    fixturePath: 'v2-lifecycle-events.jsonl',
    lifecycleStagesExpected: ['validated', 'queued', 'posted', 'settled'],
    expectedAssertions: [
      'One pick can move through the full canonical lifecycle.',
      'Runtime proof artifacts line up with fixture expectations.'
    ],
    tags: ['lifecycle', 'e2e', 'proof']
  }
];
