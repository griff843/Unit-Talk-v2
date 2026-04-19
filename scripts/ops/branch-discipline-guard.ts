import { pathToFileURL } from 'node:url';
import { emitJson, getFlag, parseArgs } from './shared.js';

export type BranchDisciplineResult = {
  ok: true;
  code: 'single_issue_reference' | 'multiple_issue_references' | 'no_issue_reference';
  issue_ids: string[];
  warning: string | null;
};

const ISSUE_PATTERN = /\bUTV2-\d+\b/gi;

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
      ok: true,
      code: 'multiple_issue_references',
      issue_ids: issueIds,
      warning: `Multiple issue IDs referenced: ${issueIds.join(', ')}`,
    };
  }
  if (issueIds.length === 1) {
    return {
      ok: true,
      code: 'single_issue_reference',
      issue_ids: issueIds,
      warning: null,
    };
  }
  return {
    ok: true,
    code: 'no_issue_reference',
    issue_ids: [],
    warning: null,
  };
}

export function main(argv = process.argv.slice(2)): number {
  const { flags, bools } = parseArgs(argv);
  const parts = [
    getFlag(flags, 'title') ?? '',
    getFlag(flags, 'body') ?? '',
    getFlag(flags, 'branch') ?? '',
    getFlag(flags, 'commits') ?? '',
  ];
  const result = evaluateIssueReferences(parts.join('\n'));
  if (bools.has('json')) {
    emitJson(result);
  } else if (result.warning) {
    console.warn(`WARNING: ${result.warning}`);
  } else {
    console.log(`Branch discipline OK: ${result.code}`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
