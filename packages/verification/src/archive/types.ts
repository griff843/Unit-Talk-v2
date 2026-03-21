import type { ScenarioMode } from '../scenarios/types.js';

export type ArchiveSourceType =
  | 'fixture'
  | 'journal'
  | 'snapshot-bundle'
  | 'historical-run-pack';

export type ReplayPurpose =
  | 'observation'
  | 'regression-canary'
  | 'lifecycle-verification'
  | 'strategy-simulation'
  | 'model-comparison';

export interface ArchiveSource {
  id: string;
  name: string;
  type: ArchiveSourceType;
  fixturePath: string;
  description: string;
  eventCount: number;
  pickCount: number;
  sports: string[];
  markets: string[];
  lifecycleStages: string[];
  replayDateRange: {
    from: string;
    to: string;
  };
  deterministicReplayVerified: boolean;
  suitableFor: ReplayPurpose[];
  provenance: string;
  status: 'active' | 'deprecated';
  tags: string[];
}

export interface ReplayRegistryEntry {
  id: string;
  name: string;
  scenarioId?: string;
  archiveSourceId: string;
  executionMode: ScenarioMode;
  expectedLifecycleCoverage: string[];
  suitableFor: ReplayPurpose[];
  expectedAssertions: string[];
  tags: string[];
  status: 'active' | 'deprecated';
}
