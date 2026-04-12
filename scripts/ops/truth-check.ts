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
      explain: bools.has('explain'),
      runner: 'manual',
    });

    if (bools.has('json')) {
      emitJson(result);
    } else {
      for (const check of result.checks) {
        console.log(`[${check.status.toUpperCase()}] ${check.id} - ${check.detail}`);
      }
      console.log(`VERDICT: ${result.verdict} (${result.checks.length} checks, ${result.failures.length} failures)`);
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
