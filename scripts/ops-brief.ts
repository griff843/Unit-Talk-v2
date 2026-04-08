import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnvironment } from '@unit-talk/config';

// ─── Repo Root ────────────────────────────────────────────────────────────────

function findRepoRoot(): string {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return result.status === 0 ? result.stdout.trim() : process.cwd();
}

const ROOT = findRepoRoot();

type SectionResult = {
  name: string;
  ok: boolean;
  lines: string[];
};

type RepoContext = {
  branch: string;
  dirtyCount: number;
  inferredIssueId: string | null;
};

type BriefState = {
  repo: RepoContext;
  issueId: string | null;
  pickIds: string[];
  sections: SectionResult[];
  recommendation: string[];
};

const env = loadEnvironment();
const args = process.argv.slice(2);
const json = args.includes('--json');
const explicitIssueId = readOption('issue');
const pickIds = readMultiOption('pick');

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main(): Promise<void> {
  const repo = readRepoContext();
  const issueId = explicitIssueId ?? repo.inferredIssueId;

  const sections: SectionResult[] = [
    buildOverviewSection(repo, issueId, pickIds),
    buildCodexLanesSection(),
    buildLinearSection(issueId),
    buildGitHubSection(),
    buildPipelineSection(),
    buildProofSection(issueId, pickIds),
  ];
  sections.push(buildCloseoutSection(issueId, pickIds, sections));

  const state: BriefState = {
    repo,
    issueId,
    pickIds,
    sections,
    recommendation: buildRecommendation(repo, issueId, pickIds, sections),
  };

  if (json) {
    console.log(JSON.stringify(state, null, 2));
    return;
  }

  printSection({
    name: 'Recommendation',
    ok: true,
    lines: state.recommendation,
  });

  for (const section of state.sections) {
    printSection(section);
  }
}

function buildOverviewSection(
  repo: RepoContext,
  issueId: string | null,
  currentPickIds: string[],
): SectionResult {
  const lines = [
    `branch=${repo.branch}`,
    `dirty_files=${repo.dirtyCount}`,
    `issue=${issueId ?? 'n/a'}`,
    `pick_ids=${currentPickIds.length > 0 ? currentPickIds.join(', ') : 'none'}`,
  ];

  return {
    name: 'Overview',
    ok: true,
    lines,
  };
}

function buildCodexLanesSection(): SectionResult {
  const lanesFile = path.join(ROOT, '.claude', 'lanes.json');
  if (!fs.existsSync(lanesFile)) {
    return {
      name: 'Codex Lanes',
      ok: true,
      lines: ['no lane registry found (.claude/lanes.json missing)'],
    };
  }

  let registry: { version: number; lanes: Array<{
    id: string; title: string; branch: string; status: string;
    owner: string; createdAt: string; pr: number | null;
  }> };

  try {
    registry = JSON.parse(fs.readFileSync(lanesFile, 'utf8'));
  } catch {
    return { name: 'Codex Lanes', ok: false, lines: ['lanes.json is malformed'] };
  }

  const codexLanes = registry.lanes.filter(
    (l) => l.owner === 'codex-cli' && l.status !== 'merged' && l.status !== 'abandoned',
  );
  const allActive = registry.lanes.filter((l) => l.status === 'active');
  const claudeActive = allActive.filter((l) => l.owner === 'claude' || l.owner === 'manual');
  const codexCliActive = allActive.filter((l) => l.owner === 'codex-cli');

  const lines: string[] = [
    `claude_lanes=${claudeActive.length}/3  codex_cli_lanes=${codexCliActive.length}/3`,
  ];

  const FOUR_HOURS = 4 * 60 * 60 * 1000;
  const stale = codexCliActive.filter(
    (l) => Date.now() - new Date(l.createdAt).getTime() > FOUR_HOURS,
  );

  if (codexLanes.length === 0) {
    lines.push('no active Codex CLI lanes');
  } else {
    for (const lane of codexLanes) {
      const ageMs = Date.now() - new Date(lane.createdAt).getTime();
      const ageMin = Math.floor(ageMs / 60_000);
      const age = ageMin < 60 ? `${ageMin}m` : `${Math.floor(ageMin / 60)}h`;
      const pr = lane.pr ? ` pr=#${lane.pr}` : '';
      const staleFlag = ageMs > FOUR_HOURS ? ' STALE' : '';
      lines.push(`${lane.id} | ${lane.status}${staleFlag} | age=${age}${pr}`);
    }
  }

  if (stale.length > 0) {
    lines.push(`stale_lanes=${stale.map((l) => l.id).join(',')}`);
  }

  const inReview = registry.lanes.filter((l) => l.owner === 'codex-cli' && l.status === 'review');
  if (inReview.length > 0) {
    lines.push(`pending_review=${inReview.map((l) => l.id).join(',')}`);
  }

  return {
    name: 'Codex Lanes',
    ok: stale.length === 0,
    lines,
  };
}

function buildLinearSection(issueId: string | null): SectionResult {
  if (!env.LINEAR_API_TOKEN) {
    return {
      name: 'Linear',
      ok: false,
      lines: ['skipped: LINEAR_API_TOKEN not available in current env'],
    };
  }

  const commandArgs = issueId
    ? ['linear:issues', '--', '--states', 'Ready,In Progress,In Review', '--limit', '10']
    : ['linear:work', '--limit', '5'];
  const result = runPnpm(commandArgs);
  if (!result.ok) {
    return failureSection('Linear', result);
  }

  let lines = summarizePlainLines(result.stdout);
  if (issueId) {
    const match = lines.find((line) => line.includes(issueId));
    if (match) {
      lines = [`current ${match}`, ...lines.filter((line) => line !== match).slice(0, 4)];
    } else {
      lines = [`${issueId}: not present in current Ready/In Progress/In Review slice`, ...lines.slice(0, 4)];
    }
  }

  return {
    name: 'Linear',
    ok: true,
    lines: lines.slice(0, 6),
  };
}

function buildGitHubSection(): SectionResult {
  const current = runPnpm(['github:current']);
  if (!current.ok) {
    return failureSection('GitHub', current);
  }

  const lines = summarizePlainLines(current.stdout);
  if (lines.length === 1 && lines[0] === '(no pull request for current branch)') {
    return {
      name: 'GitHub',
      ok: true,
      lines,
    };
  }

  const checks = runPnpm(['github:checks']);
  if (checks.ok) {
    lines.push(...summarizeCheckLines(checks.stdout));
  }

  return {
    name: 'GitHub',
    ok: true,
    lines: lines.slice(0, 8),
  };
}

function buildPipelineSection(): SectionResult {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      name: 'Pipeline',
      ok: false,
      lines: ['skipped: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not available in current env'],
    };
  }

  const result = runPnpm(['pipeline:health']);
  if (!result.ok) {
    return failureSection('Pipeline', result);
  }

  return {
    name: 'Pipeline',
    ok: true,
    lines: extractPipelineHighlights(result.stdout),
  };
}

function buildProofSection(issueId: string | null, currentPickIds: string[]): SectionResult {
  if (currentPickIds.length === 0) {
    return {
      name: 'Proof',
      ok: true,
      lines: [
        'no pick ids supplied',
        issueId
          ? `to verify a proof path: pnpm ops:brief -- --issue ${issueId} --pick <pick-id>`
          : 'add --pick <pick-id> to include proof state',
      ],
    };
  }

  const result = runPnpm([
    'proof:t1',
    '--',
    '--skip-verify',
    '--skip-pipeline',
    ...currentPickIds.flatMap((pickId) => ['--pick', pickId]),
    '--json',
  ]);

  const body = [result.stdout, result.stderr].filter(Boolean).join('\n');
  const payload = extractJsonObject(body);
  if (!payload) {
    return failureSection('Proof', result);
  }

  const parsed = JSON.parse(payload) as {
    verdict?: string;
    picks?: Array<{
      pickId: string;
      verdict: string;
      status?: string;
      promotionStatus?: string;
      promotionTarget?: string | null;
    }>;
  };

  const lines = [`bundle verdict=${parsed.verdict ?? 'UNKNOWN'}`];
  for (const pick of parsed.picks ?? []) {
    lines.push(
      `${pick.pickId}: ${pick.verdict} | status=${pick.status ?? 'n/a'} | promotion=${pick.promotionStatus ?? 'n/a'} -> ${pick.promotionTarget ?? 'n/a'}`,
    );
  }

  return {
    name: 'Proof',
    ok: result.ok,
    lines: lines.slice(0, 8),
  };
}

function buildCloseoutSection(
  issueId: string | null,
  currentPickIds: string[],
  sections: SectionResult[],
): SectionResult {
  const lines: string[] = [];
  const pipeline = sections.find((section) => section.name === 'Pipeline');
  const proof = sections.find((section) => section.name === 'Proof');
  const pipelineBlocked =
    pipeline?.lines.some((line) => line.includes('DOWN') || line.includes('DEGRADED')) ?? false;
  const proofFailed =
    proof?.lines.some((line) => line.includes('bundle verdict=FAIL') || line.includes('NOT_FOUND')) ??
    false;

  if (!issueId) {
    lines.push('no issue id supplied or inferred from branch');
  } else if (currentPickIds.length === 0) {
    lines.push(`${issueId}: proof inputs incomplete (add --pick for pick-level proof)`);
    lines.push(`next: pnpm ops:brief -- --issue ${issueId} --pick <pick-id>`);
  } else if (proofFailed) {
    lines.push(`${issueId}: resolve proof failures before closeout`);
    lines.push(
      `next: inspect picks with pnpm verify:pick -- <pick-id> or rerun pnpm proof:t1 -- --issue ${issueId} --change "<summary>" ${currentPickIds.map((pickId) => `--pick ${pickId}`).join(' ')}`,
    );
  } else if (pipelineBlocked) {
    lines.push(`${issueId}: runtime health is degraded; do not close out until pipeline risk is understood`);
  } else {
    lines.push(
      `${issueId}: ready to run pnpm proof:t1 -- --issue ${issueId} --change "<summary>" ${currentPickIds.map((pickId) => `--pick ${pickId}`).join(' ')}`,
    );
    lines.push(
      `${issueId}: if proof passes, close with pnpm linear:close -- ${issueId} --comment "<closeout note>"`,
    );
  }

  return {
    name: 'Closeout',
    ok: true,
    lines,
  };
}

function buildRecommendation(
  repo: RepoContext,
  issueId: string | null,
  currentPickIds: string[],
  sections: SectionResult[],
): string[] {
  const pipeline = sections.find((section) => section.name === 'Pipeline');
  const github = sections.find((section) => section.name === 'GitHub');
  const proof = sections.find((section) => section.name === 'Proof');

  if (pipeline?.lines.some((line) => line.includes('DOWN') || line.includes('DEGRADED'))) {
    return ['runtime health needs attention before new execution lanes'];
  }

  if (proof && currentPickIds.length > 0 && proof.lines.some((line) => line.includes('NOT_FOUND') || line.includes('FAIL'))) {
    return ['proof inputs need correction before closeout'];
  }

  if (repo.branch !== 'main' && github?.lines.includes('(no pull request for current branch)')) {
    return ['finish the branch and open a PR when ready'];
  }

  if (issueId && currentPickIds.length === 0) {
    return [`issue ${issueId} is in focus; add pick ids if you want proof-aware guidance`];
  }

  return ['safe to use this brief as the default high-level snapshot and drill down only where it flags risk'];
}

function readRepoContext(): RepoContext {
  const branch = runCommand('git', ['branch', '--show-current']).stdout.trim() || 'unknown';
  const status = runCommand('git', ['status', '--short']).stdout;
  const dirtyLines = status.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const match = branch.match(/(UTV2-\d+)/i);

  return {
    branch,
    dirtyCount: dirtyLines.length,
    inferredIssueId: match ? match[1].toUpperCase() : null,
  };
}

function runPnpm(commandArgs: string[]): { ok: boolean; stdout: string; stderr: string } {
  const command = `pnpm ${commandArgs.map(quoteArg).join(' ')}`;
  const result = spawnSync(command, {
    encoding: 'utf8',
    stdio: 'pipe',
    shell: true,
  });

  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function runCommand(command: string, commandArgs: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(command, commandArgs, {
    encoding: 'utf8',
    stdio: 'pipe',
  });

  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function failureSection(name: string, result: { stdout: string; stderr: string }): SectionResult {
  const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');
  const lines = summarizePlainLines(combined);
  return {
    name,
    ok: false,
    lines: lines.length > 0 ? lines : ['command failed'],
  };
}

function summarizePlainLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith('> @unit-talk/'))
    .filter((line) => !line.startsWith('> tsx '))
    .filter((line) => !line.startsWith('> node '))
    .filter((line) => !line.startsWith('> pnpm '))
    .slice(0, 10);
}

function summarizeCheckLines(value: string): string[] {
  return summarizePlainLines(value)
    .slice(0, 6)
    .map((line) => `check ${line}`);
}

function extractPipelineHighlights(value: string): string[] {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const highlights: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (
      line.startsWith('pending') ||
      line.startsWith('processing') ||
      line.startsWith('sent') ||
      line.startsWith('failed') ||
      line.startsWith('dead_letter') ||
      line.startsWith('Worker verdict:') ||
      line.startsWith('Last run status:') ||
      line.startsWith('Last successful run:')
    ) {
      highlights.push(line);
      continue;
    }

    if (line.startsWith('CRITICAL') || line.startsWith('WARN')) {
      highlights.push(line);
      const next = lines[index + 1];
      if (next && (next.startsWith('⛔') || next.startsWith('⚠') || next.startsWith('-'))) {
        highlights.push(next);
      }
    }
  }

  return highlights.length > 0 ? highlights.slice(0, 8) : summarizePlainLines(value);
}

function extractJsonObject(value: string): string | null {
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    return null;
  }

  return value.slice(start, end + 1);
}

function printSection(section: SectionResult): void {
  console.log(section.name);
  if (section.lines.length === 0) {
    console.log('- (none)');
  } else {
    for (const line of section.lines) {
      console.log(`- ${line}`);
    }
  }
  console.log('');
}

function readOption(name: string): string | undefined {
  const exact = `--${name}`;
  const prefix = `${exact}=`;
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === exact) {
      const next = args[index + 1];
      return next && !next.startsWith('--') ? next : undefined;
    }
    if (current.startsWith(prefix)) {
      return current.slice(prefix.length);
    }
  }
  return undefined;
}

function readMultiOption(name: string): string[] {
  const exact = `--${name}`;
  const prefix = `${exact}=`;
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === exact) {
      const next = args[index + 1];
      if (next && !next.startsWith('--')) {
        values.push(next);
      }
      continue;
    }
    if (current.startsWith(prefix)) {
      values.push(current.slice(prefix.length));
    }
  }
  return values;
}

function quoteArg(value: string): string {
  if (/^[A-Za-z0-9._:/=-]+$/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}
