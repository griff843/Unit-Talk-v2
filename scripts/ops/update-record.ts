import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadEnvironment } from '@unit-talk/config';
import {
  emitJson,
  getFlag,
  parseArgs,
  requireIssueId,
} from './shared.js';

type Target = 'fibery' | 'linear';

interface UpdateRecordResult {
  ok: boolean;
  code: string;
  target?: Target;
  message?: string;
  entity?: string;
  issue?: string;
  status?: string;
  dry_run?: boolean;
  comment_id?: string;
}

interface LinearGraphQlResponse<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

export function main(argv = process.argv.slice(2)): void {
  run(argv)
    .then((result) => {
      emitJson(result);
      process.exitCode = result.ok ? 0 : result.code === 'dry_run' ? 0 : 1;
    })
    .catch((error) => {
      emitJson({
        ok: false,
        code: 'update_record_failed',
        message: error instanceof Error ? error.message : String(error),
      } satisfies UpdateRecordResult);
      process.exitCode = 1;
    });
}

async function run(argv: string[]): Promise<UpdateRecordResult> {
  const { flags, bools } = parseArgs(argv);
  const target = parseTarget(getFlag(flags, 'target'));
  const notePath = getFlag(flags, 'note-file') ?? getFlag(flags, 'comment-file');
  const note = readRequiredNote(notePath);
  const status = getFlag(flags, 'status');
  const kind = getFlag(flags, 'kind');
  const dryRun = bools.has('dry-run');

  if (target === 'fibery') {
    return postFiberyUpdate({
      entity: requireNonEmpty(getFlag(flags, 'entity'), '--entity'),
      note,
      status,
      kind,
      dryRun,
    });
  }

  return postLinearUpdate({
    issue: requireIssueId(getFlag(flags, 'issue') ?? ''),
    note,
    status,
    dryRun,
  });
}

async function postFiberyUpdate(input: {
  entity: string;
  note: string;
  status?: string;
  kind?: string;
  dryRun: boolean;
}): Promise<UpdateRecordResult> {
  if (input.dryRun) {
    return {
      ok: true,
      code: 'dry_run',
      target: 'fibery',
      entity: input.entity,
      status: input.status,
      dry_run: true,
    };
  }

  const env = loadEnvironment();
  const webhookUrl = env.FIBERY_UPDATE_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    throw new Error('FIBERY_UPDATE_WEBHOOK_URL is required for Fibery updates');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = env.FIBERY_UPDATE_WEBHOOK_TOKEN?.trim();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const body: Record<string, unknown> = {
    target: 'fibery',
    entity: input.entity,
    note: input.note,
    source: 'pnpm ops:update-record',
  };
  if (input.status) {
    body['status'] = input.status;
  }
  if (input.kind) {
    body['kind'] = input.kind;
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Fibery update webhook failed: ${response.status} ${response.statusText}`);
  }

  return {
    ok: true,
    code: 'fibery_update_posted',
    target: 'fibery',
    entity: input.entity,
    status: input.status,
  };
}

async function postLinearUpdate(input: {
  issue: string;
  note: string;
  status?: string;
  dryRun: boolean;
}): Promise<UpdateRecordResult> {
  if (input.dryRun) {
    return {
      ok: true,
      code: 'dry_run',
      target: 'linear',
      issue: input.issue,
      status: input.status,
      dry_run: true,
    };
  }

  const env = loadEnvironment();
  const token = env.LINEAR_API_TOKEN?.trim() || process.env.LINEAR_API_KEY?.trim();
  if (!token) {
    throw new Error('LINEAR_API_TOKEN or LINEAR_API_KEY is required for Linear updates');
  }

  const issue = await resolveLinearIssue(token, input.issue);
  if (input.status) {
    const stateId = await resolveLinearState(token, input.status);
    await fetchLinear(token, `
      mutation UpdateIssueState($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) { success }
      }
    `, {
      id: issue.id,
      input: { stateId },
    });
  }

  const comment = await fetchLinear<{
    commentCreate: {
      success: boolean;
      comment: { id: string } | null;
    };
  }>(token, `
    mutation CreateComment($input: CommentCreateInput!) {
      commentCreate(input: $input) {
        success
        comment { id }
      }
    }
  `, {
    input: {
      issueId: issue.id,
      body: input.note,
    },
  });

  return {
    ok: true,
    code: 'linear_update_posted',
    target: 'linear',
    issue: issue.identifier,
    status: input.status,
    comment_id: comment.commentCreate.comment?.id ?? undefined,
  };
}

async function resolveLinearIssue(
  token: string,
  issueRef: string,
): Promise<{ id: string; identifier: string }> {
  const payload = await fetchLinear<{
    issue: { id: string; identifier: string } | null;
  }>(token, `
    query ResolveIssue($id: String!) {
      issue(id: $id) { id identifier }
    }
  `, {
    id: issueRef,
  });
  if (!payload.issue) {
    throw new Error(`Linear issue not found: ${issueRef}`);
  }
  return payload.issue;
}

async function resolveLinearState(token: string, stateName: string): Promise<string> {
  const env = loadEnvironment();
  const teamKey = env.LINEAR_TEAM_KEY;
  const payload = await fetchLinear<{
    teams: {
      nodes: Array<{
        states: {
          nodes: Array<{ id: string; name: string }>;
        };
      }>;
    };
  }>(token, `
    query ResolveState($teamKey: String!) {
      teams(filter: { key: { eq: $teamKey } }, first: 1) {
        nodes {
          states {
            nodes { id name }
          }
        }
      }
    }
  `, {
    teamKey,
  });
  const state = payload.teams.nodes[0]?.states.nodes.find(
    (candidate) => candidate.name.toLowerCase() === stateName.toLowerCase(),
  );
  if (!state) {
    throw new Error(`Linear state not found on team ${teamKey}: ${stateName}`);
  }
  return state.id;
}

async function fetchLinear<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw new Error(`Linear API request failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as LinearGraphQlResponse<T>;
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((entry) => entry.message ?? 'Unknown Linear error').join('; '));
  }
  if (!payload.data) {
    throw new Error('Linear API returned no data');
  }
  return payload.data;
}

function parseTarget(value: string | undefined): Target {
  if (value === 'fibery' || value === 'linear') {
    return value;
  }
  throw new Error('Missing or invalid --target. Use --target fibery or --target linear');
}

function readRequiredNote(filePath: string | undefined): string {
  if (!filePath) {
    throw new Error('Missing required --note-file or --comment-file');
  }
  const note = fs.readFileSync(filePath, 'utf8').trim();
  if (!note) {
    throw new Error(`Note file is empty: ${filePath}`);
  }
  return note;
}

function requireNonEmpty(value: string | undefined, label: string): string {
  if (!value?.trim()) {
    throw new Error(`Missing required ${label}`);
  }
  return value.trim();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
