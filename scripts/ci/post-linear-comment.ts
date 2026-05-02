/**
 * Post a comment to a Linear issue via the Linear API.
 * Usage: tsx scripts/ci/post-linear-comment.ts --issue-id UTV2-NNN --body "text"
 */
import https from 'node:https';

function parseArgs(argv: string[]): { issueId: string; body: string } {
  const args = argv.slice(2);
  let issueId = '';
  let body = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--issue-id') issueId = args[++i] ?? '';
    else if (args[i] === '--body') body = args[++i] ?? '';
  }
  if (!issueId || !body) {
    console.error('usage: tsx scripts/ci/post-linear-comment.ts --issue-id UTV2-NNN --body "text"');
    process.exit(1);
  }
  return { issueId, body };
}

async function getIssueUUID(token: string, identifier: string): Promise<string> {
  const query = JSON.stringify({
    query: `query { issue(id: ${JSON.stringify(identifier)}) { id } }`,
  });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.linear.app',
        path: '/graphql',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token },
      },
      res => {
        let data = '';
        res.on('data', c => {
          data += c;
        });
        res.on('end', () => {
          const parsed = JSON.parse(data) as { data?: { issue?: { id?: string } } };
          const id = parsed.data?.issue?.id;
          if (!id) reject(new Error(`Issue not found: ${identifier}`));
          else resolve(id);
        });
      },
    );
    req.on('error', reject);
    req.write(query);
    req.end();
  });
}

async function postComment(token: string, issueId: string, body: string): Promise<void> {
  const mutation = JSON.stringify({
    query: `mutation { commentCreate(input: { issueId: ${JSON.stringify(issueId)}, body: ${JSON.stringify(body)} }) { success } }`,
  });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.linear.app',
        path: '/graphql',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token },
      },
      res => {
        res.on('data', () => undefined);
        res.on('end', () => {
          resolve();
        });
      },
    );
    req.on('error', reject);
    req.write(mutation);
    req.end();
  });
}

async function main(): Promise<void> {
  const { issueId, body } = parseArgs(process.argv);
  const token = process.env['LINEAR_API_TOKEN'];
  if (!token) {
    console.error('LINEAR_API_TOKEN not set');
    process.exit(1);
  }
  const uuid = await getIssueUUID(token, issueId);
  await postComment(token, uuid, body);
  console.log(`Comment posted to ${issueId}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
