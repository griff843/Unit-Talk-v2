import fs from 'node:fs';
import { loadEnvironment } from '@unit-talk/config';

type JsonObject = Record<string, unknown>;

interface LinearGraphQlResponse<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

interface LinearIssueNode {
  id: string;
  identifier: string;
  title: string;
  url: string;
  branchName?: string | null;
  state?: { id: string; name: string; type: string } | null;
  assignee?: { id: string; name: string } | null;
  updatedAt: string;
}

const env = loadEnvironment();
const apiKey = env.LINEAR_API_TOKEN?.trim();

if (!apiKey) {
  throw new Error('LINEAR_API_TOKEN is required');
}

const args = process.argv.slice(2);
const command = args[0];

if (!command) {
  printUsage();
  process.exit(1);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main(): Promise<void> {
  switch (command) {
    case 'issues':
      await listIssues();
      return;
    case 'work':
      await listExecutableWork();
      return;
    case 'update':
      await updateIssue();
      return;
    case 'comment':
      await createComment();
      return;
    case 'close':
      await closeIssue();
      return;
    default:
      printUsage();
      throw new Error(`Unknown command: ${command}`);
  }
}

async function listIssues(): Promise<void> {
  const teamId = await resolveTeamId();
  const stateNames = parseCsv(readOption('states') ?? 'Ready,In Progress,In Review');
  const limit = Number.parseInt(readOption('limit') ?? '50', 10);
  const json = hasFlag('json');

  const data = await gql<{
    team: {
      issues: {
        nodes: LinearIssueNode[];
      };
    } | null;
  }>(
    `
      query ListIssues($teamKey: String!, $stateNames: [String!], $first: Int!) {
        team(id: $teamKey) {
          issues(
            first: $first
            filter: { state: { name: { in: $stateNames } } }
            orderBy: updatedAt
          ) {
            nodes {
              id
              identifier
              title
              url
              branchName
              updatedAt
              state { id name type }
              assignee { id name }
            }
          }
        }
      }
    `,
    {
      teamKey: teamId,
      stateNames,
      first: limit,
    },
  );

  const issues = data.team?.issues.nodes ?? [];
  if (json) {
    console.log(JSON.stringify(issues, null, 2));
    return;
  }

  if (issues.length === 0) {
    console.log('(no issues found)');
    return;
  }

  for (const issue of issues) {
    const parts = [
      issue.identifier,
      issue.state?.name ?? 'Unknown',
      issue.title,
    ];

    if (issue.branchName) {
      parts.push(`branch=${issue.branchName}`);
    }

    if (issue.assignee?.name) {
      parts.push(`assignee=${issue.assignee.name}`);
    }

    parts.push(`updated=${issue.updatedAt}`);
    console.log(parts.join(' | '));
  }
}

async function listExecutableWork(): Promise<void> {
  const teamId = await resolveTeamId();
  const stateNames = parseCsv(readOption('states') ?? 'Ready,In Progress,In Review');
  const limit = Number.parseInt(readOption('limit') ?? '25', 10);

  const data = await gql<{
    team: {
      issues: {
        nodes: Array<
          LinearIssueNode & {
            priority?: number | null;
            labels?: { nodes: Array<{ name: string }> } | null;
            project?: { name: string } | null;
          }
        >;
      };
    } | null;
  }>(
    `
      query WorkIssues($teamKey: String!, $stateNames: [String!], $first: Int!) {
        team(id: $teamKey) {
          issues(
            first: $first
            filter: { state: { name: { in: $stateNames } } }
            orderBy: updatedAt
          ) {
            nodes {
              id
              identifier
              title
              url
              branchName
              updatedAt
              priority
              project { name }
              labels(first: 8) { nodes { name } }
              state { id name type }
              assignee { id name }
            }
          }
        }
      }
    `,
    {
      teamKey: teamId,
      stateNames,
      first: limit,
    },
  );

  const issues = data.team?.issues.nodes ?? [];
  if (issues.length === 0) {
    console.log('(no executable issues found)');
    return;
  }

  for (const issue of issues) {
    const labels = issue.labels?.nodes.map((label) => label.name).join(', ');
    const parts = [
      issue.identifier,
      issue.state?.name ?? 'Unknown',
      issue.title,
    ];

    if (issue.priority != null) {
      parts.push(`priority=${issue.priority}`);
    }
    if (issue.project?.name) {
      parts.push(`project=${issue.project.name}`);
    }
    if (labels) {
      parts.push(`labels=${labels}`);
    }
    if (issue.assignee?.name) {
      parts.push(`assignee=${issue.assignee.name}`);
    }
    if (issue.branchName) {
      parts.push(`branch=${issue.branchName}`);
    }

    console.log(parts.join(' | '));
  }
}

async function updateIssue(): Promise<void> {
  const issueRef = requirePositionalArg(1, 'issue identifier');
  const stateName = readOption('state');
  const title = readOption('title');
  const description = readOption('description');
  const branchName = readOption('branch');
  const priority = readOption('priority');
  const stateId = stateName ? await resolveStateId(stateName) : undefined;

  const issue = await resolveIssue(issueRef);
  const input: JsonObject = { id: issue.id };

  if (stateId) {
    input['stateId'] = stateId;
  }
  if (title) {
    input['title'] = title;
  }
  if (description) {
    input['description'] = description;
  }
  if (branchName) {
    input['branchName'] = branchName;
  }
  if (priority) {
    input['priority'] = Number.parseInt(priority, 10);
  }

  const data = await gql<{
    issueUpdate: {
      success: boolean;
      issue: LinearIssueNode | null;
    };
  }>(
    `
      mutation UpdateIssue($input: IssueUpdateInput!) {
        issueUpdate(input: $input) {
          success
          issue {
            id
            identifier
            title
            url
            branchName
            updatedAt
            state { id name type }
            assignee { id name }
          }
        }
      }
    `,
    { input },
  );

  const updated = data.issueUpdate.issue;
  if (!updated) {
    throw new Error(`Linear did not return an updated issue for ${issueRef}`);
  }

  console.log(
    `${updated.identifier} | ${updated.state?.name ?? 'Unknown'} | ${updated.title} | ${updated.url}`,
  );
}

async function createComment(): Promise<void> {
  const issueRef = requirePositionalArg(1, 'issue identifier');
  const body = readOption('body') ?? readOption('body-file', { fileContents: true });

  if (!body) {
    throw new Error('Provide --body or --body-file for comment content');
  }

  const issue = await resolveIssue(issueRef);
  const data = await gql<{
    commentCreate: {
      success: boolean;
      comment: { id: string; body: string } | null;
    };
  }>(
    `
      mutation CreateComment($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
          comment { id body }
        }
      }
    `,
    {
      input: {
        issueId: issue.id,
        body,
      },
    },
  );

  console.log(`${issue.identifier} | comment=${data.commentCreate.comment?.id ?? 'created'}`);
}

async function closeIssue(): Promise<void> {
  const issueRef = requirePositionalArg(1, 'issue identifier');
  const doneStateName = readOption('state') ?? 'Done';
  const commentBody = readOption('comment') ?? readOption('comment-file', { fileContents: true });
  const issue = await resolveIssue(issueRef);
  const doneStateId = await resolveStateId(doneStateName);

  await gql(
    `
      mutation CloseIssue($input: IssueUpdateInput!) {
        issueUpdate(input: $input) {
          success
        }
      }
    `,
    {
      input: {
        id: issue.id,
        stateId: doneStateId,
      },
    },
  );

  if (commentBody) {
    await gql(
      `
        mutation CreateComment($input: CommentCreateInput!) {
          commentCreate(input: $input) {
            success
            comment { id }
          }
        }
      `,
      {
        input: {
          issueId: issue.id,
          body: commentBody,
        },
      },
    );
  }

  console.log(`${issue.identifier} | closed=${doneStateName}`);
}

async function resolveIssue(issueRef: string): Promise<LinearIssueNode> {
  const identifier = issueRef.toUpperCase();
  const data = await gql<{
    issue: LinearIssueNode | null;
  }>(
    `
      query ResolveIssue($id: String!) {
        issue(id: $id) {
          id
          identifier
          title
          url
          branchName
          updatedAt
          state { id name type }
          assignee { id name }
        }
      }
    `,
    { id: identifier },
  );

  if (!data.issue) {
    throw new Error(`Linear issue not found: ${identifier}`);
  }

  return data.issue;
}

async function resolveStateId(stateName: string): Promise<string> {
  const teamId = await resolveTeamId();
  const data = await gql<{
    team: {
      states: {
        nodes: Array<{ id: string; name: string; type: string }>;
      };
    } | null;
  }>(
    `
      query ResolveState($teamKey: String!) {
        team(id: $teamKey) {
          states {
            nodes {
              id
              name
              type
            }
          }
        }
      }
    `,
    { teamKey: teamId },
  );

  const state = data.team?.states.nodes.find(
    (candidate) => candidate.name.toLowerCase() === stateName.toLowerCase(),
  );

  if (!state) {
    throw new Error(`Linear state not found on the configured team: ${stateName}`);
  }

  return state.id;
}

async function resolveTeamId(): Promise<string> {
  const explicitTeamId = readOption('team-id') ?? env.LINEAR_TEAM_ID?.trim();
  if (explicitTeamId) {
    return explicitTeamId;
  }

  const teamKey = readOption('team-key') ?? readOption('team') ?? env.LINEAR_TEAM_KEY?.trim();
  if (!teamKey) {
    throw new Error('Provide LINEAR_TEAM_ID or LINEAR_TEAM_KEY to query the Linear team');
  }

  const data = await gql<{
    teams: {
      nodes: Array<{ id: string; key: string; name: string }>;
    };
  }>(
    `
      query ResolveTeamId {
        teams(first: 250) {
          nodes {
            id
            key
            name
          }
        }
      }
    `,
  );

  const team = data.teams.nodes.find(
    (candidate) => candidate.key.toLowerCase() === teamKey.toLowerCase(),
  );

  if (!team) {
    throw new Error(`Linear team not found for key: ${teamKey}`);
  }

  return team.id;
}

async function gql<T>(query: string, variables: JsonObject = {}): Promise<T> {
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: apiKey!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Linear API request failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as LinearGraphQlResponse<T>;
  if (payload.errors?.length) {
    throw new Error(
      payload.errors.map((error) => error.message ?? 'Unknown Linear error').join('; '),
    );
  }

  if (!payload.data) {
    throw new Error('Linear API returned no data');
  }

  return payload.data;
}

function parseCsv(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

function readOption(
  name: string,
  options: { fileContents?: boolean } = {},
): string | undefined {
  const exact = `--${name}`;
  const inlinePrefix = `${exact}=`;

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === exact) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        return 'true';
      }

      return options.fileContents ? readFile(value) : value;
    }

    if (current.startsWith(inlinePrefix)) {
      const value = current.slice(inlinePrefix.length);
      return options.fileContents ? readFile(value) : value;
    }
  }

  return undefined;
}

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

function requirePositionalArg(index: number, label: string): string {
  const value = args[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing ${label}`);
  }

  return value;
}

function printUsage(): void {
  console.log(`Usage:
  tsx scripts/linear-workflow.ts issues [--team-id <id> | --team-key <key>] [--states "Ready,In Progress,In Review"] [--limit 50] [--json]
  tsx scripts/linear-workflow.ts work [--team-id <id> | --team-key <key>] [--states "Ready,In Progress,In Review"] [--limit 25]
  tsx scripts/linear-workflow.ts update UTV2-123 [--state Done] [--branch branch-name]
  tsx scripts/linear-workflow.ts comment UTV2-123 --body "message"
  tsx scripts/linear-workflow.ts close UTV2-123 [--comment "closeout note"] [--state Done]`);
}
