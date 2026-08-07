/**
 * UTV2-1630 — refuse to execute PR-authored code with a production credential.
 *
 * ## The hole this closes
 *
 * Two pull-request-triggered jobs legitimately need to READ production:
 * `shadow-parity-required.yml` (scoring parity must observe real data) and
 * `live-schema-parity.yml` (the live schema is the thing being compared). Both
 * check out `github.event.pull_request.head.sha` and then run a script from
 * that same checkout with `SUPABASE_SERVICE_ROLE_KEY` / a superuser Postgres
 * URL in the environment.
 *
 * Their safety rests entirely on what those scripts do — `--dry-run`,
 * "catalog reads only". But the pull request supplies the script. A PR that
 * touches one file in the trigger's path filter may also rewrite the runner
 * beside it, and the job will execute the rewritten version against production.
 * The path filter decides *whether* the job runs; the checkout decides *what
 * runs*. Those are not the same control.
 *
 * This is the same defect class the lane fixed in `proof-regression.yml`, where
 * proof scripts were selected by a grep over the changed-file list. There it was
 * fixed by removing the production credential. Here the credential is the point,
 * so the fix is the other half: pin the code.
 *
 * ## What it does
 *
 * Fails if any named path differs between the merge base and the PR head. Run
 * it BEFORE the credential-bearing step, so a PR that modifies a
 * production-touching script cannot execute its own version — it has to land
 * the change through a PR that does not carry the credential.
 *
 * Fails closed: unknown base, unreadable git history, and missing arguments all
 * exit non-zero rather than assuming the tree is clean.
 */
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface UnmodifiedCheck {
  ok: boolean;
  modified: string[];
  reason: string;
}

export function assertUnmodified(
  paths: string[],
  base: string,
  head: string,
  diff: (base: string, head: string, paths: string[]) => string,
): UnmodifiedCheck {
  if (paths.length === 0) {
    return { ok: false, modified: [], reason: 'no paths supplied — refusing to vacuously pass' };
  }
  if (!base.trim() || !head.trim()) {
    return { ok: false, modified: [], reason: 'base or head ref missing — cannot establish a comparison' };
  }

  let raw: string;
  try {
    raw = diff(base, head, paths);
  } catch (error) {
    return {
      ok: false,
      modified: [],
      reason: `git diff failed (${error instanceof Error ? error.message : String(error)}) — failing closed`,
    };
  }

  const modified = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();

  if (modified.length > 0) {
    return {
      ok: false,
      modified,
      reason:
        'this pull request modifies code that a production-credentialed job executes. ' +
        'Land the change through a pull request that does not carry a production credential, ' +
        'then rebase this one.',
    };
  }

  return { ok: true, modified: [], reason: 'all guarded paths are identical to the merge base' };
}

function gitDiff(base: string, head: string, paths: string[]): string {
  return execFileSync('git', ['diff', '--name-only', `${base}...${head}`, '--', ...paths], {
    encoding: 'utf8',
  });
}

function main(): void {
  const args = process.argv.slice(2);
  const readFlag = (name: string): string | null => {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] ? (args[index + 1] as string) : null;
  };

  const base = readFlag('--base') ?? process.env['GITHUB_BASE_REF'] ?? '';
  const head = readFlag('--head') ?? 'HEAD';
  const paths = args.filter((arg) => !arg.startsWith('--') && arg !== base && arg !== head);

  const resolvedBase = base.startsWith('origin/') || /^[0-9a-f]{7,40}$/u.test(base) ? base : `origin/${base}`;

  const result = assertUnmodified(paths, resolvedBase, head, gitDiff);
  console.log(`[assert-unmodified] base=${resolvedBase} head=${head} guarded=${paths.length}`);
  if (!result.ok) {
    for (const path of result.modified) console.error(`  modified: ${path}`);
    console.error(`[assert-unmodified] REFUSED: ${result.reason}`);
    process.exit(1);
  }
  console.log(`[assert-unmodified] OK: ${result.reason}`);
}

function isCliEntrypoint(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return realpathSync(invoked) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isCliEntrypoint()) {
  main();
}
