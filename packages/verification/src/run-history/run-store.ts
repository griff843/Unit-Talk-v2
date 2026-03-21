import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

import type { RunIndex, UnifiedRunRecord } from './types.js';

const RUNS_FILE = 'runs.jsonl';
const INDEX_FILE = 'run-index.json';
const WATCH_EVENTS_FILE = 'watch-events.jsonl';
const RECENT_LIMIT = 20;

export class RunStore {
  private readonly dir: string;
  private readonly runsPath: string;
  private readonly indexPath: string;
  private readonly watchEventsPath: string;

  constructor(outRoot: string) {
    this.dir = join(outRoot, 'verification');
    this.runsPath = join(this.dir, RUNS_FILE);
    this.indexPath = join(this.dir, INDEX_FILE);
    this.watchEventsPath = join(this.dir, WATCH_EVENTS_FILE);
    this.ensureDir();
  }

  appendRun(record: UnifiedRunRecord): void {
    appendFileSync(this.runsPath, `${JSON.stringify(record)}\n`, 'utf8');
    this.rebuildIndex(record);
  }

  getIndex(): RunIndex {
    if (!existsSync(this.indexPath)) {
      return createEmptyIndex();
    }

    return JSON.parse(readFileSync(this.indexPath, 'utf8')) as RunIndex;
  }

  getRecentRuns(limit = 10): UnifiedRunRecord[] {
    return this.readAllRuns()
      .sort(compareRunsDescending)
      .slice(0, limit);
  }

  getFailedRuns(limit = 50): UnifiedRunRecord[] {
    return this.readAllRuns()
      .filter(record => record.verdict === 'FAIL' || record.verdict === 'ERROR')
      .sort(compareRunsDescending)
      .slice(0, limit);
  }

  getRunsByScenario(scenarioId: string, limit = 20): UnifiedRunRecord[] {
    return this.readAllRuns()
      .filter(record => record.scenarioId === scenarioId)
      .sort(compareRunsDescending)
      .slice(0, limit);
  }

  get outputDir(): string {
    return this.dir;
  }

  private ensureDir(): void {
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }

    if (!existsSync(this.watchEventsPath)) {
      writeFileSync(this.watchEventsPath, '', 'utf8');
    }
  }

  private readAllRuns(): UnifiedRunRecord[] {
    if (!existsSync(this.runsPath)) {
      return [];
    }

    return readFileSync(this.runsPath, 'utf8')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => JSON.parse(line) as UnifiedRunRecord);
  }

  private rebuildIndex(latest: UnifiedRunRecord): void {
    const current = this.getIndex();
    const next: RunIndex = {
      total: current.total + 1,
      lastUpdatedAt: latest.completedAt,
      recentRunIds: [latest.runId, ...current.recentRunIds].slice(0, RECENT_LIMIT),
      byScenario: { ...current.byScenario },
      byMode: { ...current.byMode }
    };

    const counts = next.byScenario[latest.scenarioId] ?? {
      total: 0,
      passed: 0,
      failed: 0,
      errorCount: 0
    };

    counts.total += 1;
    if (latest.verdict === 'PASS') {
      counts.passed += 1;
    } else if (latest.verdict === 'FAIL') {
      counts.failed += 1;
    } else {
      counts.errorCount += 1;
    }
    next.byScenario[latest.scenarioId] = counts;

    next.byMode[latest.mode] = (next.byMode[latest.mode] ?? 0) + 1;

    const tempPath = `${this.indexPath}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    renameSync(tempPath, this.indexPath);
  }
}

function compareRunsDescending(left: UnifiedRunRecord, right: UnifiedRunRecord): number {
  return (
    Date.parse(right.completedAt) - Date.parse(left.completedAt) ||
    right.runId.localeCompare(left.runId)
  );
}

function createEmptyIndex(): RunIndex {
  return {
    total: 0,
    lastUpdatedAt: '',
    recentRunIds: [],
    byScenario: {},
    byMode: { replay: 0, runtime: 0, hybrid: 0 }
  };
}
