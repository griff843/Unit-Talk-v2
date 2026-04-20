// ============================================================
// Automation 2 — Daily Missing Governance Audit
// Trigger: On Schedule → Daily → 9:00 AM
// Filter: Controls where Name is not empty
// Action: Script
// READ-ONLY — no status changes, no field updates on source entities
// ============================================================

const fibery = context.getService('fibery');

const firstEntity = args.currentEntities[0];
if (!firstEntity || firstEntity.id !== args.currentEntities[0].id) return;

const now = new Date();
const today = now.toISOString().slice(0, 10);

// --- Section 1: Issues missing governance fields ---
// Active states (not Done, Canceled, Duplicate, Deferred)
const terminalStates = ['Done', 'Canceled', 'Duplicate', 'Deferred', 'Backlog'];

const allIssues = await fibery.executeSingleCommand({
  command: 'fibery.entity/query',
  args: {
    query: {
      'q/from': 'Unit Talk/Issue',
      'q/select': {
        'fibery/id': ['fibery/id'],
        'Unit Talk/Name': ['Unit Talk/Name'],
        'Unit Talk/Assignee': {
          'q/from': 'Unit Talk/Assignee',
          'q/select': { 'Unit Talk/Name': ['Unit Talk/Name'] }
        },
        'Unit Talk/Priority': {
          'q/from': 'Unit Talk/Priority',
          'q/select': { 'enum/name': ['enum/name'] }
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

const activeIssues = (allIssues || []).filter(i => {
  const state = i['workflow/state'] && i['workflow/state']['enum/name'];
  return state && !terminalStates.includes(state);
});

const missingGovernance = activeIssues.filter(i => {
  const priority = i['Unit Talk/Priority'] && i['Unit Talk/Priority']['enum/name'];
  const assignee = i['Unit Talk/Assignee'] && i['Unit Talk/Assignee']['Unit Talk/Name'];
  return !priority || priority === 'No Priority' || !assignee;
});

// --- Section 2: Controls where Status = Proven AND Proof Count = 0 ---
const allControls = await fibery.executeSingleCommand({
  command: 'fibery.entity/query',
  args: {
    query: {
      'q/from': 'Unit Talk/Controls',
      'q/select': {
        'fibery/id': ['fibery/id'],
        'Unit Talk/Name': ['Unit Talk/Name'],
        'Unit Talk/Proof Count': ['Unit Talk/Proof Count'],
        'Unit Talk/Has Required Proof': ['Unit Talk/Has Required Proof'],
        'Unit Talk/Status': {
          'q/from': 'Unit Talk/Status',
          'q/select': { 'enum/name': ['enum/name'] }
        }
      },
      'q/limit': 'q/no-limit'
    }
  }
});

const provenNoProof = (allControls || []).filter(c => {
  const status = c['Unit Talk/Status'] && c['Unit Talk/Status']['enum/name'];
  return status === 'Proven' && (c['Unit Talk/Proof Count'] || 0) === 0;
});

// --- Section 3: Controls where Has Required Proof = false ---
const missingProof = (allControls || []).filter(c => {
  return c['Unit Talk/Has Required Proof'] === false;
});

// --- Build markdown report ---
let md = `# Governance Gaps — ${today}\n\n`;
md += `**Generated:** ${now.toISOString()}\n\n`;

md += `## Section 1: Issues Missing Governance Fields\n\n`;
md += `**Count:** ${missingGovernance.length} active issues with missing Priority or Assignee\n\n`;
if (missingGovernance.length > 0) {
  md += `| Name | State | Priority | Assignee |\n`;
  md += `|------|-------|----------|----------|\n`;
  for (const i of missingGovernance.slice(0, 25)) {
    const name = i['Unit Talk/Name'] || 'Untitled';
    const state = i['workflow/state'] && i['workflow/state']['enum/name'] || '—';
    const pri = i['Unit Talk/Priority'] && i['Unit Talk/Priority']['enum/name'] || 'MISSING';
    const assignee = i['Unit Talk/Assignee'] && i['Unit Talk/Assignee']['Unit Talk/Name'] || 'MISSING';
    md += `| ${name} | ${state} | ${pri} | ${assignee} |\n`;
  }
  if (missingGovernance.length > 25) md += `\n*...and ${missingGovernance.length - 25} more*\n`;
}

md += `\n## Section 2: Proven Controls Without Proof\n\n`;
md += `**Count:** ${provenNoProof.length}\n\n`;
if (provenNoProof.length > 0) {
  md += `| Control Name | Status | Proof Count |\n`;
  md += `|-------------|--------|-------------|\n`;
  for (const c of provenNoProof) {
    md += `| ${c['Unit Talk/Name'] || 'Untitled'} | Proven | 0 |\n`;
  }
}

md += `\n## Section 3: Controls Missing Required Proof\n\n`;
md += `**Count:** ${missingProof.length}\n\n`;
if (missingProof.length > 0) {
  md += `| Control Name | Status | Has Required Proof |\n`;
  md += `|-------------|--------|--------------------|\n`;
  for (const c of missingProof) {
    const status = c['Unit Talk/Status'] && c['Unit Talk/Status']['enum/name'] || '—';
    md += `| ${c['Unit Talk/Name'] || 'Untitled'} | ${status} | false |\n`;
  }
}

md += `\n---\n*Read-only audit. No entities were modified.*\n`;

// Find or create Document
const docName = `Governance Gaps — ${today}`;
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

console.log(`Governance Gaps audit complete: ${missingGovernance.length} issues, ${provenNoProof.length} proven-no-proof, ${missingProof.length} missing proof`);
