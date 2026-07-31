/**
 * Lane-close repair packet (schema v2) — UTV2-1613.
 *
 * ## Why this module exists
 *
 * `ops:lane-close --repair-merged` used to synthesize a `truth_check_history`
 * entry with `verdict: 'pass'`, `failures: []` and `runner:
 * 'ops:lane-close --repair-merged'` *before* the canonical truth-check ran.
 * In the manifest that entry was indistinguishable from a real measured pass
 * -- but nothing had been measured. PR #1312 / UTV2-1592 proved the
 * consequence: an authoritative-looking passing governance record existed
 * while the proof bundle was still invalid, and the fabricated entry had to be
 * deleted by hand before a genuine truth-check could produce a real pass. The
 * runner value was also outside the canonical union
 * (`TruthCheckHistoryEntry['runner']`), so the manifest carried a record no
 * canonical runner ever produced.
 *
 * ## The distinction this module enforces
 *
 * Repair conflates three genuinely different things. This module keeps them
 * apart, as three fields with three separate provenances:
 *
 *   1. `merge_binding` -- INFERRED. Mechanically derived from authoritative
 *      GitHub merge state (which PR, which head ref, which merge commit).
 *      A fact about GitHub, not a claim about the lane's quality.
 *   2. `proposed_manifest` / `changed_fields` -- PROPOSED. The tracked-file
 *      repair that would be written. A proposal, not an outcome.
 *   3. `truth_check` -- MEASURED. What `runTruthCheck` actually returned when
 *      it actually ran, or an explicit `executed: false` receipt when it did
 *      not run at all.
 *
 * A pass can only come from (3), and only when (3) genuinely executed and
 * genuinely returned a passing verdict with exit code 0. No code path here can
 * produce a passing history entry from (1) or (2).
 * `truthHistoryEntryForMeasuredReceipt()` is the ONLY history-entry
 * constructor offered, and it returns `null` rather than a pass whenever the
 * receipt is unexecuted.
 *
 * ## Fail-closed application
 *
 * A packet is generated at one moment and applied at another. Between those
 * moments the on-disk manifest can change, the packet file can be edited, and
 * the merge authority on GitHub can move. `applyRepairPacket()` refuses in all
 * three cases by comparing hashes and authority recorded at generation time
 * against what is true at application time. Stale application is a refusal,
 * never a silent overwrite.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  emitJson,
  issueToManifestPath,
  parseArgs,
  readManifest,
  requireIssueId,
  validateManifest,
  writeManifest,
  type LaneManifest,
  type TruthCheckHistoryEntry,
  type TruthCheckResult,
} from './shared.js';

export const REPAIR_PACKET_SCHEMA_VERSION = 2 as const;

/**
 * The canonical runner union, mirrored from `TruthCheckHistoryEntry['runner']`
 * as a runtime value. The type alone cannot stop a synthesized string literal
 * that was cast, widened, or written by an older build from reaching the
 * manifest -- this array is what `assertCanonicalRunner()` checks at runtime.
 */
export const CANONICAL_TRUTH_CHECK_RUNNERS: readonly TruthCheckHistoryEntry['runner'][] = [
  'ops:lane-close',
  'ops:reconcile',
  'manual',
];

export class NonCanonicalRunnerError extends Error {
  readonly runner: unknown;

  constructor(runner: unknown) {
    super(
      `Non-canonical truth-check runner ${JSON.stringify(runner)}. ` +
        `Allowed runners: ${CANONICAL_TRUTH_CHECK_RUNNERS.join(', ')}. ` +
        'A truth_check_history entry may only be attributed to a canonical runner ' +
        '(UTV2-1613: "ops:lane-close --repair-merged" was never one).',
    );
    this.name = 'NonCanonicalRunnerError';
    this.runner = runner;
  }
}

export function isCanonicalRunner(value: unknown): value is TruthCheckHistoryEntry['runner'] {
  return (
    typeof value === 'string' &&
    (CANONICAL_TRUTH_CHECK_RUNNERS as readonly string[]).includes(value)
  );
}

export function assertCanonicalRunner(value: unknown): TruthCheckHistoryEntry['runner'] {
  if (!isCanonicalRunner(value)) {
    throw new NonCanonicalRunnerError(value);
  }
  return value;
}

/**
 * Authoritative GitHub merge state for the PR this repair binds to. Every
 * field is read from GitHub, never from the manifest being repaired -- the
 * manifest is the thing being corrected, so it cannot be its own authority.
 */
export interface MergeBindingInference {
  source: 'github_pull_request';
  repository: string;
  pr_url: string;
  pr_number: number | null;
  head_ref: string | null;
  merge_sha: string;
  inferred_at: string;
  /**
   * How the PR was selected. `manifest_pr_url`: the manifest already named it.
   * `branch_merged_head`: the manifest had no pr_url and the PR was resolved
   * from the lane branch's merged pull request -- the ghost-lane case
   * (UTV2-1553: status `started`, pr_url null, PR long merged).
   * `explicit_pr`: a trusted caller supplied it.
   */
  selected_by: 'manifest_pr_url' | 'branch_merged_head' | 'explicit_pr';
}

export type MeasuredVerdict = TruthCheckResult['verdict'];

/**
 * The measured outcome of a canonical truth-check run, or an explicit record
 * that no run happened. `executed: false` is a first-class state, not an
 * absence -- an absent receipt would be indistinguishable from a lost one.
 */
export interface MeasuredTruthCheckReceipt {
  executed: boolean;
  command: string;
  runner: TruthCheckHistoryEntry['runner'];
  checked_at: string | null;
  verdict: MeasuredVerdict | null;
  exit_code: number | null;
  failures: string[];
  check_ids: string[];
  merge_sha: string | null;
  /**
   * Hash of the exact candidate manifest state the truth-check evaluated. A
   * pass measured against one state must never be credited to a different
   * state -- this ties (3) back to (2).
   */
  evaluated_state_hash: string | null;
}

export interface LaneCloseRepairPacket {
  schema_version: typeof REPAIR_PACKET_SCHEMA_VERSION;
  issue_id: string;
  generated_at: string;
  /** The exact command that generated this packet. */
  command: string;
  /** Hash of the manifest as it existed on disk before repair. */
  input_manifest_hash: string;
  /** Hash of `proposed_manifest`. Detects a hand-edited packet. */
  candidate_manifest_hash: string;
  merge_binding: MergeBindingInference | null;
  proposed_manifest: LaneManifest;
  changed_fields: string[];
  truth_check: MeasuredTruthCheckReceipt;
}

// ── Hashing ───────────────────────────────────────────────────────────────────

/**
 * Key-order-independent JSON serialization. Two manifests differing only in
 * property insertion order are the same state and must hash identically, or
 * every rewrite through a different code path would look like tampering.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

export function hashState(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableStringify(value), 'utf8').digest('hex')}`;
}

export function hashManifestFile(issueId: string, repoRoot = process.cwd()): string | null {
  const relative = issueToManifestPath(issueId);
  const manifestPath = path.isAbsolute(relative) ? relative : path.join(repoRoot, relative);
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  try {
    return hashState(JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown);
  } catch {
    return null;
  }
}

// ── Measured receipts ─────────────────────────────────────────────────────────

/**
 * The receipt for a truth-check that did NOT run. Constructed explicitly so a
 * caller that skips measurement still produces a record, and so that record
 * can never be mistaken for a pass: `verdict` is null, not 'pass'.
 */
export function unexecutedTruthCheckReceipt(input: {
  command: string;
  runner?: TruthCheckHistoryEntry['runner'];
  mergeSha?: string | null;
  evaluatedStateHash?: string | null;
}): MeasuredTruthCheckReceipt {
  return {
    executed: false,
    command: input.command,
    runner: assertCanonicalRunner(input.runner ?? 'ops:lane-close'),
    checked_at: null,
    verdict: null,
    exit_code: null,
    failures: [],
    check_ids: [],
    merge_sha: input.mergeSha ?? null,
    evaluated_state_hash: input.evaluatedStateHash ?? null,
  };
}

/**
 * Builds a receipt from a real `runTruthCheck()` result. Every field is copied
 * from the result -- nothing defaults to a passing value. `check_ids` records
 * which gates actually ran, so a pass measured over three checks is
 * distinguishable from a pass measured over thirty.
 */
export function measuredTruthCheckReceipt(input: {
  command: string;
  runner: TruthCheckHistoryEntry['runner'];
  result: TruthCheckResult;
  evaluatedStateHash: string | null;
}): MeasuredTruthCheckReceipt {
  return {
    executed: true,
    command: input.command,
    runner: assertCanonicalRunner(input.runner),
    checked_at: input.result.checked_at,
    verdict: input.result.verdict,
    exit_code: input.result.exit_code,
    failures: [...input.result.failures],
    check_ids: input.result.checks.map((check) => check.id),
    merge_sha: input.result.merge_sha,
    evaluated_state_hash: input.evaluatedStateHash,
  };
}

export function isMeasuredPass(receipt: MeasuredTruthCheckReceipt): boolean {
  return receipt.executed && receipt.verdict === 'pass' && receipt.exit_code === 0;
}

/**
 * The ONLY history-entry constructor in this module.
 *
 * Returns `null` for an unexecuted receipt -- an unrun truth-check records
 * nothing at all rather than an optimistic placeholder. For an
 * executed-but-failing receipt it returns the measured failure (a real record
 * of a real run), never a pass. A `verdict: 'pass'` entry is reachable from
 * exactly one input: a receipt that executed and passed.
 */
export function truthHistoryEntryForMeasuredReceipt(
  receipt: MeasuredTruthCheckReceipt,
): TruthCheckHistoryEntry | null {
  if (!receipt.executed || receipt.checked_at === null) {
    return null;
  }
  const runner = assertCanonicalRunner(receipt.runner);
  if (isMeasuredPass(receipt)) {
    return {
      checked_at: receipt.checked_at,
      verdict: 'pass',
      merge_sha: receipt.merge_sha,
      failures: [],
      runner,
    };
  }
  return {
    checked_at: receipt.checked_at,
    verdict: receipt.verdict === 'reopen' ? 'reopen' : 'fail',
    merge_sha: receipt.merge_sha,
    failures: [...receipt.failures],
    runner,
  };
}

// ── Packet construction ───────────────────────────────────────────────────────

export function buildRepairPacket(input: {
  issueId: string;
  command: string;
  inputManifest: LaneManifest;
  proposedManifest: LaneManifest;
  changedFields: string[];
  mergeBinding: MergeBindingInference | null;
  truthCheck: MeasuredTruthCheckReceipt;
  now?: Date;
}): LaneCloseRepairPacket {
  return {
    schema_version: REPAIR_PACKET_SCHEMA_VERSION,
    issue_id: input.issueId.toUpperCase(),
    generated_at: (input.now ?? new Date()).toISOString(),
    command: input.command,
    input_manifest_hash: hashState(input.inputManifest),
    candidate_manifest_hash: hashState(input.proposedManifest),
    merge_binding: input.mergeBinding,
    proposed_manifest: input.proposedManifest,
    changed_fields: [...input.changedFields],
    truth_check: input.truthCheck,
  };
}

export function repairPacketPath(issueId: string, artifactRoot: string): string {
  return path.join(artifactRoot, `${issueId.toUpperCase()}.repair-packet.json`);
}

export function writeRepairPacket(
  packet: LaneCloseRepairPacket,
  options: { artifactRoot: string },
): string {
  fs.mkdirSync(options.artifactRoot, { recursive: true });
  const packetPath = repairPacketPath(packet.issue_id, options.artifactRoot);
  fs.writeFileSync(packetPath, `${JSON.stringify(packet, null, 2)}\n`);
  return packetPath;
}

export function readRepairPacket(packetPath: string): LaneCloseRepairPacket {
  return JSON.parse(fs.readFileSync(packetPath, 'utf8')) as LaneCloseRepairPacket;
}

/**
 * Structural validation. Returns error strings rather than throwing so the
 * apply path reports every problem at once instead of one per invocation.
 */
export function validateRepairPacket(packet: unknown): string[] {
  const errors: string[] = [];
  if (typeof packet !== 'object' || packet === null) {
    return ['repair packet must be an object'];
  }
  const value = packet as Partial<LaneCloseRepairPacket>;
  if (value.schema_version !== REPAIR_PACKET_SCHEMA_VERSION) {
    errors.push(
      `schema_version must be ${REPAIR_PACKET_SCHEMA_VERSION} (got ${JSON.stringify(value.schema_version)})`,
    );
  }
  if (typeof value.issue_id !== 'string' || value.issue_id.trim() === '') {
    errors.push('issue_id is required');
  }
  if (typeof value.command !== 'string' || value.command.trim() === '') {
    errors.push('command is required');
  }
  if (typeof value.generated_at !== 'string' || Number.isNaN(Date.parse(value.generated_at))) {
    errors.push('generated_at must be ISO-8601');
  }
  if (
    typeof value.input_manifest_hash !== 'string' ||
    !value.input_manifest_hash.startsWith('sha256:')
  ) {
    errors.push('input_manifest_hash must be a sha256: hash');
  }
  if (
    typeof value.candidate_manifest_hash !== 'string' ||
    !value.candidate_manifest_hash.startsWith('sha256:')
  ) {
    errors.push('candidate_manifest_hash must be a sha256: hash');
  }
  if (typeof value.proposed_manifest !== 'object' || value.proposed_manifest === null) {
    errors.push('proposed_manifest is required');
  }
  if (!Array.isArray(value.changed_fields)) {
    errors.push('changed_fields must be an array');
  }

  const receipt = value.truth_check;
  if (typeof receipt !== 'object' || receipt === null) {
    errors.push('truth_check receipt is required');
  } else {
    if (typeof receipt.executed !== 'boolean') {
      errors.push('truth_check.executed must be a boolean');
    }
    if (!isCanonicalRunner(receipt.runner)) {
      errors.push(
        `truth_check.runner must be one of ${CANONICAL_TRUTH_CHECK_RUNNERS.join(', ')} (got ${JSON.stringify(receipt.runner)})`,
      );
    }
    // Defense in depth: a packet claiming a verdict while recording that no
    // run happened is exactly the UTV2-1613 defect, expressed in packet form.
    if (receipt.executed === false && (receipt.verdict !== null || receipt.exit_code !== null)) {
      errors.push(
        'truth_check claims a verdict/exit_code while executed is false — an unexecuted truth-check has no outcome',
      );
    }
  }

  const binding = value.merge_binding;
  if (binding !== null && binding !== undefined) {
    if (typeof binding.merge_sha !== 'string' || binding.merge_sha.trim() === '') {
      errors.push('merge_binding.merge_sha is required when merge_binding is present');
    }
    if (typeof binding.pr_url !== 'string' || binding.pr_url.trim() === '') {
      errors.push('merge_binding.pr_url is required when merge_binding is present');
    }
    if (binding.source !== 'github_pull_request') {
      errors.push('merge_binding.source must be github_pull_request');
    }
  }

  return errors;
}

// ── Fail-closed application ───────────────────────────────────────────────────

export type RepairPacketApplyCode =
  | 'repair_packet_applied'
  | 'repair_packet_schema_invalid'
  | 'repair_packet_issue_mismatch'
  | 'repair_packet_input_drift'
  | 'repair_packet_candidate_tampered'
  | 'repair_packet_authority_changed'
  | 'repair_packet_unmeasured_pass';

export interface RepairPacketApplyResult {
  ok: boolean;
  code: RepairPacketApplyCode;
  issue_id: string;
  message: string;
  errors: string[];
}

export interface LiveMergeAuthority {
  pr_url: string;
  merge_sha: string | null;
  head_ref: string | null;
}

/**
 * Applies a packet's proposed manifest, refusing on any drift between the
 * state the packet was generated against and the state that exists now.
 *
 * Three independent, individually fatal drift classes:
 *   - input drift: the on-disk manifest is no longer what the packet was
 *     computed from, so the proposal derives from a state that no longer
 *     exists.
 *   - candidate tampering: the packet's own `proposed_manifest` no longer
 *     hashes to the `candidate_manifest_hash` recorded at generation, so the
 *     packet file was edited after it was produced.
 *   - authority change: GitHub's merge state for the bound PR moved, so the
 *     inferred binding is stale.
 *
 * A packet whose truth_check receipt is unexecuted is still applicable -- it
 * repairs the merge binding only. What it can never do is carry a pass: the
 * receipt is copied verbatim, and `truthHistoryEntryForMeasuredReceipt()` (the
 * only path to a history entry) returns null for it.
 */
export function applyRepairPacket(
  packet: LaneCloseRepairPacket,
  options: {
    issueId?: string;
    readCurrentManifest?: (issueId: string) => LaneManifest | null;
    fetchMergeAuthority?: (prUrl: string) => LiveMergeAuthority | null;
    write?: (manifest: LaneManifest) => void;
  } = {},
): RepairPacketApplyResult {
  const schemaErrors = validateRepairPacket(packet);
  if (schemaErrors.length > 0) {
    return {
      ok: false,
      code: 'repair_packet_schema_invalid',
      issue_id: String((packet as Partial<LaneCloseRepairPacket>)?.issue_id ?? ''),
      message: 'Repair packet failed schema validation; refusing to apply.',
      errors: schemaErrors,
    };
  }

  const issueId = (options.issueId ?? packet.issue_id).toUpperCase();
  if (issueId !== packet.issue_id.toUpperCase()) {
    return {
      ok: false,
      code: 'repair_packet_issue_mismatch',
      issue_id: issueId,
      message: `Repair packet is for ${packet.issue_id}, not ${issueId}; refusing to apply.`,
      errors: [],
    };
  }

  if (!packet.truth_check.executed && packet.truth_check.verdict === 'pass') {
    return {
      ok: false,
      code: 'repair_packet_unmeasured_pass',
      issue_id: issueId,
      message:
        'Repair packet claims a passing truth-check that never executed; refusing to apply (UTV2-1613).',
      errors: [],
    };
  }

  const readCurrent =
    options.readCurrentManifest ??
    ((id: string): LaneManifest | null => {
      try {
        return readManifest(id);
      } catch {
        return null;
      }
    });
  const current = readCurrent(issueId);
  if (current === null) {
    return {
      ok: false,
      code: 'repair_packet_input_drift',
      issue_id: issueId,
      message: `No manifest found for ${issueId}; the packet's input state no longer exists.`,
      errors: [],
    };
  }
  const currentHash = hashState(current);
  if (currentHash !== packet.input_manifest_hash) {
    return {
      ok: false,
      code: 'repair_packet_input_drift',
      issue_id: issueId,
      message:
        `Manifest for ${issueId} changed since this packet was generated ` +
        `(expected ${packet.input_manifest_hash}, found ${currentHash}). Regenerate the packet.`,
      errors: [],
    };
  }

  const candidateHash = hashState(packet.proposed_manifest);
  if (candidateHash !== packet.candidate_manifest_hash) {
    return {
      ok: false,
      code: 'repair_packet_candidate_tampered',
      issue_id: issueId,
      message:
        'Packet proposed_manifest does not match its recorded candidate hash ' +
        `(expected ${packet.candidate_manifest_hash}, computed ${candidateHash}). The packet was edited after generation.`,
      errors: [],
    };
  }

  if (packet.merge_binding && options.fetchMergeAuthority) {
    const live = options.fetchMergeAuthority(packet.merge_binding.pr_url);
    if (
      live === null ||
      live.merge_sha !== packet.merge_binding.merge_sha ||
      (packet.merge_binding.head_ref !== null && live.head_ref !== packet.merge_binding.head_ref)
    ) {
      return {
        ok: false,
        code: 'repair_packet_authority_changed',
        issue_id: issueId,
        message:
          `GitHub merge authority for ${packet.merge_binding.pr_url} no longer matches the packet ` +
          `(packet merge_sha ${packet.merge_binding.merge_sha}, live ${live?.merge_sha ?? 'unresolvable'}). Regenerate the packet.`,
        errors: [],
      };
    }
  }

  const manifestErrors = validateManifest(packet.proposed_manifest);
  if (manifestErrors.length > 0) {
    return {
      ok: false,
      code: 'repair_packet_schema_invalid',
      issue_id: issueId,
      message: 'Packet proposed_manifest is not a valid lane manifest; refusing to apply.',
      errors: manifestErrors,
    };
  }

  (options.write ?? writeManifest)(packet.proposed_manifest);
  return {
    ok: true,
    code: 'repair_packet_applied',
    issue_id: issueId,
    message: `Applied repair packet for ${issueId} (${packet.changed_fields.join(', ') || 'no field changes'}).`,
    errors: [],
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function usage(): void {
  console.error(
    'Usage:\n' +
      '  pnpm ops:lane-repair-packet apply <UTV2-###> [--packet <path>]\n' +
      '  pnpm ops:lane-repair-packet show <UTV2-###> [--packet <path>]\n',
  );
}

export function main(argv = process.argv.slice(2)): number {
  const { positionals, flags } = parseArgs(argv);
  const command = positionals[0];
  if (command !== 'apply' && command !== 'show') {
    usage();
    return 1;
  }

  try {
    const issueId = requireIssueId(positionals[1] ?? '');
    const defaultRoot = path.join(process.cwd(), '.out', 'ops', 'lane-close-repair');
    const packetPath = flags.get('packet')?.at(-1) ?? repairPacketPath(issueId, defaultRoot);
    if (!fs.existsSync(packetPath)) {
      emitJson({
        ok: false,
        code: 'repair_packet_missing',
        issue_id: issueId,
        message: `No repair packet at ${packetPath}. Run ops:lane-close --repair-merged to generate one.`,
      });
      return 1;
    }

    const packet = readRepairPacket(packetPath);
    if (command === 'show') {
      const errors = validateRepairPacket(packet);
      emitJson({
        ok: errors.length === 0,
        code: 'repair_packet_read',
        issue_id: issueId,
        packet_path: packetPath,
        errors,
        merge_binding: packet.merge_binding,
        changed_fields: packet.changed_fields,
        truth_check: packet.truth_check,
        measured_pass: isMeasuredPass(packet.truth_check),
      });
      return errors.length === 0 ? 0 : 1;
    }

    const result = applyRepairPacket(packet, { issueId });
    emitJson({ ...result, packet_path: packetPath });
    return result.ok ? 0 : 1;
  } catch (error) {
    emitJson({
      ok: false,
      code: 'repair_packet_error',
      message: error instanceof Error ? error.message : String(error),
    });
    return 1;
  }
}

const argv1 = process.argv[1] ?? '';
if (
  argv1.endsWith('lane-close-repair-packet.ts') ||
  argv1.endsWith('lane-close-repair-packet.js')
) {
  process.exit(main());
}
