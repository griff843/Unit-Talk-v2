import { pathToFileURL } from 'node:url';
import { emitJson, getFlag, parseArgs } from './shared.js';

export type BranchDisciplineResult = {
  ok: boolean;
  code:
    | 'single_issue_reference'
    | 'multiple_issue_references'
    | 'no_issue_reference'
    | 'missing_branch_issue_reference'
    | 'branch_issue_mismatch'
    | 'exempt_branch';
  issue_ids: string[];
  branch_issue_ids: string[];
  errors: string[];
  warning: string | null;
};

const ISSUE_PATTERN = /\b(?:UTV2|UNI)-\d+\b/gi;
const EXEMPT_BRANCH_PREFIXES = ['dependabot/', 'renovate/', 'github-actions/'] as const;
const PROOF_SECTION_HEADING_PATTERN =
  /^(?:#{1,6}\s*)?(?:verification|proof|evidence|test output|tap output|logs?|live-db proof|runtime proof)\b/i;

export function extractIssueIds(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(ISSUE_PATTERN)) {
    seen.add(match[0].toUpperCase());
  }
  return [...seen].sort((left, right) => left.localeCompare(right));
}

export function evaluateIssueReferences(text: string): BranchDisciplineResult {
  const issueIds = extractIssueIds(text);
  if (issueIds.length > 1) {
    return {
      ok: false,
      code: 'multiple_issue_references',
      issue_ids: issueIds,
      branch_issue_ids: [],
      errors: [`Multiple issue IDs referenced: ${issueIds.join(', ')}`],
      warning: `Multiple issue IDs referenced: ${issueIds.join(', ')}`,
    };
  }
  if (issueIds.length === 1) {
    return {
      ok: true,
      code: 'single_issue_reference',
      issue_ids: issueIds,
      branch_issue_ids: [],
      errors: [],
      warning: null,
    };
  }
  return {
    ok: false,
    code: 'no_issue_reference',
    issue_ids: [],
    branch_issue_ids: [],
    errors: ['No UTV2-### or UNI-### issue ID referenced'],
    warning: null,
  };
}

export function normalizeProofOutputForIssueBinding(text: string): string {
  const withoutFencedBlocks = text.replace(/```[\s\S]*?```/g, '\n');
  const lines = withoutFencedBlocks.split(/\r?\n/);
  const kept: string[] = [];
  let inProofSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#{1,6}\s+\S/.test(trimmed)) {
      inProofSection = PROOF_SECTION_HEADING_PATTERN.test(trimmed.replace(/^#{1,6}\s+/, ''));
      if (!inProofSection) {
        kept.push(line);
      }
      continue;
    }

    if (inProofSection) {
      continue;
    }

    if (
      /^TAP version \d+\b/i.test(trimmed) ||
      /^(?:ok|not ok) \d+\b/i.test(trimmed) ||
      /^#\s+(?:tests|suites|pass|fail|cancelled|skipped|todo|duration)\b/i.test(trimmed) ||
      /^\[(?:proof|verification|test|tap|log|runtime|db)\]/i.test(trimmed)
    ) {
      continue;
    }

    kept.push(line);
  }

  return kept.join('\n');
}

export function evaluateBranchDiscipline(input: {
  title?: string;
  body?: string;
  branch?: string;
  commits?: string;
}): BranchDisciplineResult {
  const branch = input.branch ?? '';
  if (EXEMPT_BRANCH_PREFIXES.some((prefix) => branch.startsWith(prefix))) {
    return {
      ok: true,
      code: 'exempt_branch',
      issue_ids: [],
      branch_issue_ids: [],
      errors: [],
      warning: null,
    };
  }

  const branchIssueIds = extractIssueIds(branch);
  const issueIds = extractIssueIds([
    input.title ?? '',
    normalizeProofOutputForIssueBinding(input.body ?? ''),
    branch,
    input.commits ?? '',
  ].join('\n'));

  if (branchIssueIds.length !== 1) {
    return {
      ok: false,
      code: 'missing_branch_issue_reference',
      issue_ids: issueIds,
      branch_issue_ids: branchIssueIds,
      errors: [
        branchIssueIds.length === 0
          ? `PR branch "${branch || '<missing>'}" must include exactly one UTV2-### or UNI-### issue ID`
          : `PR branch "${branch}" references multiple issue IDs: ${branchIssueIds.join(', ')}`,
      ],
      warning: null,
    };
  }

  const branchIssueId = branchIssueIds[0]!;

  if (issueIds.length !== 1) {
    return {
      ok: false,
      code: issueIds.length === 0 ? 'no_issue_reference' : 'multiple_issue_references',
      issue_ids: issueIds,
      branch_issue_ids: branchIssueIds,
      errors: [
        issueIds.length === 0
          ? 'No UTV2-### or UNI-### issue ID referenced'
          : `All PR issue references must match branch issue ${branchIssueId}; found ${issueIds.join(', ')}`,
      ],
      warning: null,
    };
  }

  const issueId = issueIds[0]!;

  if (issueId !== branchIssueId) {
    return {
      ok: false,
      code: 'branch_issue_mismatch',
      issue_ids: issueIds,
      branch_issue_ids: branchIssueIds,
      errors: [`PR references ${issueId} but branch references ${branchIssueId}`],
      warning: null,
    };
  }

  return {
    ok: true,
    code: 'single_issue_reference',
    issue_ids: issueIds,
    branch_issue_ids: branchIssueIds,
    errors: [],
    warning: null,
  };
}

export function main(argv = process.argv.slice(2)): number {
  const { flags, bools } = parseArgs(argv);
  const result = evaluateBranchDiscipline({
    title: getFlag(flags, 'title') ?? '',
    body: getFlag(flags, 'body') ?? '',
    branch: getFlag(flags, 'branch') ?? '',
    commits: getFlag(flags, 'commits') ?? '',
  });
  if (bools.has('json')) {
    emitJson(result);
  } else if (!result.ok) {
    console.error(`Branch discipline FAILED: ${result.errors.join('; ')}`);
  } else if (result.warning) {
    console.warn(`WARNING: ${result.warning}`);
  } else {
    console.log(`Branch discipline OK: ${result.code}`);
  }
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
