/**
 * scripts/ops/proof-repair.ts
 *
 * Governed, additive-only repair path for a T1 lane that merged to `main`
 * without the runtime evidence `scripts/ops/truth-check-lib.ts`'s
 * `runtime_proof_required` gate requires unconditionally for tier T1
 * (checks C6, P7, P9, P10, R1, R2, R3).
 *
 * Built in response to a real incident (see
 * docs/06_status/INCIDENTS/INC-2026-07-14-utv2-1533-direct-main-push.md): when that
 * gate failed post-merge, no scripted, governed alternative existed to "just push a
 * new commit" — an operator hand-edited proof files and pushed directly to `main`,
 * bypassing docs/05_operations/DIRECT_MAIN_BYPASS_POLICY.md with no emergency
 * exception recorded. This script exists so the objectively-easiest next action is
 * always "open a small PR," never "edit main directly."
 *
 * Design contract (do not weaken any of these without a new governance PR):
 *
 * 1. This module NEVER runs `git push`, NEVER targets `main` for a write, and NEVER
 *    invokes any admin/bypass merge path. It only reads/writes files in the current
 *    working tree. Landing the result is the operator's job, via a normal PR — see
 *    the `scaffold` command's printed instructions.
 * 2. This module NEVER runs `pnpm test:db` itself and NEVER fabricates test output,
 *    query evidence, or row counts. `apply` requires a `--runtime-proof-file` that
 *    was produced by a real, separately-run `pnpm test:db` invocation, and validates
 *    its internal shape strictly (non-empty queries/row_counts, fail === 0, pass ===
 *    tests) before accepting it. If that file is missing, malformed, or reports any
 *    failure, `apply` fails closed with a specific, actionable message — it never
 *    silently substitutes empty/placeholder evidence.
 * 3. This module NEVER writes `sha_binding.merge_sha`. That field is owned
 *    exclusively by `scripts/ops/proof-generate.ts`'s `rebindEvidenceJsonSha` (the
 *    pre-existing, narrowly-scoped, bot-safe mechanism already permitted to write to
 *    `main` via `SYNC_BOT_TOKEN` in `post-merge-lane-close.yml`, because rebinding an
 *    already-known, externally-immutable merge SHA is a referential operation, not an
 *    evidentiary claim). `apply` only *reads* `sha_binding.merge_sha` to confirm the
 *    caller's `--merge-sha` matches what proof-generate already bound; if it does not
 *    match (or is not yet bound at all), `apply` refuses to proceed — this is the
 *    mechanical guarantee that a later proof-repair pass can never be mislabeled as,
 *    or silently drift into, the original implementation merge SHA.
 * 4. `apply` merges in only the specific missing top-level keys (`verifier`,
 *    `runtime_proof`) via a shallow object merge on the existing parsed JSON. Every
 *    other key — including hand-authored narrative sections like `continuation`,
 *    `scope`, `codex_review_round_1`, etc. — passes through byte-identical. This is
 *    the same additive-merge shape `rebindEvidenceJsonSha` already uses for
 *    `sha_binding`, extended to the two fields that were previously only ever added
 *    by hand.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ROOT,
  emitJson,
  getFlag,
  parseArgs,
  relativeToRoot,
  requireIssueId,
} from './shared.js';

export interface RuntimeProofFile {
  command: string;
  supabase_project: string;
  test_file: string;
  tests: number;
  pass: number;
  fail: number;
  queries: Array<{ table: string; description: string }>;
  row_counts: Array<{ table: string; count: number; status: string }>;
  row_counts_captured_at?: string;
  row_counts_note?: string;
  [key: string]: unknown;
}

export interface ProofRepairScaffold {
  issue_id: string;
  branch: string;
  steps: string[];
}

export interface ProofRepairApplyResult {
  ok: boolean;
  code:
    | 'repaired'
    | 'evidence_missing'
    | 'evidence_unparseable'
    | 'merge_sha_not_bound'
    | 'merge_sha_mismatch'
    | 'runtime_proof_file_missing'
    | 'runtime_proof_file_invalid'
    | 'runtime_proof_reports_failure'
    | 'verifier_identity_required'
    | 'verifier_identity_matches_creator'
    | 'already_repaired';
  message: string;
  evidence_path?: string;
  changed?: boolean;
}

const RUNTIME_PROOF_REQUIRED_FIELDS: Array<keyof RuntimeProofFile> = [
  'command',
  'supabase_project',
  'test_file',
  'tests',
  'pass',
  'fail',
  'queries',
  'row_counts',
];

/**
 * Prints the exact governed repair path for a given issue: a dedicated branch name,
 * the worktree/branch creation command, the real `pnpm test:db` run the operator must
 * perform, the `apply` invocation that consumes its captured output, and the PR-open
 * step. Pure text generation — touches no files, runs no git commands. Safe to call
 * from any checkout, including the shared main checkout, without side effects.
 */
export function buildProofRepairScaffold(issueId: string): ProofRepairScaffold {
  const normalizedIssue = issueId.toUpperCase();
  const slug = normalizedIssue.toLowerCase();
  const branch = `claude/${slug}-proof-repair`;
  return {
    issue_id: normalizedIssue,
    branch,
    steps: [
      `git worktree add .out/worktrees/${branch.replace(/\//g, '__')} -b ${branch} origin/main`,
      `cd .out/worktrees/${branch.replace(/\//g, '__')} && pnpm install --frozen-lockfile`,
      `pnpm test:db   # run for real against live Supabase; capture the TAP output and any query/row-count evidence you print`,
      `# Hand-author a runtime-proof-file (e.g. /tmp/${slug}-runtime-proof.json) matching RuntimeProofFile's shape in scripts/ops/proof-repair.ts, from the ACTUAL command output above -- never copy an old lane's evidence`,
      `pnpm ops:proof-repair apply --issue ${normalizedIssue} --merge-sha <the already-bound implementation merge SHA from docs/06_status/proof/${normalizedIssue}/evidence.json's sha_binding.merge_sha> --runtime-proof-file /tmp/${slug}-runtime-proof.json --verifier-identity ${branch}`,
      `git add docs/06_status/proof/${normalizedIssue}/ && git commit -m "chore(proof): ${normalizedIssue} add runtime proof via governed repair"`,
      `git push -u origin ${branch}`,
      `gh pr create --base main --title "${normalizedIssue}: add missing T1 runtime proof" --body "Adds runtime_proof/verifier to the already-merged lane's evidence bundle via the governed proof-repair path. Never edits main directly."`,
      `# Wait for CI (verify, T1 Proof Gate, Runtime Verifier Gate, Merge Gate) green, then merge through the normal PR path -- never --admin, never a direct push.`,
    ],
  };
}

function readJsonRecord(absolutePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(absolutePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function validateRuntimeProofFile(value: unknown): { ok: true; proof: RuntimeProofFile } | { ok: false; reason: string } {
  if (!value || typeof value !== 'object') {
    return { ok: false, reason: 'runtime-proof-file must contain a JSON object' };
  }
  const record = value as Record<string, unknown>;
  const missing = RUNTIME_PROOF_REQUIRED_FIELDS.filter((field) => !(field in record));
  if (missing.length > 0) {
    return { ok: false, reason: `runtime-proof-file is missing required field(s): ${missing.join(', ')}` };
  }
  const tests = record.tests;
  const pass = record.pass;
  const fail = record.fail;
  if (typeof tests !== 'number' || typeof pass !== 'number' || typeof fail !== 'number') {
    return { ok: false, reason: 'runtime-proof-file tests/pass/fail must be numbers' };
  }
  if (fail !== 0) {
    return { ok: false, reason: `runtime-proof-file reports ${fail} failing test(s) -- refusing to record proof of a failing pnpm test:db run` };
  }
  if (pass !== tests) {
    return { ok: false, reason: `runtime-proof-file reports pass (${pass}) !== tests (${tests}) -- refusing to record inconsistent evidence` };
  }
  if (!Array.isArray(record.queries) || record.queries.length === 0) {
    return { ok: false, reason: 'runtime-proof-file.queries must be a non-empty array (live DB query evidence)' };
  }
  if (!Array.isArray(record.row_counts) || record.row_counts.length === 0) {
    return { ok: false, reason: 'runtime-proof-file.row_counts must be a non-empty array (live monitored-table row counts)' };
  }
  return { ok: true, proof: record as unknown as RuntimeProofFile };
}

export interface ApplyProofRepairInput {
  issueId: string;
  mergeSha: string;
  runtimeProof: RuntimeProofFile;
  verifierIdentity: string;
  manifestCreatedBy?: string | undefined;
  evidenceAbsolutePath: string;
  write?: boolean | undefined;
}

/**
 * Pure function (no fs access) that performs the additive merge described in this
 * module's header. Exported separately from `applyProofRepair` so tests can exercise
 * the merge/validation logic without touching disk.
 */
export function mergeRuntimeProofIntoEvidence(
  existing: Record<string, unknown>,
  input: Omit<ApplyProofRepairInput, 'evidenceAbsolutePath' | 'write'>,
): { ok: true; next: Record<string, unknown> } | { ok: false; result: ProofRepairApplyResult } {
  const shaBinding = existing['sha_binding'];
  const boundMergeSha =
    shaBinding && typeof shaBinding === 'object'
      ? (shaBinding as Record<string, unknown>)['merge_sha']
      : undefined;

  if (typeof boundMergeSha !== 'string' || boundMergeSha.trim().length === 0) {
    return {
      ok: false,
      result: {
        ok: false,
        code: 'merge_sha_not_bound',
        message:
          'evidence.json has no sha_binding.merge_sha bound yet. Run `pnpm ops:proof-generate --merge-sha <sha>` first ' +
          '(the existing, bot-safe SHA-rebind mechanism) -- proof-repair never invents or writes a merge SHA itself.',
      },
    };
  }
  if (boundMergeSha !== input.mergeSha) {
    return {
      ok: false,
      result: {
        ok: false,
        code: 'merge_sha_mismatch',
        message:
          `--merge-sha ${input.mergeSha} does not match evidence.json's already-bound sha_binding.merge_sha ` +
          `${boundMergeSha}. proof-repair refuses to proceed against a mismatched SHA -- this is the guard that ` +
          'prevents a later repair pass from ever being mislabeled as, or silently drifting into, the original ' +
          'implementation merge SHA.',
      },
    };
  }

  const verifierIdentity = input.verifierIdentity.trim();
  if (!verifierIdentity) {
    return {
      ok: false,
      result: { ok: false, code: 'verifier_identity_required', message: '--verifier-identity is required and must be non-empty' },
    };
  }
  if (input.manifestCreatedBy && verifierIdentity === input.manifestCreatedBy) {
    return {
      ok: false,
      result: {
        ok: false,
        code: 'verifier_identity_matches_creator',
        message: `--verifier-identity (${verifierIdentity}) must not equal the lane's manifest.created_by (${input.manifestCreatedBy}); truth-check's P10/R3 checks require a distinct verifier identity.`,
      },
    };
  }

  const existingRuntimeProof = existing['runtime_proof'];
  const existingVerifier = existing['verifier'];
  const alreadyRepaired =
    existingRuntimeProof &&
    typeof existingRuntimeProof === 'object' &&
    Array.isArray((existingRuntimeProof as Record<string, unknown>).queries) &&
    ((existingRuntimeProof as Record<string, unknown>).queries as unknown[]).length > 0 &&
    existingVerifier &&
    typeof existingVerifier === 'object' &&
    typeof (existingVerifier as Record<string, unknown>).identity === 'string';

  if (alreadyRepaired) {
    return {
      ok: false,
      result: {
        ok: false,
        code: 'already_repaired',
        message: 'evidence.json already has populated verifier + runtime_proof sections -- proof-repair is idempotent and will not overwrite existing evidentiary content. No changes made.',
        changed: false,
      },
    };
  }

  // Additive-only merge: every existing key survives untouched. Only `verifier` and
  // `runtime_proof` are set, and sha_binding is never touched here (see module header).
  const next: Record<string, unknown> = {
    ...existing,
    verifier: { identity: verifierIdentity },
    runtime_proof: input.runtimeProof,
  };

  return { ok: true, next };
}

export function applyProofRepair(input: ApplyProofRepairInput): ProofRepairApplyResult {
  const existing = readJsonRecord(input.evidenceAbsolutePath);
  if (existing === null) {
    if (!fs.existsSync(input.evidenceAbsolutePath)) {
      return {
        ok: false,
        code: 'evidence_missing',
        message: `No evidence bundle found at ${relativeToRoot(input.evidenceAbsolutePath)}. proof-repair only patches an existing bundle -- it never creates one from scratch.`,
      };
    }
    return {
      ok: false,
      code: 'evidence_unparseable',
      message: `${relativeToRoot(input.evidenceAbsolutePath)} is not valid JSON. Refusing to touch a file proof-repair cannot safely parse and re-serialize without risking corruption of hand-authored content.`,
    };
  }

  const merged = mergeRuntimeProofIntoEvidence(existing, {
    issueId: input.issueId,
    mergeSha: input.mergeSha,
    runtimeProof: input.runtimeProof,
    verifierIdentity: input.verifierIdentity,
    manifestCreatedBy: input.manifestCreatedBy,
  });
  if (!merged.ok) {
    return merged.result;
  }

  if (input.write ?? true) {
    fs.writeFileSync(input.evidenceAbsolutePath, `${JSON.stringify(merged.next, null, 2)}\n`, 'utf8');
  }

  return {
    ok: true,
    code: 'repaired',
    message: `Added verifier + runtime_proof to ${relativeToRoot(input.evidenceAbsolutePath)}. All other keys (including hand-authored narrative sections) are byte-identical to the pre-repair file.`,
    evidence_path: relativeToRoot(input.evidenceAbsolutePath),
    changed: true,
  };
}

function evidencePathForIssue(issueId: string): string {
  return path.join(ROOT, 'docs', '06_status', 'proof', issueId.toUpperCase(), 'evidence.json');
}

function main(argv = process.argv.slice(2)): number {
  const { positionals, flags, bools } = parseArgs(argv);
  const command = positionals[0];

  if (command === 'scaffold') {
    const issueId = requireIssueId(getFlag(flags, 'issue') ?? positionals[1] ?? '');
    const scaffold = buildProofRepairScaffold(issueId);
    if (bools.has('json')) {
      emitJson(scaffold);
    } else {
      process.stdout.write(`Governed proof-repair path for ${scaffold.issue_id}\n\n`);
      process.stdout.write(`Branch: ${scaffold.branch}\n\n`);
      scaffold.steps.forEach((step, index) => {
        process.stdout.write(`${index + 1}. ${step}\n`);
      });
    }
    return 0;
  }

  if (command === 'apply') {
    const issueId = requireIssueId(getFlag(flags, 'issue') ?? positionals[1] ?? '');
    const mergeSha = getFlag(flags, 'merge-sha');
    const runtimeProofFilePath = getFlag(flags, 'runtime-proof-file');
    const verifierIdentity = getFlag(flags, 'verifier-identity');
    const manifestCreatedBy = getFlag(flags, 'manifest-created-by');
    const evidencePathFlag = getFlag(flags, 'evidence-path');

    if (!mergeSha) {
      emitJson({ ok: false, code: 'merge_sha_required', message: '--merge-sha is required' });
      return 1;
    }
    if (!runtimeProofFilePath) {
      emitJson({ ok: false, code: 'runtime_proof_file_required', message: '--runtime-proof-file is required' });
      return 1;
    }
    if (!verifierIdentity) {
      emitJson({ ok: false, code: 'verifier_identity_required', message: '--verifier-identity is required' });
      return 1;
    }

    const runtimeProofAbsolutePath = path.resolve(ROOT, runtimeProofFilePath);
    if (!fs.existsSync(runtimeProofAbsolutePath)) {
      const result: ProofRepairApplyResult = {
        ok: false,
        code: 'runtime_proof_file_missing',
        message: `--runtime-proof-file ${runtimeProofFilePath} does not exist. Run a real \`pnpm test:db\` first and capture its output -- proof-repair never fabricates runtime evidence.`,
      };
      emitJson(result);
      return 1;
    }
    const rawRuntimeProof = readJsonRecord(runtimeProofAbsolutePath);
    const validated = validateRuntimeProofFile(rawRuntimeProof);
    if (!validated.ok) {
      const result: ProofRepairApplyResult = {
        ok: false,
        code: rawRuntimeProof === null ? 'runtime_proof_file_invalid' : 'runtime_proof_reports_failure',
        message: validated.reason,
      };
      emitJson(result);
      return 1;
    }

    const evidenceAbsolutePath = evidencePathFlag
      ? path.resolve(ROOT, evidencePathFlag)
      : evidencePathForIssue(issueId);

    const result = applyProofRepair({
      issueId,
      mergeSha,
      runtimeProof: validated.proof,
      verifierIdentity,
      manifestCreatedBy,
      evidenceAbsolutePath,
      write: !bools.has('dry-run'),
    });

    emitJson(result);
    return result.ok ? 0 : 1;
  }

  process.stderr.write(
    'Usage:\n' +
      '  pnpm ops:proof-repair scaffold --issue UTV2-### [--json]\n' +
      '  pnpm ops:proof-repair apply --issue UTV2-### --merge-sha <sha> --runtime-proof-file <path> --verifier-identity <id> [--dry-run]\n',
  );
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
