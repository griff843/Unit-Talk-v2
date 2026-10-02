import { readImmutablePreflightEvidence } from './lane-link-pr.js';
import { execFileSync } from 'node:child_process';
import { git, validatePreflightTokenPathValue, type LaneManifest } from './shared.js';

export interface HistoricalMergedPr {
  url: string;
  merged: boolean;
  mergeSha: string | null;
  headSha?: string | null;
  headRefName?: string | null;
  baseRefName?: string | null;
}

/** Restore a historical obligation, never a fresh preflight authorization/token.
 * The caller supplies its independently fetched original merged-PR attestation.
 * Active lanes cannot use this path. Squash merges retain the introduction on
 * the immutable original PR head, not necessarily in main's first-parent tree.
 */
export function recoverHistoricalMergedPreflight(
  manifest: LaneManifest,
  pr: HistoricalMergedPr,
  cwd: string,
  runner: typeof git = git,
): { source_commit: string; head_sha: string; merge_sha: string; token_recreated: false } {
  const reference = /^https:\/\/github\.com\/griff843\/Unit-Talk-v2\/pull\/(\d+)$/.exec(pr.url);
  if (
    manifest.status !== 'merged' || !pr.merged || !reference ||
    manifest.pr_url !== pr.url || manifest.commit_sha !== pr.mergeSha ||
    pr.headRefName !== manifest.branch || pr.baseRefName !== 'main' || manifest.base_branch !== 'main' ||
    !/^[0-9a-f]{40}$/i.test(pr.mergeSha ?? '') || !/^[0-9a-f]{40}$/i.test(pr.headSha ?? '')
  ) throw new Error('Historical preflight recovery requires the exact canonical original merged PR identity');
  validatePreflightTokenPathValue(manifest.preflight_token);
  const head = pr.headSha!;
  const merge = pr.mergeSha!;
  const shallow = runner(['rev-parse', '--is-shallow-repository'], cwd);
  if (!shallow.ok) throw new Error('Historical preflight history depth is unavailable');
  if (shallow.stdout.trim() === 'true' && !runner([
    'fetch', '--no-tags', '--unshallow', 'origin', 'refs/heads/main:refs/remotes/origin/main',
  ], cwd).ok) throw new Error('Authoritative trusted-main history could not be deepened');
  if (shallow.stdout.trim() === 'true' || !runner(['cat-file', '-e', `${head}^{commit}`], cwd).ok) {
    const fetched = runner(['fetch', '--no-tags', 'origin', `refs/pull/${reference[1]}/head`], cwd);
    const fetchedHead = runner(['rev-parse', 'FETCH_HEAD'], cwd);
    if (!fetched.ok || !fetchedHead.ok || fetchedHead.stdout.trim() !== head) {
      throw new Error('Authoritative original PR history could not be recovered at its immutable head');
    }
  }
  if (!runner(['merge-base', '--is-ancestor', merge, 'origin/main'], cwd).ok) {
    throw new Error('Historical preflight recovery requires the attested merge reachable from trusted main');
  }
  const path = `docs/06_status/lanes/${manifest.issue_id}.json`;
  // Pin the existing immutable-introduction validator to the original PR head.
  // Do not read an introduction from the repair PR or today's editable manifest.
  const historicalRunner: typeof git = (args, root) => {
    const separator = args.indexOf('--');
    return runner(args[0] === 'log' && separator >= 0
      ? [...args.slice(0, separator), head, ...args.slice(separator)] : args, root);
  };
  const introductions = historicalRunner(['log', '--format=%H', '--diff-filter=A', '--', path], cwd);
  if (!introductions.ok) throw new Error('Historical preflight introduction history is unavailable');
  const sources = introductions.stdout.trim().split(/\r?\n/).filter(Boolean);
  if (sources.length !== 1) throw new Error('Historical preflight introduction evidence is missing or ambiguous');
  const raw = runner(['show', `${sources[0]}:${path}`], cwd);
  if (!raw.ok) throw new Error('Historical preflight introduction blob is unavailable');
  const original: unknown = JSON.parse(raw.stdout);
  if (!original || typeof original !== 'object' || Array.isArray(original)) throw new Error('Historical preflight introduction is invalid');
  const obligation = (original as Record<string, unknown>)['t1_live_db_precondition'];
  if (obligation !== undefined && obligation !== 'deferred_to_ci') throw new Error('Historical preflight obligation is invalid');
  if (manifest.t1_live_db_precondition !== undefined && manifest.t1_live_db_precondition !== obligation) {
    throw new Error('Editable manifest cannot assert a deferral absent from immutable prior evidence');
  }
  const historicalManifest = { ...manifest };
  if (obligation === 'deferred_to_ci') historicalManifest.t1_live_db_precondition = obligation;
  const verified = readImmutablePreflightEvidence(historicalManifest, head, cwd, historicalRunner);
  // Only a missing obligation can be restored, and only after ALL identity,
  // pristine introduction, ancestry and evidence checks above have succeeded.
  if (verified.t1LiveDbPrecondition === 'deferred_to_ci') manifest.t1_live_db_precondition = verified.t1LiveDbPrecondition;
  return { source_commit: verified.sourceCommit, head_sha: head, merge_sha: merge, token_recreated: false };
}

/** WORK text alone is not a follow-up. Require its canonical lane at the
 * actual touching main commit, with repository PR identity and overlapping
 * owned scope. GitHub's merged history is the authority, never a new local file.
 */
export function hasCanonicalWorkFollowUp(
  workId: string,
  sha: string,
  overlappingPaths: string[],
  read: (args: string[]) => ReturnType<typeof git>,
  attest: (number: number) => WorkFollowUpPr | null = fetchWorkFollowUpPr,
): boolean {
  if (!/^WORK-\d+$/.test(workId) || !/^[0-9a-f]{40}$/i.test(sha)) return false;
  const blob = read(['show', `${sha}:docs/06_status/lanes/${workId}.json`]);
  if (!blob.ok) return false;
  try {
    const lane: unknown = JSON.parse(blob.stdout);
    if (!lane || typeof lane !== 'object' || Array.isArray(lane)) return false;
    const record = lane as Record<string, unknown>;
    const validLane = (
      record['issue_id'] === workId && record['schema_version'] === 2 && record['base_branch'] === 'main' &&
      typeof record['branch'] === 'string' && new RegExp(`^(?:claude|codex)/${workId.toLowerCase()}-[a-z0-9-]+$`).test(record['branch']) &&
      typeof record['pr_url'] === 'string' && /^https:\/\/github\.com\/griff843\/Unit-Talk-v2\/pull\/\d+$/.test(record['pr_url']) &&
      ['started', 'in_progress', 'in_review', 'merged', 'done'].includes(String(record['status'])) &&
      Array.isArray(record['file_scope_lock']) && overlappingPaths.every(path => (record['file_scope_lock'] as unknown[]).includes(path)) &&
      Array.isArray(record['expected_proof_paths']) && record['expected_proof_paths'].includes(`docs/06_status/proof/${workId}/evidence.json`) &&
      ['T1', 'T2', 'T3'].includes(String(record['tier']))
    );
    if (!validLane) return false;
    const number = Number(String(record['pr_url']).split('/').at(-1));
    const pr = attest(number);
    return !!pr && pr.number === number && pr.repository === 'griff843/Unit-Talk-v2' &&
      pr.merged && pr.mergeSha === sha && pr.baseRefName === 'main' &&
      pr.headRefName === record['branch'] && /^[0-9a-f]{40}$/i.test(pr.headSha);
  } catch { return false; }
}

export interface WorkFollowUpPr {
  number: number;
  repository: string;
  merged: boolean;
  mergeSha: string;
  headSha: string;
  headRefName: string;
  baseRefName: string;
}

function fetchWorkFollowUpPr(number: number): WorkFollowUpPr | null {
  try {
    const pr = JSON.parse(execFileSync('gh', [
      'api', `repos/griff843/Unit-Talk-v2/pulls/${number}`,
    ], { encoding: 'utf8', stdio: 'pipe' }));
    return {
      number: pr.number, repository: pr.base?.repo?.full_name,
      merged: pr.merged === true && typeof pr.merged_at === 'string',
      mergeSha: pr.merge_commit_sha, headSha: pr.head?.sha,
      headRefName: pr.head?.ref, baseRefName: pr.base?.ref,
    };
  } catch { return null; }
}
