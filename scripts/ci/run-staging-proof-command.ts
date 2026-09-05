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

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const env = collectEffectiveEnv();
  const decision = admit(options, env);

  if (decision.refused) {
    console.error(`[staging-proof-runner] REFUSED: ${decision.reason}`);
    process.exit(REFUSAL_EXIT_CODE);
  }

  const { command, receiptPath, assertion } = decision;
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
