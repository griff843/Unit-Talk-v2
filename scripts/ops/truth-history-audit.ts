/**
 * ops:truth-history-audit — inventory non-canonical truth_check_history
 * entries across every lane manifest (UTV2-1613).
 *
 * ## Why this is an inventory and not a cleanup
 *
 * `ops:lane-close --repair-merged` wrote synthesized `verdict: 'pass'` entries
 * for a long time, under the non-canonical runner
 * `ops:lane-close --repair-merged`. Those entries are still sitting in
 * committed manifests. Deleting them here would be the same class of mistake
 * that created them: a tool silently rewriting the governance record with no
 * PR, no review, and no trace of what changed.
 *
 * So this command is strictly read-only. It never opens a file for writing,
 * and it exits 0 even when it finds fabrications -- its job is to make the
 * scale of the problem measurable so historical repair lanes can correct
 * specific manifests through governed PRs, each with its own diff.
 *
 * `--strict` is available for the one place where failing is right: guarding
 * against NEW fabrications appearing after this lane lands. Point it at a
 * baseline count and it fails when the count grows.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  MANIFEST_DIR,
  emitJson,
  parseArgs,
  type LaneManifest,
  type TruthCheckHistoryEntry,
} from './shared.js';
import { CANONICAL_TRUTH_CHECK_RUNNERS, isCanonicalRunner } from './lane-close-repair-packet.js';

/**
 * The exact runner string the defective repair path persisted. Called out
 * separately from "any non-canonical runner" so the report can distinguish
 * this known, understood population from anything unexpected.
 */
export const FABRICATED_REPAIR_RUNNER = 'ops:lane-close --repair-merged';

export type TruthHistoryFindingKind =
  | 'fabricated_repair_pass'
  | 'fabricated_repair_entry'
  | 'non_canonical_runner';

export interface TruthHistoryFinding {
  issue_id: string;
  manifest_status: string;
  entry_index: number;
  kind: TruthHistoryFindingKind;
  runner: unknown;
  verdict: unknown;
  checked_at: unknown;
  merge_sha: unknown;
}

export interface TruthHistoryAuditReport {
  schema_version: 1;
  scanned_manifests: number;
  affected_manifests: number;
  findings: TruthHistoryFinding[];
  fabricated_pass_count: number;
  canonical_runners: readonly string[];
}

/**
 * Classifies a single history entry. Returns null for a clean entry.
 *
 * A `pass` written by the repair runner is called out separately from any
 * other repair-runner entry because it is the one that actually misleads: a
 * fabricated `fail` would have been conservative, a fabricated `pass`
 * certifies work nobody measured.
 */
export function classifyHistoryEntry(entry: TruthCheckHistoryEntry): TruthHistoryFindingKind | null {
  const runner: unknown = entry.runner;
  if (runner === FABRICATED_REPAIR_RUNNER) {
    return entry.verdict === 'pass' ? 'fabricated_repair_pass' : 'fabricated_repair_entry';
  }
  if (!isCanonicalRunner(runner)) {
    return 'non_canonical_runner';
  }
  return null;
}

export function auditManifests(manifests: LaneManifest[]): TruthHistoryAuditReport {
  const findings: TruthHistoryFinding[] = [];
  const affected = new Set<string>();

  for (const manifest of manifests) {
    const history = manifest.truth_check_history ?? [];
    history.forEach((entry, index) => {
      const kind = classifyHistoryEntry(entry);
      if (kind === null) return;
      affected.add(manifest.issue_id);
      findings.push({
        issue_id: manifest.issue_id,
        manifest_status: String(manifest.status),
        entry_index: index,
        kind,
        runner: entry.runner,
        verdict: entry.verdict,
        checked_at: entry.checked_at,
        merge_sha: entry.merge_sha,
      });
    });
  }

  return {
    schema_version: 1,
    scanned_manifests: manifests.length,
    affected_manifests: affected.size,
    findings,
    fabricated_pass_count: findings.filter((finding) => finding.kind === 'fabricated_repair_pass')
      .length,
    canonical_runners: CANONICAL_TRUTH_CHECK_RUNNERS,
  };
}

/** Reads every lane manifest without validating it -- a malformed manifest is
 *  someone else's failure mode, and skipping it must not hide the rest. */
export function readManifestsForAudit(manifestDir = MANIFEST_DIR): LaneManifest[] {
  if (!fs.existsSync(manifestDir)) return [];
  const manifests: LaneManifest[] = [];
  for (const entry of fs.readdirSync(manifestDir)) {
    if (!entry.endsWith('.json')) continue;
    try {
      manifests.push(
        JSON.parse(fs.readFileSync(path.join(manifestDir, entry), 'utf8')) as LaneManifest,
      );
    } catch {
      continue;
    }
  }
  return manifests;
}

export function main(argv = process.argv.slice(2)): number {
  const { flags, bools } = parseArgs(argv);
  const manifestDir = flags.get('manifest-dir')?.at(-1) ?? MANIFEST_DIR;
  const report = auditManifests(readManifestsForAudit(manifestDir));

  const baselineFlag = flags.get('max-fabricated-passes')?.at(-1);
  const baseline = baselineFlag === undefined ? null : Number.parseInt(baselineFlag, 10);
  const strict = bools.has('strict') && baseline !== null;
  const exceeded = strict && report.fabricated_pass_count > (baseline ?? 0);

  emitJson({
    ok: !exceeded,
    code: exceeded ? 'fabricated_history_grew' : 'truth_history_audited',
    ...report,
    baseline_fabricated_passes: baseline,
    note:
      'Read-only inventory (UTV2-1613). Fabricated entries are deliberately NOT deleted here — ' +
      'each must be corrected by a governed PR so the correction itself is reviewable.',
  });

  return exceeded ? 1 : 0;
}

const argv1 = process.argv[1] ?? '';
if (argv1.endsWith('truth-history-audit.ts') || argv1.endsWith('truth-history-audit.js')) {
  process.exit(main());
}
