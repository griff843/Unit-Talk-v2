import { pathToFileURL } from 'node:url';
import { emitJson, parseArgs, requireIssueId } from './shared.js';
import { linearQuery } from './linear-client.js';

export const P0_PROJECT_ID = '46229dc4-c7c1-4ccb-af0d-dedaf8147a97';
export const P0_PROJECT_NAME = 'Runtime Hardening P0 - Runtime Trustworthiness';

export interface P0DetectResult {
  schema_version: 1;
  issue_id: string;
  is_p0: boolean;
  project_id: string | null;
  project_name: string | null;
  source: 'linear' | 'error';
  error?: string;
  checked_at: string;
}

interface LinearIssueProject {
  data?: {
    issue: {
      identifier: string;
      project: { id: string; name: string } | null;
    } | null;
  };
}

export async function detectP0(
  issueId: string,
  token: string,
): Promise<P0DetectResult> {
  const checkedAt = new Date().toISOString();
  const normalized = issueId.toUpperCase();

  const result = await linearQuery<NonNullable<LinearIssueProject['data']>>(
    `
      query IssueProject($id: String!) {
        issue(id: $id) {
          identifier
          project { id name }
        }
      }
    `,
    { id: normalized },
    { token, userAgent: 'unit-talk-p0-detect' },
  );

  if (!result.ok) {
    return {
      schema_version: 1,
      issue_id: normalized,
      is_p0: false,
      project_id: null,
      project_name: null,
      source: 'error',
      error: result.error ?? 'Linear query failed',
      checked_at: checkedAt,
    };
  }

  const issue = result.data?.issue;
  if (!issue) {
    return {
      schema_version: 1,
      issue_id: normalized,
      is_p0: false,
      project_id: null,
      project_name: null,
      source: 'error',
      error: 'Linear issue not found',
      checked_at: checkedAt,
    };
  }

  const project = issue.project;
  return {
    schema_version: 1,
    issue_id: normalized,
    is_p0: project?.id === P0_PROJECT_ID,
    project_id: project?.id ?? null,
    project_name: project?.name ?? null,
    source: 'linear',
    checked_at: checkedAt,
  };
}

async function main(): Promise<void> {
  const { positionals, bools } = parseArgs(process.argv.slice(2));
  const issueId = requireIssueId(positionals[0] ?? '');
  const json = bools.has('json');

  const token =
    process.env.LINEAR_API_TOKEN?.trim() || process.env.LINEAR_API_KEY?.trim();
  if (!token) {
    const error = 'LINEAR_API_TOKEN or LINEAR_API_KEY must be set';
    if (json) {
      emitJson({
        schema_version: 1,
        issue_id: issueId,
        is_p0: false,
        project_id: null,
        project_name: null,
        source: 'error',
        error,
        checked_at: new Date().toISOString(),
      } satisfies P0DetectResult);
    } else {
      console.error(error);
    }
    process.exitCode = 3;
    return;
  }

  const result = await detectP0(issueId, token);

  if (json) {
    emitJson(result);
  } else if (result.source === 'error') {
    console.error(`p0-detect: ${result.error}`);
  } else {
    console.log(
      result.is_p0
        ? `${issueId} IS P0 (project: ${result.project_name})`
        : `${issueId} is not P0 (project: ${result.project_name ?? 'none'})`,
    );
  }

  if (result.source === 'error') {
    process.exitCode = 3;
    return;
  }
  process.exitCode = result.is_p0 ? 0 : 10;
}

const entryArg = process.argv[1];
const isCli = entryArg !== undefined &&
  import.meta.url === pathToFileURL(entryArg).href;
if (isCli) {
  void main();
}
