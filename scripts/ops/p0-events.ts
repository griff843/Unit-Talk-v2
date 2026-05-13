/**
 * UTV2-949: P0 Protocol Failure Observability — ops:p0-events
 *
 * Aggregates P0 protocol gate failures from the last 7 days by:
 *   1. Fetching failed workflow runs for p0-protocol.yml via GitHub Actions API
 *   2. Downloading the p0-failure-event.json artifact from each run
 *   3. Printing a histogram of block_reason → count
 *   4. Mis-config check: verifies "P0 Protocol" is in required status checks
 *      for the main branch protection rule
 *
 * Requires GITHUB_TOKEN (or GH_TOKEN) in env.
 * Exits 0 always — never blocks CI.
 *
 * Usage: pnpm ops:p0-events [--days=N] [--json]
 */

import { loadEnvironment } from '@unit-talk/config';
import { git } from './shared.js';

// ── Types ──────────────────────────────────────────────────────────────────

interface P0FailureEvent {
  issue_id: string;
  pr: number;
  head_sha: string;
  block_reason: string;
  actor: string;
  timestamp: string;
  runbook: string;
}

interface WorkflowRun {
  id: number;
  name: string;
  conclusion: string | null;
  created_at: string;
  html_url: string;
  head_sha: string;
  pull_requests?: Array<{ number: number }>;
}

interface ArtifactListResponse {
  artifacts: Array<{
    id: number;
    name: string;
    expired: boolean;
  }>;
}

interface BranchProtection {
  required_status_checks?: {
    contexts: string[];
    checks?: Array<{ context: string; app_id: number | null }>;
  } | null;
}

// ── Config ─────────────────────────────────────────────────────────────────

const WORKFLOW_FILE = 'p0-protocol.yml';
const P0_CHECK_NAME = 'P0 Protocol';
const DEFAULT_LOOKBACK_DAYS = 7;

function parseArgs(): { lookbackDays: number; jsonMode: boolean } {
  const args = process.argv.slice(2);
  let lookbackDays = DEFAULT_LOOKBACK_DAYS;
  let jsonMode = false;
  for (const arg of args) {
    if (arg.startsWith('--days=')) {
      const n = parseInt(arg.slice('--days='.length), 10);
      if (Number.isFinite(n) && n > 0) lookbackDays = n;
    }
    if (arg === '--json') jsonMode = true;
  }
  return { lookbackDays, jsonMode };
}

function resolveRepoSlug(): string {
  const result = git(['remote', 'get-url', 'origin']);
  const match = result.stdout.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  if (!match) throw new Error(`Cannot parse repo slug from remote: ${result.stdout}`);
  return match[1]!;
}

function resolveToken(): string {
  const token =
    process.env.GITHUB_TOKEN?.trim() ||
    process.env.GH_TOKEN?.trim() ||
    (() => {
      try {
        const env = loadEnvironment();
        return (env as Record<string, string | undefined>)['GITHUB_TOKEN']?.trim() ?? '';
      } catch {
        return '';
      }
    })();
  return token;
}

// ── GitHub API helpers ──────────────────────────────────────────────────────

async function githubFetch<T>(
  url: string,
  token: string,
  accept = 'application/vnd.github+json',
): Promise<{ ok: boolean; data?: T; status: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: accept,
        'User-Agent': 'unit-talk-ops-p0-events',
      },
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, status: res.status };
    const data = (await res.json()) as T;
    return { ok: true, data, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFailedRuns(
  repoSlug: string,
  token: string,
  since: string,
): Promise<WorkflowRun[]> {
  const url =
    `https://api.github.com/repos/${repoSlug}/actions/workflows/${WORKFLOW_FILE}/runs` +
    `?status=failure&created=>=${encodeURIComponent(since)}&per_page=50`;
  const result = await githubFetch<{ workflow_runs: WorkflowRun[] }>(url, token);
  return result.data?.workflow_runs ?? [];
}

async function fetchArtifactList(
  repoSlug: string,
  runId: number,
  token: string,
): Promise<ArtifactListResponse['artifacts']> {
  const url = `https://api.github.com/repos/${repoSlug}/actions/runs/${runId}/artifacts`;
  const result = await githubFetch<ArtifactListResponse>(url, token);
  return result.data?.artifacts ?? [];
}

async function downloadArtifactZip(
  repoSlug: string,
  artifactId: number,
  token: string,
): Promise<Uint8Array | null> {
  // GitHub returns a 302 redirect to a signed URL
  const redirectUrl = `https://api.github.com/repos/${repoSlug}/actions/artifacts/${artifactId}/zip`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(redirectUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'unit-talk-ops-p0-events',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Extract p0-failure-event.json text from a ZIP archive (basic PKZIP parser). */
function extractJsonFromZip(zipBytes: Uint8Array): string | null {
  // Walk local file headers looking for p0-failure-event.json
  // PKZIP local file header signature: 0x04034b50
  const TARGET = 'p0-failure-event.json';
  let i = 0;
  while (i < zipBytes.length - 30) {
    if (
      zipBytes[i] === 0x50 &&
      zipBytes[i + 1] === 0x4b &&
      zipBytes[i + 2] === 0x03 &&
      zipBytes[i + 3] === 0x04
    ) {
      const compressionMethod = zipBytes[i + 8]! | (zipBytes[i + 9]! << 8);
      const compressedSize =
        zipBytes[i + 18]! |
        (zipBytes[i + 19]! << 8) |
        (zipBytes[i + 20]! << 16) |
        (zipBytes[i + 21]! << 24);
      const fileNameLength = zipBytes[i + 26]! | (zipBytes[i + 27]! << 8);
      const extraLength = zipBytes[i + 28]! | (zipBytes[i + 29]! << 8);
      const fileNameBytes = zipBytes.slice(i + 30, i + 30 + fileNameLength);
      const fileName = new TextDecoder().decode(fileNameBytes);
      const dataOffset = i + 30 + fileNameLength + extraLength;

      if (fileName === TARGET && compressionMethod === 0) {
        // Stored (no compression)
        const content = zipBytes.slice(dataOffset, dataOffset + compressedSize);
        return new TextDecoder().decode(content);
      }
      i = dataOffset + compressedSize;
    } else {
      i += 1;
    }
  }
  return null;
}

async function fetchBranchProtection(
  repoSlug: string,
  token: string,
  branch = 'main',
): Promise<BranchProtection | null> {
  const url = `https://api.github.com/repos/${repoSlug}/branches/${branch}/protection`;
  const result = await githubFetch<BranchProtection>(url, token);
  return result.data ?? null;
}

// ── Aggregation ────────────────────────────────────────────────────────────

interface P0EventsReport {
  schema_version: 1;
  run_at: string;
  lookback_days: number;
  since: string;
  total_failures: number;
  histogram: Array<{ block_reason: string; count: number }>;
  events: P0FailureEvent[];
  misconfig_check: {
    p0_protocol_required: boolean;
    detail: string;
  };
  infra_errors: string[];
}

async function main(): Promise<void> {
  const { lookbackDays, jsonMode } = parseArgs();
  const runAt = new Date().toISOString();
  const sinceDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const since = sinceDate.toISOString().slice(0, 10);
  const infra_errors: string[] = [];

  let repoSlug = '';
  try {
    repoSlug = resolveRepoSlug();
  } catch (err) {
    infra_errors.push(`Cannot resolve repo slug: ${err instanceof Error ? err.message : String(err)}`);
  }

  const token = resolveToken();
  if (!token) {
    infra_errors.push('GITHUB_TOKEN or GH_TOKEN not set — API calls will be skipped');
  }

  const events: P0FailureEvent[] = [];

  if (repoSlug && token) {
    let runs: WorkflowRun[] = [];
    try {
      runs = await fetchFailedRuns(repoSlug, token, since);
    } catch (err) {
      infra_errors.push(`Failed to fetch workflow runs: ${err instanceof Error ? err.message : String(err)}`);
    }

    for (const run of runs) {
      try {
        const artifacts = await fetchArtifactList(repoSlug, run.id, token);
        const p0Artifact = artifacts.find(
          (a) => a.name === 'p0-failure-event' && !a.expired,
        );
        if (!p0Artifact) continue;

        const zipBytes = await downloadArtifactZip(repoSlug, p0Artifact.id, token);
        if (!zipBytes) continue;

        const jsonText = extractJsonFromZip(zipBytes);
        if (!jsonText) continue;

        const parsed = JSON.parse(jsonText) as Partial<P0FailureEvent>;
        if (!parsed.block_reason || !parsed.issue_id) continue;

        events.push({
          issue_id: parsed.issue_id ?? '',
          pr: parsed.pr ?? 0,
          head_sha: parsed.head_sha ?? run.head_sha,
          block_reason: parsed.block_reason,
          actor: parsed.actor ?? '',
          timestamp: parsed.timestamp ?? run.created_at,
          runbook: parsed.runbook ?? 'docs/05_operations/P0_PROTOCOL_SPEC.md',
        });
      } catch (err) {
        infra_errors.push(
          `Run ${run.id}: artifact fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // Histogram
  const reasonCounts = new Map<string, number>();
  for (const ev of events) {
    reasonCounts.set(ev.block_reason, (reasonCounts.get(ev.block_reason) ?? 0) + 1);
  }
  const histogram = [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([block_reason, count]) => ({ block_reason, count }));

  // Mis-config check
  let misconfigCheck: P0EventsReport['misconfig_check'] = {
    p0_protocol_required: false,
    detail: 'skipped — no token or repo slug',
  };
  if (repoSlug && token) {
    try {
      const protection = await fetchBranchProtection(repoSlug, token);
      if (!protection) {
        misconfigCheck = {
          p0_protocol_required: false,
          detail: 'branch protection not configured or token lacks repo admin scope',
        };
      } else {
        const contexts = protection.required_status_checks?.contexts ?? [];
        const checks = protection.required_status_checks?.checks?.map((c) => c.context) ?? [];
        const allRequired = new Set([...contexts, ...checks]);
        const isRequired = allRequired.has(P0_CHECK_NAME);
        misconfigCheck = {
          p0_protocol_required: isRequired,
          detail: isRequired
            ? `"${P0_CHECK_NAME}" is present in required status checks`
            : `WARNING: "${P0_CHECK_NAME}" is NOT in required status checks — P0 gate can be bypassed`,
        };
      }
    } catch (err) {
      misconfigCheck = {
        p0_protocol_required: false,
        detail: `branch protection fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  const report: P0EventsReport = {
    schema_version: 1,
    run_at: runAt,
    lookback_days: lookbackDays,
    since,
    total_failures: events.length,
    histogram,
    events,
    misconfig_check: misconfigCheck,
    infra_errors,
  };

  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = 0;
    return;
  }

  console.log(`[p0-events] run_at=${runAt} lookback=${lookbackDays}d since=${since}`);
  console.log(`  total_failures: ${events.length}`);

  if (histogram.length > 0) {
    console.log('  block_reason histogram:');
    for (const { block_reason, count } of histogram) {
      console.log(`    ${count}x  ${block_reason}`);
    }
  } else {
    console.log('  no P0 failures in window — clean');
  }

  console.log(`  misconfig: ${misconfigCheck.detail}`);

  if (!misconfigCheck.p0_protocol_required && repoSlug && token) {
    console.warn(
      `  !! ACTION REQUIRED: add "${P0_CHECK_NAME}" to required status checks on main`,
    );
  }

  if (infra_errors.length > 0) {
    console.log(`  infra_errors: ${infra_errors.length}`);
    for (const e of infra_errors) {
      console.log(`    ${e}`);
    }
  }

  process.exitCode = 0;
}

void main().catch((err: unknown) => {
  console.error('[p0-events] fatal:', err instanceof Error ? err.message : String(err));
  process.exitCode = 0;
});
