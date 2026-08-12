import { emitJson, parseArgs, requireIssueId, validateTier } from './shared.js';
import { runTruthCheck } from './truth-check-lib.js';

async function main(): Promise<void> {
  const { positionals, flags, bools } = parseArgs(process.argv.slice(2));
  const issueId = requireIssueId(positionals[0] ?? '');

  try {
    const result = await runTruthCheck({
      issueId,
      json: bools.has('json'),
      tierOverride: flags.has('tier') ? validateTier(flags.get('tier')!.at(-1)!) : undefined,
      sinceSha: flags.get('since')?.at(-1),
      noRuntime: bools.has('no-runtime'),
      // `--explain` is PRESENTATION-ONLY. It changes how checks are printed and
      // does not affect evaluation or persistence. It is NOT a safe/read-only
      // mode; use `--dry-run` for that (UTV2-1691).
      explain: bools.has('explain'),
      // UTV2-1691: run the full evaluation and report the verdict while writing
      // nothing — no truth_check_history entry, no heartbeat_at update, no
      // status transition, no reopen_history. A dry run diagnoses; it never
      // certifies, and cannot close a lane.
      dryRun: bools.has('dry-run'),
      runner: 'manual',
    });

    if (bools.has('json')) {
      // UTV2-1691 (review finding P2-1): the machine-readable markers are set in
      // finalizeWithManifest, but stamp defensively here too. `--json` is the
      // documented automation interface and must never emit a dry run that is
      // indistinguishable from a certifying live run.
      emitJson({
        ...result,
        dry_run: bools.has('dry-run'),
        certifies: !bools.has('dry-run'),
      });
    } else {
      if (bools.has('dry-run')) {
        console.log('=== DRY RUN — nothing was written; this diagnoses, it does not certify ===');
      }
      for (const check of result.checks) {
        console.log(`[${check.status.toUpperCase()}] ${check.id} - ${check.detail}`);
      }
      console.log(`VERDICT: ${result.verdict} (${result.checks.length} checks, ${result.failures.length} failures)`);
      if (bools.has('dry-run')) {
        // UTV2-1691 risk 3: a dry run reporting "would pass" must never be
        // mistaken for a passing gate. No history entry exists for this run, so
        // the lane is NOT closeable on the strength of this output alone.
        //
        // Review finding P2-2: the earlier wording here said "re-run without
        // --dry-run to close the lane", which is wrong. A live ops:truth-check
        // only appends the truth_check_history entry and refreshes heartbeat_at.
        // `status: done`, `closed_at`, the Linear transition and lock release are
        // all performed by ops:lane-close. Following the old instruction left the
        // lane merged and open.
        console.log(
          'DRY RUN: no truth_check_history entry was recorded, and nothing was closed.\n' +
            'A live `ops:truth-check` only records the gate result — it does NOT close the lane.\n' +
            'To actually close: `pnpm ops:lane-close <ISSUE>` (it runs truth-check internally, then sets\n' +
            'status=done + closed_at, transitions Linear, and releases the lane\'s locks).',
        );
      }
    }

    process.exit(result.exit_code);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (bools.has('json')) {
      emitJson({
        schema_version: 1,
        issue_id: issueId,
        tier: 'T3',
        verdict: 'infra_error',
        exit_code: 3,
        merge_sha: null,
        pr_url: null,
        checked_at: new Date().toISOString(),
        checks: [{ id: 'INFRA', status: 'fail', detail: message }],
        failures: ['INFRA'],
        reopen_reasons: [],
        manifest_path: `docs/06_status/lanes/${issueId}.json`,
      });
    } else {
      console.error(message);
    }
    process.exit(3);
  }
}

void main();
