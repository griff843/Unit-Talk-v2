import { defaultQueuePath, parseQueue, readText } from './queue-lib.mjs';

const queuePath = process.argv[2] ? process.argv[2] : defaultQueuePath;
const markdown = readText(queuePath);
const issues = parseQueue(markdown);
const statuses = ['READY', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED'];
const laneOrder = ['lane:codex', 'lane:claude', 'lane:augment'];

for (const status of statuses) {
  console.log(status);
  console.log('-'.repeat(status.length));

  const matching = issues.filter((issue) => issue.status === status);
  if (matching.length === 0) {
    console.log('(none)');
    console.log('');
    continue;
  }

  for (const lane of laneOrder) {
    const inLane = matching.filter((issue) => issue.lane === lane);
    if (inLane.length === 0) {
      continue;
    }

    console.log(lane);
    for (const issue of inLane) {
      const parts = [`- ${issue.id}: ${issue.title}`];
      if (issue.branch && issue.branch !== 'â€”' && issue.branch !== '—') {
        parts.push(`branch=${issue.branch}`);
      }
      if (issue.pr && issue.pr !== 'â€”' && issue.pr !== '—') {
        parts.push(`pr=${issue.pr}`);
      }
      console.log(parts.join(' | '));
    }
  }

  console.log('');
}
