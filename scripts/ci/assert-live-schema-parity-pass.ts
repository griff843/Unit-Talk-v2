#!/usr/bin/env tsx
/**
 * Asserts that the "Live Schema Parity" check-run for a given commit SHA reached a real
 * PASS (conclusion === 'success'). Fail-closed: a missing, skipped, cancelled, failed, or
 * never-concluding parity run does NOT satisfy the assertion.
 *
 * This is the anti-gaming backstop for the schema-only-lane C2 proof exception (UTV2-1274):
 * a schema-only migration/parity lane may satisfy the T1 "live-DB proof" requirement (C2)
 * with the read-only Live Schema Parity run instead of `pnpm test:db`, BUT only if that
 * parity run actually reached PASS on this PR's head commit. The exception never weakens
 * proof for normal runtime/data/scoring/API lanes — those still require `pnpm test:db`.
 *
 * Live Schema Parity and the proof gates run in parallel on the same `pull_request` event,
 * so this polls the check-run until it concludes (bounded) rather than reading it once.
 *
 * Usage:
 *   tsx scripts/ci/assert-live-schema-parity-pass.ts --sha <head-sha> [--check-name "Live Schema Parity"]
 * Env: GITHUB_REPOSITORY (owner/repo), GITHUB_TOKEN.
 */

const CHECK_NAME_DEFAULT = 'Live Schema Parity';
const POLL_INTERVAL_MS = 15_000;
const TIMEOUT_MS = 12 * 60_000; // 12 minutes — parity runs ~3–4 min; generous margin.

interface CheckRun {
  name: string;
  status: string; // queued | in_progress | completed
  conclusion: string | null; // success | failure | cancelled | skipped | ...
  html_url?: string;
}

function parseArgs(argv: string[]): { sha: string; checkName: string } {
  let sha = '';
  let checkName = CHECK_NAME_DEFAULT;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sha' && argv[i + 1]) sha = argv[++i]!;
    else if (argv[i] === '--check-name' && argv[i + 1]) checkName = argv[++i]!;
  }
  return { sha, checkName };
}

async function fetchCheckRuns(repo: string, sha: string, token: string, checkName: string): Promise<CheckRun[]> {
  const url = `https://api.github.com/repos/${repo}/commits/${sha}/check-runs?check_name=${encodeURIComponent(checkName)}&per_page=100`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} fetching check-runs: ${await res.text()}`);
  }
  const body = (await res.json()) as { check_runs?: CheckRun[] };
  return body.check_runs ?? [];
}

async function main(): Promise<void> {
  const { sha, checkName } = parseArgs(process.argv.slice(2));
  const repo = process.env.GITHUB_REPOSITORY ?? '';
  const token = process.env.GITHUB_TOKEN ?? '';

  if (!sha) throw new Error('--sha <head-sha> is required');
  if (!repo) throw new Error('GITHUB_REPOSITORY is required');
  if (!token) throw new Error('GITHUB_TOKEN is required');

  console.log(`Asserting "${checkName}" PASS for ${repo}@${sha.slice(0, 8)} (fail-closed)…`);

  const deadline = Date.now() + TIMEOUT_MS;
  let lastStatus = 'unknown';

  // Bounded poll: wait for the parity check to conclude, then require success.
  // (Date.now is fine here — this is a CI assertion script, not a workflow journal.)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const runs = await fetchCheckRuns(repo, sha, token, checkName);
    // If multiple runs exist for the name, the latest concluded one wins; otherwise track status.
    const completed = runs.filter((r) => r.status === 'completed');
    if (completed.length > 0) {
      // Most recent completed run (API returns newest first within the name filter).
      const run = completed[0]!;
      if (run.conclusion === 'success') {
        console.log(`PASS: "${checkName}" concluded success for ${sha.slice(0, 8)}.`);
        if (run.html_url) console.log(`  ${run.html_url}`);
        return;
      }
      console.error(
        `::error title=Schema parity proof not satisfied::"${checkName}" concluded "${run.conclusion}" (not success) for ${sha.slice(0, 8)}. ` +
          `A schema-only lane's C2 proof requires an actual PASS — a failed/skipped/cancelled parity run does not satisfy it.`,
      );
      process.exit(1);
    }

    lastStatus = runs.length > 0 ? (runs[0]!.status ?? 'unknown') : 'not-found';
    if (Date.now() >= deadline) {
      console.error(
        `::error title=Schema parity proof not satisfied::Timed out after ${Math.round(
          TIMEOUT_MS / 60000,
        )}m waiting for "${checkName}" to conclude on ${sha.slice(0, 8)} (last status: ${lastStatus}). ` +
          `Fail-closed: cannot accept the schema-parity C2 proof without an observed PASS.`,
      );
      process.exit(1);
    }
    console.log(`  "${checkName}" status=${lastStatus}; waiting ${POLL_INTERVAL_MS / 1000}s…`);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`::error title=Schema parity proof not satisfied::${message}`);
  process.exit(1);
});
