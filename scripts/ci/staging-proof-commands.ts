/**
 * UTV2-1827 — the repository-owned allowlist of proof commands that a lane may
 * execute against the approved staging project.
 *
 * ## Why an allowlist rather than a command input
 *
 * A lane that needs staging credentials currently has exactly two options: use
 * a workflow whose command is hardcoded, or edit a shared Tier C workflow from
 * inside the lane. UTV2-1773 proved the first is not enough — no existing
 * `staging-ci` runner can execute its lane-owned
 * `scripts/run-canonical-reference-bootstrap.ts`, so its required first-run +
 * second-run idempotency proof is mechanically unreachable. The second is worse:
 * it widens the lane onto the merge-critical workflow surface to obtain a
 * receipt.
 *
 * The obvious fix — accept the command as a dispatch input — would trade a
 * capability gap for a generic remote-execution and secret-exfiltration
 * interface, in the one job that holds `staging-ci` credentials. So the dispatch
 * input is a KEY, and the argv it names lives here, in the repository, changed
 * only through a reviewed PR.
 *
 * ## What a key is, precisely
 *
 * `argv` is an explicit array that is spawned WITHOUT a shell. There is no
 * interpolation point: a key resolves to a fixed argv or it does not resolve at
 * all. Nothing a dispatcher types reaches the command line, so shell
 * metacharacters, path traversal and added flags are not "rejected" by a filter
 * that could be bypassed — they have nowhere to enter.
 *
 * ## What is deliberately NOT here
 *
 * UTV2-1771's June partition preservation. Its command needs a superuser
 * Postgres connection (`SUPABASE_DB_URL`), which is a strictly broader credential
 * than the project-scoped `CI_SUPABASE_*` keys this runner releases. Admitting
 * it would broaden secret authority, which UTV2-1827 explicitly forbids, so it
 * stays out until it can be expressed against the same credential set.
 */

/** One admitted command. `argv` is spawned directly — never through a shell. */
export interface StagingProofCommand {
  /** Dispatch input value. Kebab-case; must match the workflow's choice list. */
  readonly key: string;
  /** Exact argv. argv[0] is the executable; nothing is interpolated. */
  readonly argv: readonly string[];
  /** The issue this key exists to unblock. */
  readonly issue: string;
  /** What the command does, for the receipt and the dispatch UI. */
  readonly description: string;
  /**
   * True when the command writes to the target. Read-only keys still run under
   * the staging assertion — the assertion is about which project may be touched
   * at all, not about the direction of the touch.
   */
  readonly writes: boolean;
}

export const STAGING_PROOF_COMMANDS: readonly StagingProofCommand[] = Object.freeze([
  Object.freeze({
    key: 'canonical-reference-bootstrap',
    argv: Object.freeze(['pnpm', 'exec', 'tsx', 'scripts/run-canonical-reference-bootstrap.ts']),
    issue: 'UTV2-1773',
    description:
      'Run the canonical reference bootstrap RPC and print its per-league summary. '
      + 'Idempotent by construction; UTV2-1773 proves that by dispatching this key twice.',
    writes: true,
  }),
  Object.freeze({
    key: 'canonical-reference-bootstrap-report',
    argv: Object.freeze(['pnpm', 'exec', 'tsx', 'scripts/report-canonical-reference-bootstrap.ts']),
    issue: 'UTV2-1773',
    description: 'Read back canonical reference coverage without mutating it.',
    writes: false,
  }),
]);

export const STAGING_PROOF_COMMAND_KEYS: readonly string[] = Object.freeze(
  STAGING_PROOF_COMMANDS.map((command) => command.key),
);

export class UnknownStagingProofCommandError extends Error {
  constructor(readonly requestedKey: string) {
    super(
      `Unknown staging proof command key: ${JSON.stringify(requestedKey)}. `
      + `Admitted keys: ${STAGING_PROOF_COMMAND_KEYS.join(', ')}. `
      + 'Keys are declared in scripts/ci/staging-proof-commands.ts and can only be added by a reviewed PR.',
    );
    this.name = 'UnknownStagingProofCommandError';
  }
}

/**
 * Resolve a dispatch input to its admitted command.
 *
 * Fails closed on anything that is not an exact key match — including an empty
 * string, a path, a shell fragment, or a key that differs only in case.
 */
export function resolveStagingProofCommand(requestedKey: string): StagingProofCommand {
  const match = STAGING_PROOF_COMMANDS.find((command) => command.key === requestedKey);
  if (!match) {
    throw new UnknownStagingProofCommandError(requestedKey);
  }
  return match;
}

/** Human-readable form for logs and the receipt's `command` field. */
export function formatCommand(command: StagingProofCommand): string {
  return command.argv.join(' ');
}
