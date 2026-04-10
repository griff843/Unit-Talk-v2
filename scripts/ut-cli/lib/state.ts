import fs from 'node:fs';
import path from 'node:path';

import type {
  ClosedState,
  JsonLike,
  LiveApplyState,
  PrState,
  SqlReviewState,
  StartedState,
  VerifyState,
} from '../types.js';

function stateDir(repoRoot: string, issueId: string): string {
  return path.join(repoRoot, '.ut-state', issueId);
}

export function ensureStateDir(repoRoot: string, issueId: string): string {
  const dir = stateDir(repoRoot, issueId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function statePath(repoRoot: string, issueId: string, fileName: string): string {
  return path.join(stateDir(repoRoot, issueId), fileName);
}

export function writeJsonState(
  repoRoot: string,
  issueId: string,
  fileName: string,
  payload: JsonLike,
  dryRun = false,
): string {
  const target = statePath(repoRoot, issueId, fileName);
  if (!dryRun) {
    ensureStateDir(repoRoot, issueId);
    fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }
  return target;
}

export function readJsonState<T>(repoRoot: string, issueId: string, fileName: string): T | null {
  const target = statePath(repoRoot, issueId, fileName);
  if (!fs.existsSync(target)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(target, 'utf8')) as T;
}

export function readStartedState(repoRoot: string, issueId: string): StartedState | null {
  return readJsonState<StartedState>(repoRoot, issueId, 'started.json');
}

export function readSqlReviewState(repoRoot: string, issueId: string): SqlReviewState | null {
  return readJsonState<SqlReviewState>(repoRoot, issueId, 'sql-review.json');
}

export function readPrState(repoRoot: string, issueId: string): PrState | null {
  return readJsonState<PrState>(repoRoot, issueId, 'pr.json');
}

export function readLiveApplyState(repoRoot: string, issueId: string): LiveApplyState | null {
  return readJsonState<LiveApplyState>(repoRoot, issueId, 'live-apply.json');
}

export function readClosedState(repoRoot: string, issueId: string): ClosedState | null {
  return readJsonState<ClosedState>(repoRoot, issueId, 'closed.json');
}

export function listVerifyStateFiles(repoRoot: string, issueId: string): string[] {
  const dir = stateDir(repoRoot, issueId);
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((entry) => /^verify-\d{8}T\d{6}\.json$/.test(entry))
    .sort();
}

export function readLatestVerifyState(repoRoot: string, issueId: string): VerifyState | null {
  const files = listVerifyStateFiles(repoRoot, issueId);
  const latest = files.at(-1);
  if (!latest) {
    return null;
  }
  return readJsonState<VerifyState>(repoRoot, issueId, latest);
}
