// ============================================================
// Automation 1 — Daily Stale Item Audit
// Trigger: On Schedule → Daily → 9:00 AM
// Filter: Controls where Name is not empty
// Action: Script
// READ-ONLY — no status changes, no field updates on source entities
// ============================================================

const fibery = context.getService('fibery');

// Guard: only run once per batch (script fires for all matched entities)
const firstEntity = args.currentEntities[0];
if (!firstEntity || firstEntity.id !== args.currentEntities[0].id) return;

const now = new Date();
const today = now.toISOString().slice(0, 10);
const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();

// Active workflow states for Issues (stale = updated > 7 days ago while in these states)
const activeStates = [
  'In Progress', 'In Review', 'Ready', 'In Codex', 'In Claude',
  'In PM Review', 'In Proof', 'Ready for Codex', 'Ready for Claude'
];

// Query all Issues with their workflow state and modification date
const issues = await fibery.executeSingleCommand({
  command: 'fibery.entity/query',
  args: {
    query: {
      'q/from': 'Unit Talk/Issue',
      'q/select': {
        'fibery/id': ['fibery/id'],
        'Unit Talk/Name': ['Unit Talk/Name'],
        'fibery/modification-date': ['fibery/modification-date'],
        'Unit Talk/Assignee': {
          'q/from': 'Unit Talk/Assignee',
          'q/select': { 'Unit Talk/Name': ['Unit Talk/Name'] }
        },
        'workflow/state': {
          'q/from': 'workflow/state',
          'q/select': { 'enum/name': ['enum/name'] }
        }
      },
      'q/limit': 'q/no-limit'
    }
  }
});

// Filter to active-state issues updated > 7 days ago
const staleIssues = (issues || []).filter(issue => {
  const stateName = issue['workflow/state'] && issue['workflow/state']['enum/name'];
  const modDate = issue['fibery/modification-date'];
  return activeStates.includes(stateName) && modDate && modDate < sevenDaysAgo;
});

// Split by severity
const stale7 = staleIssues.filter(i => i['fibery/modification-date'] >= fourteenDaysAgo);
const stale14 = staleIssues.filter(i => i['fibery/modification-date'] < fourteenDaysAgo);

// Top 5 oldest
const sorted = [...staleIssues].sort((a, b) =>
  (a['fibery/modification-date'] || '').localeCompare(b['fibery/modification-date'] || '')
);
const top5 = sorted.slice(0, 5);

// Breakdown by workflow state
const byState = {};
for (const issue of staleIssues) {
  const state = issue['workflow/state'] && issue['workflow/state']['enum/name'] || 'Unknown';
  byState[state] = (byState[state] || 0) + 1;
}

// Build markdown report
let md = `# Stale Item Audit — ${today}\n\n`;
md += `**Generated:** ${now.toISOString()}\n\n`;
md += `## Summary\n\n`;
md += `- **Total stale items (>7 days):** ${staleIssues.length}\n`;
md += `- **Stale 7–14 days:** ${stale7.length}\n`;
md += `- **Stale >14 days (critical):** ${stale14.length}\n\n`;

md += `## Top 5 Oldest Stale Items\n\n`;
md += `| Name | Workflow State | Last Updated | Assignee |\n`;
md += `|------|---------------|--------------|----------|\n`;
for (const item of top5) {
  const name = item['Unit Talk/Name'] || 'Untitled';
  const state = item['workflow/state'] && item['workflow/state']['enum/name'] || '—';
  const updated = (item['fibery/modification-date'] || '').slice(0, 10);
  const assignee = item['Unit Talk/Assignee'] && item['Unit Talk/Assignee']['Unit Talk/Name'] || '—';
  md += `| ${name} | ${state} | ${updated} | ${assignee} |\n`;
}

md += `\n## Breakdown by Workflow State\n\n`;
md += `| State | Count |\n`;
md += `|-------|-------|\n`;
for (const [state, count] of Object.entries(byState).sort((a, b) => b[1] - a[1])) {
  md += `| ${state} | ${count} |\n`;
}

md += `\n---\n*Read-only audit. No entities were modified.*\n`;

// Find or create the audit Document
const docName = `Stale Item Audit — ${today}`;
const existingDocs = await fibery.executeSingleCommand({
  command: 'fibery.entity/query',
  args: {
    query: {
      'q/from': 'Unit Talk/Document',
      'q/select': {
        'fibery/id': ['fibery/id'],
        'Unit Talk/Name': ['Unit Talk/Name'],
        'Unit Talk/Description': ['Unit Talk/Description']
      },
      'q/where': ['=', ['Unit Talk/Name'], docName],
      'q/limit': 1
    }
  }
});

let doc;
if (existingDocs && existingDocs.length > 0) {
  doc = existingDocs[0];
} else {
  doc = await fibery.createEntity('Unit Talk/Document', { 'Unit Talk/Name': docName });
  // Re-fetch to get Description secret
  doc = await fibery.getEntityById('Unit Talk/Document', doc['fibery/id'], ['Description']);
}

// Set document content
const secret = doc['Unit Talk/Description'] ? doc['Unit Talk/Description'].Secret
  : doc['Description'] ? doc['Description'].Secret : null;
if (secret) {
  await fibery.setDocumentContent(secret, md, 'md');
}

console.log(`Stale Item Audit complete: ${staleIssues.length} stale items found`);
