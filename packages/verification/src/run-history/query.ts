import type { RunSummary, ScenarioSummaryRow, UnifiedRunRecord } from './types.js';
import type { RunStore } from './run-store.js';

export class QueryRunner {
  constructor(private readonly store: RunStore) {}

  recent(limit = 10): UnifiedRunRecord[] {
    return this.store.getRecentRuns(limit);
  }

  failures(limit = 50): UnifiedRunRecord[] {
    return this.store.getFailedRuns(limit);
  }

  byScenario(scenarioId: string, limit = 20): UnifiedRunRecord[] {
    return this.store.getRunsByScenario(scenarioId, limit);
  }

  summary(): RunSummary {
    const index = this.store.getIndex();
    const rows: ScenarioSummaryRow[] = Object.entries(index.byScenario)
      .map(([scenarioId, counts]) => ({
        scenarioId,
        ...counts,
        passRate: counts.total > 0 ? counts.passed / counts.total : 0
      }))
      .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId));

    return {
      generatedAt: index.lastUpdatedAt,
      totalRuns: index.total,
      byScenario: rows
    };
  }
}
