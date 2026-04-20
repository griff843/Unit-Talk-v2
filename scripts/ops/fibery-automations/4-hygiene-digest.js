// ============================================================
// Automation 4 — Daily Hygiene Digest
// Trigger: On Schedule → Daily → 10:00 AM
// Filter: Controls where Name is not empty
// Action: Script
// READ-ONLY — no status changes, no field updates on source entities
// ============================================================

const fibery = context.getService('fibery');

const firstEntity = args.currentEntities[0];
if (!firstEntity || firstEntity.id !== args.currentEntities[0].id) return;

const now = new Date();
const today = now.toISOString().slice(0, 10);
const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

// ---- Query Controls ----
const allControls = await fibery.executeSingleCommand({
  command: 'fibery.entity/query',
  args: {
    query: {
      'q/from': 'Unit Talk/Controls',
      'q/select': {
        'fibery/id': ['fibery/id'],
        'Unit Talk/Name': ['Unit Talk/Name'],
        'Unit Talk/Blocking Flag': ['Unit Talk/Blocking Flag'],
        'Unit Talk/Has Required Proof': ['Unit Talk/Has Required Proof'],
        'Unit Talk/Proof Count': ['Unit Talk/Proof Count'],
        'Unit Talk/Control ID': ['Unit Talk/Control ID'],
        'Unit Talk/Priority': {
          'q/from': 'Unit Talk/Priority',
          'q/select': { 'enum/name': ['enum/name'] }
        },
        'Unit Talk/Status': {
          'q/from': 'Unit Talk/Status',
          'q/select': { 'enum/name': ['enum/name'] }
        }
      },
      'q/limit': 'q/no-limit'
    }
  }
});
const controls = allControls || [];

// ---- Query Findings ----
const allFindings = await fibery.executeSingleCommand({
  command: 'fibery.entity/query',
  args: {
    query: {
      'q/from': 'Unit Talk/Findings',
      'q/select': {
        'fibery/id': ['fibery/id'],
        'Unit Talk/Name': ['Unit Talk/Name'],
        'Unit Talk/Severity': {
          'q/from': 'Unit Talk/Severity',
          'q/select': { 'enum/name': ['enum/name'] }
        },
        'Unit Talk/Status': {
          'q/from': 'Unit Talk/Status',
          'q/select': { 'enum/name': ['enum/name'] }
        }
      },
      'q/limit': 'q/no-limit'
    }
  }
});
const findings = allFindings || [];

// ---- Query Issues for stale work ----
const activeStates = [
  'In Progress', 'In Review', 'Ready', 'In Codex', 'In Claude',
  'In PM Review', 'In Proof', 'Ready for Codex', 'Ready for Claude'
];
const allIssues = await fibery.executeSingleCommand({
  command: 'fibery.entity/query',
  args: {
    query: {
      'q/from': 'Unit Talk/Issue',
      'q/select': {
        'fibery/id': ['fibery/id'],
        'Unit Talk/Name': ['Unit Talk/Name'],
        'fibery/modification-date': ['fibery/modification-date'],
        'workflow/state': {
          'q/from': 'workflow/state',
          'q/select': { 'enum/name': ['enum/name'] }
        }
      },
      'q/limit': 'q/no-limit'
    }
  }
});

// ---- Section 1: Control Health ----
const statusCounts = {};
for (const c of controls) {
  const status = c['Unit Talk/Status'] && c['Unit Talk/Status']['enum/name'] || 'No Status';
  statusCounts[status] = (statusCounts[status] || 0) + 1;
}

// ---- Section 2: Active Blockers ----
const blockingControls = controls.filter(c => c['Unit Talk/Blocking Flag'] === true);
const criticalFindings = findings.filter(f => {
  const sev = f['Unit Talk/Severity'] && f['Unit Talk/Severity']['enum/name'];
  const status = f['Unit Talk/Status'] && f['Unit Talk/Status']['enum/name'];
  return sev === 'Critical' && (status === 'Open' || status === 'In Triage' || status === 'In Progress');
});

// ---- Section 3: Stale Work ----
const staleIssues = (allIssues || []).filter(i => {
  const state = i['workflow/state'] && i['workflow/state']['enum/name'];
  const modDate = i['fibery/modification-date'];
  return activeStates.includes(state) && modDate && modDate < sevenDaysAgo;
});

// ---- Section 4: Missing Proof ----
const missingProof = controls.filter(c => c['Unit Talk/Has Required Proof'] === false);

// ---- Section 5: Critical Findings (all open critical) ----
const openCritical = findings.filter(f => {
  const sev = f['Unit Talk/Severity'] && f['Unit Talk/Severity']['enum/name'];
  const status = f['Unit Talk/Status'] && f['Unit Talk/Status']['enum/name'];
  return sev === 'Critical' && status !== 'Resolved' && status !== 'Rejected' && status !== 'Deferred';
});

// ---- Build markdown report ----
let md = `# Hygiene Digest — ${today}\n\n`;
md += `**Generated:** ${now.toISOString()}\n\n`;

// Section 1
md += `## Control Health\n\n`;
md += `| Status | Count |\n`;
md += `|--------|-------|\n`;
const statusOrder = ['Proven', 'Partially Proven', 'Unproven', 'Broken', 'Waived', 'Unassessed', 'Retired'];
for (const s of statusOrder) {
  if (statusCounts[s]) md += `| ${s} | ${statusCounts[s]} |\n`;
}
for (const [s, count] of Object.entries(statusCounts)) {
  if (!statusOrder.includes(s)) md += `| ${s} | ${count} |\n`;
}
md += `| **Total** | **${controls.length}** |\n`;

// Section 2
md += `\n## Active Blockers\n\n`;
md += `**Blocking Controls:** ${blockingControls.length} | **Critical Findings (active):** ${criticalFindings.length}\n\n`;
if (blockingControls.length > 0) {
  md += `### Blocking Controls\n\n`;
  md += `| Control ID | Name | Priority |\n`;
  md += `|-----------|------|----------|\n`;
  for (const c of blockingControls) {
    const id = c['Unit Talk/Control ID'] || '—';
    const name = c['Unit Talk/Name'] || 'Untitled';
    const pri = c['Unit Talk/Priority'] && c['Unit Talk/Priority']['enum/name'] || '—';
    md += `| ${id} | ${name} | ${pri} |\n`;
  }
}
if (criticalFindings.length > 0) {
  md += `\n### Critical Findings\n\n`;
  md += `| Finding | Status |\n`;
  md += `|---------|--------|\n`;
  for (const f of criticalFindings) {
    const name = f['Unit Talk/Name'] || 'Untitled';
    const status = f['Unit Talk/Status'] && f['Unit Talk/Status']['enum/name'] || '—';
    md += `| ${name} | ${status} |\n`;
  }
}

// Section 3
md += `\n## Stale Work (>7 days in active state)\n\n`;
md += `**Count:** ${staleIssues.length}\n\n`;
if (staleIssues.length > 0) {
  md += `| Name | State | Last Updated |\n`;
  md += `|------|-------|-------------|\n`;
  const sorted = [...staleIssues].sort((a, b) =>
    (a['fibery/modification-date'] || '').localeCompare(b['fibery/modification-date'] || '')
  );
  for (const i of sorted.slice(0, 15)) {
    const name = i['Unit Talk/Name'] || 'Untitled';
    const state = i['workflow/state'] && i['workflow/state']['enum/name'] || '—';
    const updated = (i['fibery/modification-date'] || '').slice(0, 10);
    md += `| ${name} | ${state} | ${updated} |\n`;
  }
  if (staleIssues.length > 15) md += `\n*...and ${staleIssues.length - 15} more*\n`;
}

// Section 4
md += `\n## Missing Proof\n\n`;
md += `**Controls without required proof:** ${missingProof.length}\n\n`;
if (missingProof.length > 0) {
  md += `| Control ID | Name | Status |\n`;
  md += `|-----------|------|--------|\n`;
  for (const c of missingProof) {
    const id = c['Unit Talk/Control ID'] || '—';
    const name = c['Unit Talk/Name'] || 'Untitled';
    const status = c['Unit Talk/Status'] && c['Unit Talk/Status']['enum/name'] || '—';
    md += `| ${id} | ${name} | ${status} |\n`;
  }
}

// Section 5
md += `\n## Critical Findings\n\n`;
md += `**Open/active critical findings:** ${openCritical.length}\n\n`;
if (openCritical.length > 0) {
  md += `| Finding | Severity | Status |\n`;
  md += `|---------|----------|--------|\n`;
  for (const f of openCritical) {
    const name = f['Unit Talk/Name'] || 'Untitled';
    const status = f['Unit Talk/Status'] && f['Unit Talk/Status']['enum/name'] || '—';
    md += `| ${name} | Critical | ${status} |\n`;
  }
}

md += `\n---\n*Read-only audit. No entities were modified.*\n`;

// Find or create Document
const docName = `Hygiene Digest — ${today}`;
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
  doc = await fibery.getEntityById('Unit Talk/Document', doc['fibery/id'], ['Description']);
}

const secret = doc['Unit Talk/Description'] ? doc['Unit Talk/Description'].Secret
  : doc['Description'] ? doc['Description'].Secret : null;
if (secret) {
  await fibery.setDocumentContent(secret, md, 'md');
}

console.log(`Hygiene Digest complete: ${controls.length} controls, ${findings.length} findings, ${staleIssues.length} stale issues`);
