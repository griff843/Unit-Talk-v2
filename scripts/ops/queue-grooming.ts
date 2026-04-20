/**
 * Queue Grooming — finds Linear issues in Ready states without tier labels
 *
 * Prevents dispatch queue starvation by flagging issues that need grooming.
 *
 * Usage:
 *   npx tsx scripts/ops/queue-grooming.ts
 *   npx tsx scripts/ops/queue-grooming.ts --json
 */

import { linearQuery } from './linear-client.js';

const token = process.env.LINEAR_API_TOKEN?.trim() ?? '';
const teamKey = process.env.LINEAR_TEAM_KEY?.trim() ?? 'UTV2';
const jsonMode = process.argv.includes('--json');

interface UngroomedIssue {
  identifier: string;
  title: string;
  state: string;
  labels: string[];
  missing: string[];
}

async function main(): Promise<void> {
  if (!token) {
    console.log('[queue-grooming] LINEAR_API_TOKEN not set');
    process.exitCode = 1;
    return;
  }

  const opts = { token, userAgent: 'unit-talk-queue-grooming' };

  // Resolve team
  const teamResult = await linearQuery<{
    teams: { nodes: Array<{ id: string }> };
  }>(
    `query { teams(filter: { key: { eq: "${teamKey}" } }, first: 1) { nodes { id } } }`,
    {},
    opts,
  );

  const teamId = teamResult.data?.teams.nodes[0]?.id;
  if (!teamId) {
    console.log('[queue-grooming] Team not found');
    return;
  }

  // Find unstarted issues (Ready states)
  const result = await linearQuery<{
    team: {
      issues: {
        nodes: Array<{
          identifier: string;
          title: string;
          description: string | null;
          state: { name: string; type: string } | null;
          labels: { nodes: Array<{ name: string }> };
        }>;
      };
    } | null;
  }>(
    `query Q($teamId: String!) {
       team(id: $teamId) {
         issues(
           first: 50
           filter: { state: { type: { eq: "unstarted" } } }
           orderBy: updatedAt
         ) {
           nodes {
             identifier title description
             labels { nodes { name } }
             state { name type }
           }
         }
       }
     }`,
    { teamId },
    opts,
  );

  const issues = result.data?.team?.issues.nodes ?? [];
  const ungroomed: UngroomedIssue[] = [];

  for (const issue of issues) {
    const labels = issue.labels.nodes.map((l) => l.name);
    const missing: string[] = [];

    // Check for tier label
    const hasTier = labels.some((l) => /^tier:T[123]$/i.test(l));
    if (!hasTier) missing.push('tier label (tier:T1/T2/T3)');

    // Check for acceptance criteria
    const desc = issue.description ?? '';
    const hasAC = /acceptance\s+criteria|AC:|what\s+to\s+do/i.test(desc);
    if (!hasAC) missing.push('acceptance criteria');

    if (missing.length > 0) {
      ungroomed.push({
        identifier: issue.identifier,
        title: issue.title.slice(0, 80),
        state: issue.state?.name ?? 'unknown',
        labels,
        missing,
      });
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify({
      total_ready: issues.length,
      ungroomed: ungroomed.length,
      groomed: issues.length - ungroomed.length,
      issues: ungroomed,
    }, null, 2));
  } else {
    console.log(`[queue-grooming] ${issues.length} Ready issues, ${ungroomed.length} need grooming\n`);

    if (ungroomed.length === 0) {
      console.log('All Ready issues are properly groomed.');
    } else {
      for (const issue of ungroomed) {
        console.log(`  ${issue.identifier} [${issue.state}] "${issue.title}"`);
        console.log(`    Missing: ${issue.missing.join(', ')}`);
      }
      console.log(`\nAdd tier labels and acceptance criteria to make these dispatchable.`);
    }
  }
}

main().catch((err) => {
  console.error('[queue-grooming] Fatal:', err);
  process.exitCode = 1;
});
