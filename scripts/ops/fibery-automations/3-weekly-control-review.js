// ============================================================
// Automation 3 — Weekly Control Review Reminder
// Trigger: On Schedule → Weekly → Monday → 8:00 AM
// Filter: Controls where Name is not empty
// Action: Script
// READ-ONLY — no status changes, no field updates on source entities
// ============================================================

const fibery = context.getService('fibery');

const firstEntity = args.currentEntities[0];
if (!firstEntity || firstEntity.id !== args.currentEntities[0].id) return;

const now = new Date();
const today = now.toISOString().slice(0, 10);
// Week-of label: Monday of this week
const dayOfWeek = now.getDay();
const monday = new Date(now);
monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
const weekOf = monday.toISOString().slice(0, 10);

// Query all Controls with relevant fields
const allControls = await fibery.executeSingleCommand({
  command: 'fibery.entity/query',
  args: {
    query: {
      'q/from': 'Unit Talk/Controls',
      'q/select': {
        'fibery/id': ['fibery/id'],
        'Unit Talk/Name': ['Unit Talk/Name'],
        'Unit Talk/Needs PM Review': ['Unit Talk/Needs PM Review'],
        'Unit Talk/Blocking Flag': ['Unit Talk/Blocking Flag'],
        'Unit Talk/Has Required Proof': ['Unit Talk/Has Required Proof'],
        'Unit Talk/Next Review Due': ['Unit Talk/Next Review Due'],
        'Unit Talk/Proof Count': ['Unit Talk/Proof Count'],
        'Unit Talk/Open Findings Count': ['Unit Talk/Open Findings Count'],
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

// --- Section 1: Needs PM Review ---
const needsPMReview = controls.filter(c => c['Unit Talk/Needs PM Review'] === true);

// --- Section 2: Blocking Flag ---
const blockers = controls.filter(c => c['Unit Talk/Blocking Flag'] === true);

// --- Section 3: P0/P1 Unproven/Partially Proven (highest risk) ---
const highRisk = controls.filter(c => {
  const pri = c['Unit Talk/Priority'] && c['Unit Talk/Priority']['enum/name'];
  const status = c['Unit Talk/Status'] && c['Unit Talk/Status']['enum/name'];
  return (pri === 'P0' || pri === 'P1') &&
    (status === 'Unproven' || status === 'Partially Proven');
});

// --- Section 4: Next Review Due ---
const reviewDue = controls.filter(c => c['Unit Talk/Next Review Due'] === true);

// --- Build markdown report ---
let md = `# Weekly Control Review — Week of ${weekOf}\n\n`;
md += `**Generated:** ${now.toISOString()}\n\n`;

md += `## Controls Needing PM Review\n\n`;
md += `**Count:** ${needsPMReview.length}\n\n`;
if (needsPMReview.length > 0) {
  md += `| Control ID | Name | Status | Open Findings |\n`;
  md += `|-----------|------|--------|---------------|\n`;
  for (const c of needsPMReview) {
    const id = c['Unit Talk/Control ID'] || '—';
    const name = c['Unit Talk/Name'] || 'Untitled';
    const status = c['Unit Talk/Status'] && c['Unit Talk/Status']['enum/name'] || '—';
    md += `| ${id} | ${name} | ${status} | ${c['Unit Talk/Open Findings Count'] || 0} |\n`;
  }
}

md += `\n## Active Blockers\n\n`;
md += `**Count:** ${blockers.length}\n\n`;
if (blockers.length > 0) {
  md += `| Control ID | Name | Status | Priority |\n`;
  md += `|-----------|------|--------|----------|\n`;
  for (const c of blockers) {
    const id = c['Unit Talk/Control ID'] || '—';
    const name = c['Unit Talk/Name'] || 'Untitled';
    const status = c['Unit Talk/Status'] && c['Unit Talk/Status']['enum/name'] || '—';
    const pri = c['Unit Talk/Priority'] && c['Unit Talk/Priority']['enum/name'] || '—';
    md += `| ${id} | ${name} | ${status} | ${pri} |\n`;
  }
}

md += `\n## Highest Risk: P0/P1 Unproven or Partially Proven\n\n`;
md += `**Count:** ${highRisk.length}\n\n`;
if (highRisk.length > 0) {
  md += `| Control ID | Name | Priority | Status | Proof Count |\n`;
  md += `|-----------|------|----------|--------|-------------|\n`;
  for (const c of highRisk) {
    const id = c['Unit Talk/Control ID'] || '—';
    const name = c['Unit Talk/Name'] || 'Untitled';
    const pri = c['Unit Talk/Priority'] && c['Unit Talk/Priority']['enum/name'] || '—';
    const status = c['Unit Talk/Status'] && c['Unit Talk/Status']['enum/name'] || '—';
    md += `| ${id} | ${name} | ${pri} | ${status} | ${c['Unit Talk/Proof Count'] || 0} |\n`;
  }
}

md += `\n## Controls with Next Review Due\n\n`;
md += `**Count:** ${reviewDue.length}\n\n`;
if (reviewDue.length > 0) {
  md += `| Control ID | Name | Status |\n`;
  md += `|-----------|------|--------|\n`;
  for (const c of reviewDue) {
    const id = c['Unit Talk/Control ID'] || '—';
    const name = c['Unit Talk/Name'] || 'Untitled';
    const status = c['Unit Talk/Status'] && c['Unit Talk/Status']['enum/name'] || '—';
    md += `| ${id} | ${name} | ${status} |\n`;
  }
}

md += `\n---\n*Read-only audit. No entities were modified.*\n`;

// Find or create Document
const docName = `Weekly Control Review — ${weekOf}`;
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

console.log(`Weekly Control Review complete: ${needsPMReview.length} need review, ${blockers.length} blockers, ${highRisk.length} high-risk`);
