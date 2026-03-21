export type RunMode = 'replay' | 'runtime' | 'hybrid';

export type RunVerdict = 'PASS' | 'FAIL' | 'ERROR';

export interface StageResult {
  stage: string;
  observed: boolean;
  count: number;
  detail?: string;
}

export interface UnifiedRunRecord {
  runId: string;
  scenarioId: string;
  mode: RunMode;
  commitHash: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  verdict: RunVerdict;
  stageResults: StageResult[];
  artifactPath: string;
  metadata: Record<string, unknown>;
}

export interface ScenarioRunCounts {
  total: number;
  passed: number;
  failed: number;
  errorCount: number;
}

export interface RunIndex {
  total: number;
  lastUpdatedAt: string;
  recentRunIds: string[];
  byScenario: Record<string, ScenarioRunCounts>;
  byMode: Record<RunMode, number>;
}

export interface ScenarioSummaryRow extends ScenarioRunCounts {
  scenarioId: string;
  passRate: number;
}

export interface RunSummary {
  generatedAt: string;
  totalRuns: number;
  byScenario: ScenarioSummaryRow[];
}
