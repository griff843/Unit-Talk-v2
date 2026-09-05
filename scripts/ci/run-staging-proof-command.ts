/**
 * UTV2-1827 — execute one allowlisted proof command against the approved
 * staging project and emit a receipt the lane author cannot fabricate.
 *
 * ## The security model, in one paragraph
 *
 * The only thing a dispatcher chooses is a KEY. The key resolves, in this
 * repository, to a fixed argv (`scripts/ci/staging-proof-commands.ts`), which is
 * spawned with no shell. Before the spawn, the resolved Supabase target must be
 * positively the approved staging project — the same `assertStagingTarget` gate
 * every other writable path in this repository passes, so production is refused
 * by identity rather than by convention. Credentials are read from the process
 * environment the `staging-ci` job materialized; they are never echoed, never
 * written to the receipt, and never passed as arguments.
 *
 * Every failure mode is closed:
 *
 *   * unknown / empty / path-shaped / shell-shaped key  -> exit 78, no spawn
 *   * unresolvable, production, or non-staging target   -> exit 78, no spawn
 *   * missing --receipt path                            -> exit 78, no spawn
 *
 * Exit 78 (EX_CONFIG) is used for every refusal so a refusal is never confused
 * with the proof command's own non-zero exit, which is passed through verbatim.
 */
import { mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertStagingTarget, type StagingAssertion } from './assert-staging-target.js';
import { collectEffectiveEnv } from './required-db-smoke.js';
import { buildCiProofReceipt, serializeReceipt } from './isolated-proof-attestation.js';
import {
  formatCommand,
  resolveStagingProofCommand,
  type StagingProofCommand,
} from './staging-proof-commands.js';

/** Refusal exit code. Distinct from any exit the proof command itself produces. */
export const REFUSAL_EXIT_CODE = 78;

export interface RunnerOptions {
  commandKey: string | null;
  receiptPath: string | null;
}

export function parseArgs(argv: readonly string[]): RunnerOptions {
  const options: RunnerOptions = { commandKey: null, receiptPath: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--command-key') {
      options.commandKey = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (argv[i] === '--receipt') {
      options.receiptPath = argv[i + 1] ?? null;
      i += 1;
    }
  }
  return options;
}

export interface Refusal {
  refused: true;
  reason: string;
}

export interface Admission {
  refused: false;
  command: StagingProofCommand;
  receiptPath: string;
  assertion: StagingAssertion;
}

/**
 * Decide whether this invocation may run, without running anything.
 *
 * Separated from the spawn so the negative cases are testable without a
 * database, a network, or a credential.
 */
export function admit(
  options: RunnerOptions,
  env: Record<string, string | undefined>,
): Refusal | Admission {
  if (!options.receiptPath) {
    return { refused: true, reason: 'missing required --receipt <path>' };
  }
  if (options.commandKey === null) {
    return { refused: true, reason: 'missing required --command-key <key>' };
  }

  let command: StagingProofCommand;
  try {
    command = resolveStagingProofCommand(options.commandKey);
  } catch (error) {
    return { refused: true, reason: error instanceof Error ? error.message : String(error) };
  }

  const assertion = assertStagingTarget(env);
  if (!assertion.ok) {
    return { refused: true, reason: assertion.reason };
  }

  return { refused: false, command, receiptPath: options.receiptPath, assertion };
}

/**
 * Ref admission — the control the registry cannot provide on its own.
 *
 * The registry is only as trustworthy as the commit it is read from. A
 * dispatcher who can push a branch can also rewrite
 * `staging-proof-commands.ts` on that branch and then dispatch it, which would
 * hand staging credentials to an argv nobody reviewed. So the executed commit
 * must be reachable from the default branch: the registry that admits the
 * command is then, necessarily, the reviewed one.
 *
 * Fails closed on "cannot tell". An indeterminate ancestry check — shallow
 * clone, missing remote ref, git failure — is refused rather than assumed
 * benign, because the whole value of this gate is that it is not guessable.
 */
export interface RefAdmission {
  ok: boolean;
  reason: string;
}

export function admitRef(input: {
  headSha: string | null;
  isAncestorOfDefault: boolean | null;
}): RefAdmission {
  if (!input.headSha) {
    return { ok: false, reason: 'could not resolve the checked-out commit' };
  }
  if (input.isAncestorOfDefault === null) {
    return {
      ok: false,
      reason:
        `could not determine whether ${input.headSha} is reachable from the default branch; `
        + 'refusing rather than assuming it is',
    };
  }
  if (!input.isAncestorOfDefault) {
    return {
      ok: false,
      reason:
        `${input.headSha} is not reachable from the default branch, so the command registry at `
        + 'this ref is unreviewed. Merge the ref first, or dispatch a ref that is already on main.',
    };
  }
  return { ok: true, reason: `${input.headSha} is reachable from the default branch` };
}

/** Resolve the two facts `admitRef` needs, from git. Never throws. */
export function readRefFacts(defaultBranchRef: string): {
  headSha: string | null;
  isAncestorOfDefault: boolean | null;
} {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  const headSha = head.status === 0 ? (head.stdout ?? '').trim() || null : null;
  if (!headSha) return { headSha: null, isAncestorOfDefault: null };

  const ancestry = spawnSync(
    'git',
    ['merge-base', '--is-ancestor', headSha, defaultBranchRef],
    { encoding: 'utf8' },
  );
  // git exits 0 for "is an ancestor", 1 for "is not", and anything else for a
  // real failure (unknown ref, shallow clone). Only 0 and 1 are answers.
  if (ancestry.status === 0) return { headSha, isAncestorOfDefault: true };
  if (ancestry.status === 1) return { headSha, isAncestorOfDefault: false };
  return { headSha, isAncestorOfDefault: null };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const env = collectEffectiveEnv();
  const decision = admit(options, env);

  if (decision.refused) {
    console.error(`[staging-proof-runner] REFUSED: ${decision.reason}`);
    process.exit(REFUSAL_EXIT_CODE);
  }

  const { command, receiptPath, assertion } = decision;

  const defaultBranchRef = process.env['STAGING_PROOF_DEFAULT_BRANCH_REF'] ?? 'origin/main';
  const refFacts = readRefFacts(defaultBranchRef);
  const refDecision = admitRef(refFacts);
  if (!refDecision.ok) {
    console.error(`[staging-proof-runner] REFUSED: ${refDecision.reason}`);
    process.exit(REFUSAL_EXIT_CODE);
  }
  console.log(`[staging-proof-runner] ref admitted: ${refDecision.reason}`);

  // Identity only — never a credential.
  console.log(
    `[staging-proof-runner] key=${command.key} issue=${command.issue} `
      + `writes=${command.writes} ref=${assertion.observedRef ?? 'unidentified'}`,
  );
  console.log(`[staging-proof-runner] argv=${JSON.stringify(command.argv)}`);

  const startedAt = new Date().toISOString();
  const [executable, ...args] = command.argv;
  const result = spawnSync(executable as string, args, {
    // No shell. The argv is fixed by the registry; nothing is interpolated.
    shell: false,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  const finishedAt = new Date().toISOString();

  const capturedOutput = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');

  const exitCode = result.status;
  const receipt = buildCiProofReceipt({
    supabaseUrl: env['SUPABASE_URL'],
    // The key is part of the command identity: two keys can never collapse into
    // one indistinguishable receipt.
    command: `${command.key}: ${formatCommand(command)}`,
    startedAt,
    finishedAt,
    exitCode,
    capturedOutput,
  });

  mkdirSync(path.dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, serializeReceipt(receipt), 'utf8');
  console.log(`[staging-proof-runner] receipt written: ${receiptPath}`);
  console.log(`[staging-proof-runner] receipt_sha256=${receipt.receipt_sha256}`);

  // The shared receipt schema carries run, job, sha, command, target and exit
  // status but no actor, so the dispatch identity is written beside it rather
  // than by widening a structure four other workflows already verify. The
  // receipt's own hash is carried here, which is what ties the two together.
  const dispatchPath = path.join(path.dirname(receiptPath), 'staging-proof-dispatch.json');
  writeFileSync(
    dispatchPath,
    `${JSON.stringify(
      {
        schema: 'staging-proof-dispatch/v1',
        command_key: command.key,
        command_issue: command.issue,
        command_argv: command.argv,
        declares_writes: command.writes,
        requested_ref: process.env['GITHUB_REF_NAME'] ?? null,
        executed_sha: refFacts.headSha,
        reachable_from_default_branch: refFacts.isAncestorOfDefault,
        actor: process.env['GITHUB_ACTOR'] ?? null,
        triggering_actor: process.env['GITHUB_TRIGGERING_ACTOR'] ?? null,
        run_id: process.env['GITHUB_RUN_ID'] ?? null,
        run_attempt: process.env['GITHUB_RUN_ATTEMPT'] ?? null,
        observed_project_ref: assertion.observedRef,
        started_at: startedAt,
        finished_at: finishedAt,
        exit_code: exitCode,
        receipt_path: receiptPath,
        receipt_sha256: receipt.receipt_sha256 ?? null,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  console.log(`[staging-proof-runner] dispatch identity written: ${dispatchPath}`);

  if (result.error) {
    console.error(`[staging-proof-runner] spawn failed: ${result.error.message}`);
    process.exit(REFUSAL_EXIT_CODE);
  }
  // Pass the proof command's own status through verbatim.
  process.exit(exitCode ?? REFUSAL_EXIT_CODE);
}

const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main();
}
