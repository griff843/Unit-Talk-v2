import { loadEnvironment } from '@unit-talk/config';
import {
  emitJson,
  parseArgs,
  readManifest,
  requireIssueId,
  writeManifest,
} from './shared.js';
import { runTruthCheck } from './truth-check-lib.js';

async function main(): Promise<void> {
  const { positionals, bools } = parseArgs(process.argv.slice(2));
  const issueId = requireIssueId(positionals[0] ?? '');

  try {
    const result = await runTruthCheck({
      issueId,
      json: true,
      explain: bools.has('explain'),
      runner: 'ops:lane:close',
    });

    if (result.exit_code !== 0) {
      emitJson({
        ok: false,
        code: 'lane_close_failed',
        message: 'truth-check did not pass',
        issue_id: issueId,
        truth_check: result,
      });
      process.exit(result.exit_code);
    }

    const manifest = readManifest(issueId);
    manifest.status = 'done';
    manifest.closed_at = new Date().toISOString();
    manifest.heartbeat_at = manifest.closed_at;
    writeManifest(manifest);

    await transitionLinearIssueToDone(issueId);

    emitJson({
      ok: true,
      code: 'lane_closed',
      issue_id: issueId,
      status: manifest.status,
      closed_at: manifest.closed_at,
      truth_check: result,
    });
  } catch (error) {
    emitJson({
      ok: false,
      code: 'lane_close_failed',
      message: error instanceof Error ? error.message : String(error),
      issue_id: issueId,
    });
    process.exit(1);
  }
}

async function transitionLinearIssueToDone(issueId: string): Promise<void> {
  const env = loadEnvironment();
  const token = env.LINEAR_API_TOKEN?.trim() || process.env.LINEAR_API_KEY?.trim();
  if (!token) {
    throw new Error('LINEAR_API_TOKEN or LINEAR_API_KEY is required to close the Linear issue');
  }

  const issuePayload = await fetchLinear<{ data?: { issue: { id: string } | null }; errors?: Array<{ message?: string }> }>(
    token,
    `
      query ResolveIssue($id: String!) {
        issue(id: $id) {
          id
        }
      }
    `,
    { id: issueId },
  );
  if (issuePayload.errors?.length) {
    throw new Error(issuePayload.errors.map((entry) => entry.message ?? 'Unknown Linear error').join('; '));
  }
  const issue = issuePayload.data?.issue;
  if (!issue) {
    throw new Error(`Linear issue not found: ${issueId}`);
  }

  const statesPayload = await fetchLinear<{
    data?: { workflowStates: { nodes: Array<{ id: string; name: string }> } };
    errors?: Array<{ message?: string }>;
  }>(
    token,
    `
      query DoneStates {
        workflowStates(filter: { name: { eq: "Done" } }, first: 20) {
          nodes { id name }
        }
      }
    `,
    {},
  );
  if (statesPayload.errors?.length) {
    throw new Error(statesPayload.errors.map((entry) => entry.message ?? 'Unknown Linear error').join('; '));
  }
  const doneState = statesPayload.data?.workflowStates.nodes[0];
  if (!doneState) {
    throw new Error('Linear Done state not found');
  }

  const updatePayload = await fetchLinear<{
    data?: { issueUpdate: { success: boolean } };
    errors?: Array<{ message?: string }>;
  }>(
    token,
    `
      mutation CloseIssue($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
        }
      }
    `,
    {
      id: issue.id,
      input: {
        stateId: doneState.id,
      },
    },
  );
  if (updatePayload.errors?.length) {
    throw new Error(updatePayload.errors.map((entry) => entry.message ?? 'Unknown Linear error').join('; '));
  }
  if (!updatePayload.data?.issueUpdate.success) {
    throw new Error(`Failed to transition Linear issue ${issueId} to Done`);
  }
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
  return (await response.json()) as T;
}

void main();
