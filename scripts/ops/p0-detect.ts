import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { emitJson, parseArgs, requireIssueId } from './shared.js';

// Historical identifiers retained for callers/documentation, never queried.
export const P0_PROJECT_ID = '46229dc4-c7c1-4ccb-af0d-dedaf8147a97';
export const P0_PROJECT_NAME = 'Runtime Hardening P0 - Runtime Trustworthiness';
export interface P0DetectResult {
  schema_version: 1;
  issue_id: string;
  classification: 'p0' | 'non_p0' | 'unknown';
  is_p0: boolean | null;
  source: string;
  reason: string;
}
interface DetectOptions { root?: string; baseRef?: string; headRef?: string; prNumber?: number }
const require = createRequire(import.meta.url);
const classifier = require('./tracker-independence/p0-classifier.cjs') as {
  classifyRepositoryP0(input: DetectOptions & {root: string; issueId: string; approval?: boolean}): P0DetectResult;
};

export async function detectP0(issueId: string, options: DetectOptions = {}): Promise<P0DetectResult> {
  const root = options.root ?? process.cwd();
  const input = { ...options, root, issueId: issueId.toUpperCase(), baseRef: options.baseRef ?? 'origin/main' };
  return classifier.classifyRepositoryP0(input);
}

async function main(): Promise<void> {
  const {positionals, bools, flags} = parseArgs(process.argv.slice(2));
  const issueId = requireIssueId(positionals[0] ?? '');
  const result = await detectP0(issueId, {baseRef: flags.get('base')?.[0], headRef: flags.get('head')?.[0], prNumber: flags.has('pr') ? Number(flags.get('pr')?.[0]) : undefined});
  if (bools.has('json')) emitJson(result);
  else console.log(`${result.issue_id}: ${result.classification} — ${result.reason}`);
  process.exitCode = result.classification === 'unknown' ? 3 : result.is_p0 ? 0 : 10;
}
const entryArg = process.argv[1];
if (entryArg !== undefined && import.meta.url === pathToFileURL(entryArg).href) void main();
