import https from 'https';

const TEAM_ID = process.env.LINEAR_TEAM_ID ?? '';
const API_KEY = process.env.LINEAR_API_TOKEN ?? '';

if (!TEAM_ID) {
  throw new Error('LINEAR_TEAM_ID is required');
}

if (!API_KEY) {
  throw new Error('LINEAR_API_TOKEN is required');
}

async function gql(query, variables = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const req = https.request({
      hostname: 'api.linear.app',
      path: '/graphql',
      method: 'POST',
      headers: {
        'Authorization': API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const parsed = JSON.parse(data);
        if (parsed.errors) reject(new Error(JSON.stringify(parsed.errors)));
        else resolve(parsed.data);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

let existingLabels = {};

async function loadExistingLabels() {
  // Load team-level labels
  const teamData = await gql(`
    query { team(id: "${TEAM_ID}") { labels(first: 250) { nodes { id name } } } }
  `);
  for (const lbl of teamData.team.labels.nodes) {
    existingLabels[lbl.name.toLowerCase()] = lbl.id;
  }
  // Load workspace-level labels (inherited by all teams)
  const wsData = await gql(`
    query { issueLabels(first: 250) { nodes { id name } } }
  `);
  for (const lbl of wsData.issueLabels.nodes) {
    existingLabels[lbl.name.toLowerCase()] = lbl.id;
  }
  console.log(`  loaded ${Object.keys(existingLabels).length} existing labels (team + workspace)`);
}

async function createLabel(name, color) {
  if (existingLabels[name.toLowerCase()]) {
    console.log(`  label (exists): ${name} = ${existingLabels[name.toLowerCase()]}`);
    return { id: existingLabels[name.toLowerCase()], name };
  }
  const data = await gql(`
    mutation CreateLabel($name: String!, $color: String!, $teamId: String!) {
      issueLabelCreate(input: { name: $name, color: $color, teamId: $teamId }) {
        success issueLabel { id name }
      }
    }
  `, { name, color, teamId: TEAM_ID });
  const lbl = data.issueLabelCreate.issueLabel;
  console.log(`  label: ${lbl.name} = ${lbl.id}`);
  return lbl;
}

let existingProjects = {};

async function loadExistingProjects() {
  const data = await gql(`
    query { team(id: "${TEAM_ID}") { projects(first: 50) { nodes { id name } } } }
  `);
  for (const p of data.team.projects.nodes) {
    existingProjects[p.name] = p.id;
  }
  console.log(`  loaded ${Object.keys(existingProjects).length} existing projects`);
}

async function createProject(name, summary, description, priority) {
  if (existingProjects[name]) {
    console.log(`  project (exists): ${name} = ${existingProjects[name]}`);
    return { id: existingProjects[name], name };
  }
  // description field is capped at 255 chars; use summary only
  const shortDesc = summary.substring(0, 254);
  const data = await gql(`
    mutation CreateProject($name: String!, $description: String!, $teamIds: [String!]!, $priority: Int) {
      projectCreate(input: { name: $name, description: $description, teamIds: $teamIds, priority: $priority }) {
        success project { id name url }
      }
    }
  `, { name, description: shortDesc, teamIds: [TEAM_ID], priority });
  const p = data.projectCreate.project;
  console.log(`  project: ${p.name} = ${p.id}`);
  return p;
}

async function createMilestone(projectId, name, description) {
  const data = await gql(`
    mutation CreateMilestone($name: String!, $description: String!, $projectId: String!) {
      projectMilestoneCreate(input: { name: $name, description: $description, projectId: $projectId }) {
        success projectMilestone { id name }
      }
    }
  `, { name, description, projectId });
  const m = data.projectMilestoneCreate.projectMilestone;
  console.log(`  milestone: ${m.name} = ${m.id}`);
  return m;
}

let existingIssues = new Set();

async function loadExistingIssues() {
  const data = await gql(`
    query { team(id: "${TEAM_ID}") { issues(first: 250) { nodes { id title } } } }
  `);
  for (const i of data.team.issues.nodes) {
    existingIssues.add(i.title);
  }
  console.log(`  loaded ${existingIssues.size} existing issues`);
}

async function createIssue(title, description, projectId, labelIds, priority) {
  if (existingIssues.has(title)) {
    console.log(`  issue (exists): ${title.substring(0, 60)}`);
    return null;
  }
  const data = await gql(`
    mutation CreateIssue($title: String!, $description: String!, $teamId: String!, $projectId: String, $labelIds: [String!], $priority: Int) {
      issueCreate(input: { title: $title, description: $description, teamId: $teamId, projectId: $projectId, labelIds: $labelIds, priority: $priority }) {
        success issue { id identifier title url }
      }
    }
  `, { title, description, teamId: TEAM_ID, projectId, labelIds, priority });
  const i = data.issueCreate.issue;
  console.log(`  issue: ${i.identifier} ${i.title}`);
  return i;
}

// ── WORKFLOW STATES ──────────────────────────────────────────────────────────
async function createWorkflowState(name, type, color) {
  const data = await gql(`
    mutation CreateState($name: String!, $type: String!, $color: String!, $teamId: String!) {
      workflowStateCreate(input: { name: $name, type: $type, color: $color, teamId: $teamId }) {
        success workflowState { id name type }
      }
    }
  `, { name, type, color, teamId: TEAM_ID });
  const s = data.workflowStateCreate.workflowState;
  console.log(`  state: ${s.name} (${s.type}) = ${s.id}`);
  return s;
}

async function getWorkflowStates() {
  const data = await gql(`
    query { team(id: "${TEAM_ID}") { states { nodes { id name type } } } }
  `);
  return data.team.states.nodes;
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {

  // 0. PRELOAD EXISTING DATA
  console.log('\n=== Loading existing state ===');
  await loadExistingLabels();
  await loadExistingProjects();
  await loadExistingIssues();

  // 1. LABELS
  console.log('\n=== Creating Labels ===');
  const labels = {};
  const labelDefs = [
    // Delivery
    ['contract', '#BB87FC'], ['schema', '#4EA7FC'], ['api', '#4EA7FC'],
    ['worker', '#95A2B3'], ['frontend', '#95A2B3'], ['operator-web', '#95A2B3'],
    ['discord', '#5865F2'], ['settlement', '#27AE60'], ['migration', '#F2C94C'],
    ['observability', '#56CCF2'], ['docs', '#95A2B3'], ['testing', '#27AE60'],
    ['security', '#EB5757'], ['infra', '#95A2B3'], ['data', '#4EA7FC'], ['tooling', '#95A2B3'],
    // Priority/Risk
    ['p0', '#EB5757'], ['p1', '#F2994A'], ['p2', '#F2C94C'], ['p3', '#95A2B3'],
    ['blocked', '#EB5757'], ['decision-needed', '#F2C94C'], ['cutover-risk', '#EB5757'],
    ['truth-drift', '#F2994A'], ['external-dependency', '#95A2B3'],
    // Work type
    ['build', '#4EA7FC'], ['refactor', '#4EA7FC'], ['delete', '#EB5757'],
    ['investigation', '#BB87FC'], ['adr', '#BB87FC'], ['spike', '#F2C94C'],
    ['bug', '#EB5757'], ['chore', '#95A2B3'],
    // Ownership
    ['codex', '#0D9373'], ['claude', '#BB87FC'], ['chatgpt', '#74AA9C'], ['claude-os', '#BB87FC'],
  ];
  for (const [name, color] of labelDefs) {
    const lbl = await createLabel(name, color);
    labels[name] = lbl.id;
  }

  // 2. WORKFLOW STATES
  console.log('\n=== Checking Workflow States ===');
  const existingStates = await getWorkflowStates();
  console.log('  existing:', existingStates.map(s => s.name).join(', '));
  const stateMap = {};
  for (const s of existingStates) stateMap[s.name] = s.id;

  // Create missing states: Ready, In Review, Blocked
  const wantedStates = [
    { name: 'Ready', type: 'unstarted', color: '#27AE60' },
    { name: 'In Review', type: 'started', color: '#F2C94C' },
    { name: 'Blocked', type: 'started', color: '#EB5757' },
  ];
  for (const { name, type, color } of wantedStates) {
    if (!stateMap[name]) {
      const s = await createWorkflowState(name, type, color);
      stateMap[s.name] = s.id;
    }
  }

  // 3. PROJECTS
  console.log('\n=== Creating Projects ===');
  const projects = {};

  projects.r1 = await createProject(
    'UTV2-R1 Foundation',
    'Repo bootstrap, workspace tooling, CI, environment strategy, and baseline operational controls',
    'Create the clean repo, workspace tooling, CI, environment strategy, and baseline operational controls.\n\nExit condition: repo, CI, env management, and bootstrap documentation are stable enough to support contract-first implementation.',
    1
  );
  projects.r2 = await createProject(
    'UTV2-R2 Contracts',
    'Ratify domain, authority, lifecycle, distribution, settlement, and run-audit contracts',
    'Ratify the domain, authority, lifecycle, distribution, settlement, and run-audit contracts.\n\nExit condition: all foundation contracts exist, are linked, and are accepted as implementation authority.',
    1
  );
  projects.r3 = await createProject(
    'UTV2-R3 Core Pipeline',
    'Canonical schema, submission flow, API write path, and lifecycle skeleton',
    'Stand up canonical schema, submission flow, API write path, and lifecycle skeleton.\n\nExit condition: a submission can become a canonical pick through the approved path.',
    1
  );
  projects.r4 = await createProject(
    'UTV2-R4 Distribution',
    'Outbox-driven posting and receipt capture for downstream channels',
    'Build outbox-driven posting and receipt capture for downstream channels.\n\nExit condition: a canonical pick can be posted and receive durable receipts end to end.',
    2
  );
  projects.r5 = await createProject(
    'UTV2-R5 Settlement',
    'Grading, settlement records, correction handling, and auditability',
    'Implement grading, settlement records, correction handling, and auditability.\n\nExit condition: picks can be settled without mutating immutable history.',
    2
  );
  projects.r6 = await createProject(
    'UTV2-R6 Operator Control',
    'Operator read model, health visibility, and controlled override tooling',
    'Create the operator read model, health visibility, and controlled override tooling.\n\nExit condition: operators can observe and intervene through approved authority boundaries.',
    3
  );
  projects.r7 = await createProject(
    'UTV2-R7 Migration',
    'Map legacy surfaces, port approved logic, validate parity, and stage cutover',
    'Map legacy surfaces, port approved logic, validate parity, and stage cutover.\n\nExit condition: migration ledger is complete and shadow validation is acceptable.',
    2
  );
  projects.r8 = await createProject(
    'UTV2-R8 Hardening',
    'Security, resilience, incident handling, and production readiness',
    'Address security, resilience, incident handling, and production readiness.\n\nExit condition: pre-cutover risks are reduced to an acceptable level with rollback and observability in place.',
    2
  );

  // 4. MILESTONES
  console.log('\n=== Creating Milestones ===');
  // Milestones must be tied to a project — attach to the project most related
  await createMilestone(projects.r2.id, 'UTV2-M1 Ratified Contracts',
    'All core architecture and authority contracts exist and are linked from the active roadmap');
  await createMilestone(projects.r3.id, 'UTV2-M2 Canonical Schema Live',
    'Canonical tables, migrations, and type generation path exist for V2');
  await createMilestone(projects.r3.id, 'UTV2-M3 Submission Path Live',
    'Intake to canonical pick path functions end to end in local or staging');
  await createMilestone(projects.r3.id, 'UTV2-M4 Lifecycle Enforced',
    'Lifecycle transition authority and guards are implemented and tested');
  await createMilestone(projects.r4.id, 'UTV2-M5 Discord Post End-to-End',
    'Distribution outbox, posting flow, and receipt capture work together');
  await createMilestone(projects.r5.id, 'UTV2-M6 Settlement End-to-End',
    'Settlement flow creates authoritative records with audit support');
  await createMilestone(projects.r6.id, 'UTV2-M7 Operator Control v1',
    'Read model, health visibility, and approved interventions are available');
  await createMilestone(projects.r8.id, 'UTV2-M8 Cutover Ready',
    'Migration ledger, rollback, and readiness evidence are complete');

  // 5. ISSUES
  console.log('\n=== Creating Issues ===');

  const L = labels; // shorthand

  // UTV2-FOUND-01
  await createIssue(
    'UTV2-FOUND-01: Create repo bootstrap, workspace tooling, and package boundaries',
    `## Problem\nThe new repo needs a stable monorepo foundation before feature work begins.\n\n## Why now\nEvery later stream depends on package boundaries, scripts, and workspace structure being consistent.\n\n## Source of truth or contract\n- docs/01_principles/rebuild_charter.md\n- docs/05_operations/repo_bootstrap.md\n\n## Scope in\n- Root workspace files\n- App and package manifests\n- TypeScript bootstrap\n\n## Scope out\n- CI implementation\n- Feature logic\n\n## Acceptance criteria\n- Workspace installs successfully\n- Type-check passes\n- Build passes\n\n## Risks\n- Overfitting early package structure\n\n## Test proof required\n- pnpm type-check\n- pnpm build\n\n## Migration impact\n- None directly\n\n## Dependencies\n- None\n\n## Owner\n- Engineering\n\n## Agent lane\n- codex`,
    projects.r1.id,
    [L.tooling, L.infra, L.build, L.codex, L.p1],
    2
  );

  // UTV2-FOUND-02
  await createIssue(
    'UTV2-FOUND-02: Add CI skeleton for install, type-check, and build',
    `## Problem\nThe repo currently lacks an automated validation path for bootstrap and future changes.\n\n## Why now\nContract-first work still needs fast regression checks from day one.\n\n## Source of truth or contract\n- docs/05_operations/repo_bootstrap.md\n- docs/05_operations/tooling_setup.md\n\n## Scope in\n- CI workflow skeleton\n- Install, type-check, build jobs\n\n## Scope out\n- Deploy workflows\n- Environment secret provisioning\n\n## Acceptance criteria\n- CI runs on push and pull request\n- Failing type-check or build blocks merge\n\n## Risks\n- CI assumptions may drift from local development\n\n## Test proof required\n- CI green run on bootstrap branch\n\n## Migration impact\n- None\n\n## Dependencies\n- UTV2-FOUND-01\n\n## Owner\n- Engineering\n\n## Agent lane\n- codex`,
    projects.r1.id,
    [L.tooling, L.testing, L.infra, L.build, L.p1],
    2
  );

  // UTV2-FOUND-03
  await createIssue(
    'UTV2-FOUND-03: Define environment variable ownership and local env templates',
    `## Problem\nThe repo needs a clean rule for shared defaults versus machine-local secrets.\n\n## Why now\nService integrations will become messy quickly if env ownership is implicit.\n\n## Source of truth or contract\n- docs/02_architecture/contracts/environment_contract.md\n- docs/05_operations/tooling_setup.md\n\n## Scope in\n- .env defaults\n- local.env local secret template\n- docs alignment\n\n## Scope out\n- Secret manager rollout\n\n## Acceptance criteria\n- Shared defaults and local overrides are documented\n- Secret-bearing files are handled safely\n\n## Risks\n- Developers may still place secrets in the wrong file\n\n## Test proof required\n- Repo review\n- Type-check remains green\n\n## Migration impact\n- None\n\n## Dependencies\n- UTV2-FOUND-01\n\n## Owner\n- Engineering\n\n## Agent lane\n- codex`,
    projects.r1.id,
    [L.infra, L.docs, L.tooling, L.p1],
    2
  );

  // UTV2-FOUND-04 (from setup doc — not in issue pack detail, create with basic body)
  await createIssue(
    'UTV2-FOUND-04: Establish docs hierarchy and decision logging rules',
    `## Problem\nThe repo needs an agreed structure for documentation and a clear rule for logging decisions.\n\n## Why now\nWithout a docs hierarchy, contracts and ADRs will accumulate without clear authority.\n\n## Source of truth or contract\n- docs/01_principles/rebuild_charter.md\n\n## Scope in\n- Docs folder structure\n- Decision logging conventions\n- ADR template\n\n## Scope out\n- Tooling automation for doc enforcement\n\n## Acceptance criteria\n- Docs hierarchy is documented and adopted\n- Decision log template exists\n\n## Risks\n- Inconsistent doc placement over time\n\n## Test proof required\n- Repo review\n\n## Migration impact\n- None\n\n## Dependencies\n- UTV2-FOUND-01\n\n## Owner\n- Engineering\n\n## Agent lane\n- claude`,
    projects.r1.id,
    [L.docs, L.tooling, L.p1],
    2
  );

  // UTV2-CONTRACT-01
  await createIssue(
    'UTV2-CONTRACT-01: Ratify submission contract',
    `## Problem\nThe rebuild needs a single approved path for inbound submission before implementation expands.\n\n## Why now\nSubmission is the first authoritative entry point into the platform.\n\n## Source of truth or contract\n- docs/02_architecture/contracts/submission_contract.md\n- docs/02_architecture/domain_model.md\n\n## Scope in\n- Allowed submission path\n- Validation expectations\n- Event emission expectations\n\n## Scope out\n- UI details\n- Final schema implementation\n\n## Acceptance criteria\n- Contract language is complete enough to guide implementation\n- Open decisions are explicitly listed\n\n## Risks\n- Premature contract detail may lock poor assumptions\n\n## Test proof required\n- Contract review signoff\n\n## Migration impact\n- Determines what parts of legacy intake are reusable\n\n## Dependencies\n- UTV2-FOUND-01\n\n## Owner\n- Architecture\n\n## Agent lane\n- claude`,
    projects.r2.id,
    [L.contract, L.api, L.docs, L.adr, L.p1],
    2
  );

  // UTV2-CONTRACT-02
  await createIssue(
    'UTV2-CONTRACT-02: Ratify writer authority contract',
    `## Problem\nThe platform needs explicit write authority boundaries before service logic is ported.\n\n## Why now\nSingle-writer discipline is one of the main reasons to rebuild cleanly.\n\n## Source of truth or contract\n- docs/02_architecture/contracts/writer_authority_contract.md\n- docs/01_principles/rebuild_charter.md\n\n## Scope in\n- Canonical writer declaration\n- Named writer roles\n- Service boundary expectations\n\n## Scope out\n- Detailed lifecycle states\n\n## Acceptance criteria\n- Contract clearly states who may write what and under which named roles\n\n## Risks\n- Ambiguous operator authority\n\n## Test proof required\n- Contract review signoff\n\n## Migration impact\n- Controls which legacy write paths may be considered for reuse\n\n## Dependencies\n- UTV2-FOUND-01\n\n## Owner\n- Architecture\n\n## Agent lane\n- claude`,
    projects.r2.id,
    [L.contract, L.api, L.docs, L.p1],
    2
  );

  // UTV2-CONTRACT-03
  await createIssue(
    'UTV2-CONTRACT-03: Ratify pick lifecycle contract',
    `## Problem\nThe platform needs a ratified lifecycle contract before state transitions are implemented.\n\n## Why now\nLifecycle authority must be settled before core pipeline work begins.\n\n## Source of truth or contract\n- docs/02_architecture/contracts/pick_lifecycle_contract.md\n\n## Scope in\n- Named lifecycle states\n- Transition authority per state\n- Guard expectations\n\n## Scope out\n- UI state display\n\n## Acceptance criteria\n- All lifecycle states and valid transitions are documented\n- Authority for each transition is named\n\n## Risks\n- Under-specified transitions leading to implementation guesswork\n\n## Test proof required\n- Contract review signoff\n\n## Migration impact\n- Determines which legacy lifecycle logic is reusable\n\n## Dependencies\n- UTV2-CONTRACT-02\n\n## Owner\n- Architecture\n\n## Agent lane\n- claude`,
    projects.r2.id,
    [L.contract, L.docs, L.p1],
    2
  );

  // UTV2-CONTRACT-04
  await createIssue(
    'UTV2-CONTRACT-04: Ratify distribution contract',
    `## Problem\nDistribution behavior must be formally specified before outbox and posting work begins.\n\n## Why now\nThe outbox schema design depends on the distribution contract being stable.\n\n## Source of truth or contract\n- docs/02_architecture/contracts/distribution_contract.md\n\n## Scope in\n- Posting trigger rules\n- Receipt shape\n- Retry and idempotency rules\n\n## Scope out\n- Bot implementation details\n\n## Acceptance criteria\n- Distribution contract is complete enough to drive outbox schema design\n\n## Risks\n- Missing idempotency rules cause duplicate posts\n\n## Test proof required\n- Contract review signoff\n\n## Migration impact\n- Determines which legacy Discord patterns can be reused\n\n## Dependencies\n- UTV2-CONTRACT-02\n\n## Owner\n- Architecture\n\n## Agent lane\n- claude`,
    projects.r2.id,
    [L.contract, L.discord, L.docs, L.p1],
    2
  );

  // UTV2-CONTRACT-05
  await createIssue(
    'UTV2-CONTRACT-05: Ratify settlement contract',
    `## Problem\nSettlement authority and immutability rules must be specified before grading logic is implemented.\n\n## Why now\nSettlement is the terminal event for a pick and must be correct by design.\n\n## Source of truth or contract\n- docs/02_architecture/contracts/settlement_contract.md\n\n## Scope in\n- Settlement record shape\n- Grading authority\n- Correction handling rules\n\n## Scope out\n- UI audit display\n\n## Acceptance criteria\n- Settlement contract covers record shape, authority, and correction rules\n\n## Risks\n- Ambiguous correction rules leading to data integrity problems\n\n## Test proof required\n- Contract review signoff\n\n## Migration impact\n- Determines which legacy grading logic is reusable\n\n## Dependencies\n- UTV2-CONTRACT-02\n\n## Owner\n- Architecture\n\n## Agent lane\n- claude`,
    projects.r2.id,
    [L.contract, L.settlement, L.docs, L.p1],
    2
  );

  // UTV2-CONTRACT-06
  await createIssue(
    'UTV2-CONTRACT-06: Ratify run and audit contract',
    `## Problem\nRun grouping and audit traceability rules must be formally defined before observability work begins.\n\n## Why now\nAudit integrity is a non-negotiable from the rebuild charter.\n\n## Source of truth or contract\n- docs/02_architecture/contracts/run_audit_contract.md\n\n## Scope in\n- Run grouping rules\n- Audit event shape\n- Immutability expectations\n\n## Scope out\n- UI audit viewer\n\n## Acceptance criteria\n- Run and audit contract is complete enough to drive schema and event design\n\n## Risks\n- Loose audit definitions lead to gaps in traceability\n\n## Test proof required\n- Contract review signoff\n\n## Migration impact\n- Determines what legacy run-tracking can be reused\n\n## Dependencies\n- UTV2-CONTRACT-02\n\n## Owner\n- Architecture\n\n## Agent lane\n- claude`,
    projects.r2.id,
    [L.contract, L.observability, L.docs, L.p1],
    2
  );

  // UTV2-CONTRACT-07
  await createIssue(
    'UTV2-CONTRACT-07: Ratify environment contract',
    `## Problem\nEnv var ownership and the boundary between shared defaults and local secrets must be formally documented.\n\n## Why now\nService integration work will produce secret leakage without clear env authority.\n\n## Source of truth or contract\n- docs/02_architecture/contracts/environment_contract.md\n\n## Scope in\n- Env var categories\n- Ownership per category\n- Local secret handling rules\n\n## Scope out\n- Secret manager rollout\n\n## Acceptance criteria\n- Environment contract is complete and linked from the tooling setup doc\n\n## Risks\n- Developers placing secrets in shared files\n\n## Test proof required\n- Contract review signoff\n\n## Migration impact\n- None\n\n## Dependencies\n- UTV2-FOUND-03\n\n## Owner\n- Engineering\n\n## Agent lane\n- claude`,
    projects.r2.id,
    [L.contract, L.infra, L.docs, L.p1],
    2
  );

  // UTV2-PIPE-01
  await createIssue(
    'UTV2-PIPE-01: Design canonical V2 schema',
    `## Problem\nThe rebuild needs a canonical schema that reflects the new contracts rather than the legacy drift.\n\n## Why now\nSubmission, lifecycle, distribution, and settlement all depend on canonical table design.\n\n## Source of truth or contract\n- docs/02_architecture/domain_model.md\n- docs/02_architecture/contracts/submission_contract.md\n- docs/02_architecture/contracts/pick_lifecycle_contract.md\n- docs/02_architecture/contracts/distribution_contract.md\n- docs/02_architecture/contracts/settlement_contract.md\n- docs/05_operations/supabase_setup.md\n\n## Scope in\n- Canonical table list\n- Ownership and mutation notes\n- Migration-first schema design\n\n## Scope out\n- Full migration implementation\n\n## Acceptance criteria\n- Schema proposal covers all canonical entities\n- Mutation authority is documented per table group\n\n## Risks\n- Recreating legacy ambiguity in new names\n\n## Test proof required\n- Schema review\n\n## Migration impact\n- Defines the target for future migration mapping\n\n## Dependencies\n- UTV2-CONTRACT-01\n- UTV2-CONTRACT-02\n\n## Owner\n- Data platform\n\n## Agent lane\n- codex`,
    projects.r3.id,
    [L.schema, L.data, L.api, L.p1],
    2
  );

  // UTV2-PIPE-02
  await createIssue(
    'UTV2-PIPE-02: Implement submission intake path',
    `## Problem\nThe canonical intake path for inbound submissions does not yet exist in V2.\n\n## Why now\nSubmission is the entry point — nothing downstream can be tested without it.\n\n## Source of truth or contract\n- docs/02_architecture/contracts/submission_contract.md\n- UTV2-PIPE-01 (schema)\n\n## Scope in\n- API endpoint for submission\n- Validation against submission contract\n- Event emission on success\n\n## Scope out\n- UI intake form\n\n## Acceptance criteria\n- A valid submission creates a canonical record\n- An invalid submission returns a structured error\n- Submission event is emitted\n\n## Risks\n- Validation gaps allowing malformed submissions through\n\n## Test proof required\n- Unit and integration tests\n- pnpm test passes\n\n## Migration impact\n- Replaces legacy intake path\n\n## Dependencies\n- UTV2-PIPE-01\n- UTV2-CONTRACT-01\n\n## Owner\n- Engineering\n\n## Agent lane\n- codex`,
    projects.r3.id,
    [L.api, L.build, L.p1],
    2
  );

  // UTV2-PIPE-03
  await createIssue(
    'UTV2-PIPE-03: Implement canonical pick creation path',
    `## Problem\nSubmissions must be promoted into canonical picks through an approved, auditable path.\n\n## Why now\nPick creation is the primary output of the submission pipeline.\n\n## Source of truth or contract\n- docs/02_architecture/contracts/writer_authority_contract.md\n- docs/02_architecture/contracts/pick_lifecycle_contract.md\n\n## Scope in\n- Pick creation service\n- Writer authority check\n- Initial lifecycle state assignment\n\n## Scope out\n- Full lifecycle transition engine\n\n## Acceptance criteria\n- A valid submission becomes a canonical pick\n- Pick is created with the correct initial state\n- Writer authority is enforced\n\n## Risks\n- Bypassing writer authority check in edge cases\n\n## Test proof required\n- Unit and integration tests\n\n## Migration impact\n- Replaces legacy pick creation\n\n## Dependencies\n- UTV2-PIPE-02\n- UTV2-CONTRACT-02\n\n## Owner\n- Engineering\n\n## Agent lane\n- codex`,
    projects.r3.id,
    [L.api, L.build, L.p1],
    2
  );

  // UTV2-PIPE-04
  await createIssue(
    'UTV2-PIPE-04: Implement lifecycle transition skeleton',
    `## Problem\nLifecycle transitions need a guarded implementation before settlement and distribution work begins.\n\n## Why now\nDownstream services depend on lifecycle state being authoritative.\n\n## Source of truth or contract\n- docs/02_architecture/contracts/pick_lifecycle_contract.md\n\n## Scope in\n- Transition function skeleton\n- Guard checks per transition\n- Audit event emission\n\n## Scope out\n- UI lifecycle controls\n\n## Acceptance criteria\n- All defined transitions are implemented\n- Invalid transitions are rejected\n- Audit events are emitted on transition\n\n## Risks\n- Missing guard allowing illegal state transitions\n\n## Test proof required\n- Unit tests per transition\n\n## Migration impact\n- Replaces legacy lifecycle logic\n\n## Dependencies\n- UTV2-PIPE-03\n- UTV2-CONTRACT-03\n\n## Owner\n- Engineering\n\n## Agent lane\n- codex`,
    projects.r3.id,
    [L.api, L.build, L.p1],
    2
  );

  // UTV2-DIST-01
  await createIssue(
    'UTV2-DIST-01: Design distribution outbox schema and event contract',
    `## Problem\nDistribution needs a durable outbox and receipt model instead of direct side-effect coupling.\n\n## Why now\nPosting and receipt capture must be reliable before Discord flow implementation begins.\n\n## Source of truth or contract\n- docs/02_architecture/contracts/distribution_contract.md\n- docs/02_architecture/domain_model.md\n\n## Scope in\n- Outbox shape\n- Receipt shape\n- Retry and idempotency expectations\n\n## Scope out\n- Full bot implementation\n\n## Acceptance criteria\n- Distribution design is concrete enough to support worker implementation\n\n## Risks\n- Missing receipt fields may weaken auditability\n\n## Test proof required\n- Design review signoff\n\n## Migration impact\n- Determines what legacy Discord patterns can be salvaged\n\n## Dependencies\n- UTV2-PIPE-01\n\n## Owner\n- Engineering\n\n## Agent lane\n- codex`,
    projects.r4.id,
    [L.discord, L.schema, L.contract, L.p1],
    2
  );

  // UTV2-DIST-02
  await createIssue(
    'UTV2-DIST-02: Implement Discord posting worker path',
    `## Problem\nThe outbox needs a worker that reliably posts to Discord and captures receipts.\n\n## Why now\nPosting is the primary distribution channel and must be reliable from day one.\n\n## Source of truth or contract\n- docs/02_architecture/contracts/distribution_contract.md\n- UTV2-DIST-01 (outbox schema)\n\n## Scope in\n- Worker that reads outbox\n- Discord post execution\n- Receipt write on success\n\n## Scope out\n- Subscriber management\n\n## Acceptance criteria\n- Worker posts canonical picks to Discord\n- Receipt is written on successful post\n- Failed posts remain in outbox for retry\n\n## Risks\n- Rate limiting from Discord API\n\n## Test proof required\n- Integration test with Discord webhook\n\n## Migration impact\n- Replaces legacy Discord posting logic\n\n## Dependencies\n- UTV2-DIST-01\n\n## Owner\n- Engineering\n\n## Agent lane\n- codex`,
    projects.r4.id,
    [L.discord, L.worker, L.build, L.p1],
    2
  );

  // UTV2-DIST-03
  await createIssue(
    'UTV2-DIST-03: Implement receipt capture and retry handling',
    `## Problem\nFailed posts need a durable retry mechanism and all posts need auditable receipts.\n\n## Why now\nWithout retry handling, transient Discord failures cause silent data loss.\n\n## Source of truth or contract\n- docs/02_architecture/contracts/distribution_contract.md\n\n## Scope in\n- Receipt capture on post success\n- Retry queue for failed posts\n- Idempotency guard\n\n## Scope out\n- Manual retry UI\n\n## Acceptance criteria\n- Receipts are written for all successful posts\n- Failed posts are retried with backoff\n- Duplicate posts are prevented by idempotency check\n\n## Risks\n- Duplicate posts on retry without idempotency\n\n## Test proof required\n- Retry scenario test\n\n## Migration impact\n- None direct — new capability\n\n## Dependencies\n- UTV2-DIST-02\n\n## Owner\n- Engineering\n\n## Agent lane\n- codex`,
    projects.r4.id,
    [L.discord, L.worker, L.build, L.p2],
    3
  );

  // UTV2-SET-01
  await createIssue(
    'UTV2-SET-01: Design settlement record model',
    `## Problem\nSettlement records need a canonical, immutable shape before grading logic is implemented.\n\n## Why now\nGrading depends on the settlement record model being stable.\n\n## Source of truth or contract\n- docs/02_architecture/contracts/settlement_contract.md\n\n## Scope in\n- Settlement record shape\n- Immutability rules\n- Correction record shape\n\n## Scope out\n- UI settlement display\n\n## Acceptance criteria\n- Settlement record model is documented and matches the contract\n- Correction record shape is defined\n\n## Risks\n- Mutable settlement records undermining audit integrity\n\n## Test proof required\n- Schema review\n\n## Migration impact\n- Defines target for legacy settlement mapping\n\n## Dependencies\n- UTV2-CONTRACT-05\n- UTV2-PIPE-01\n\n## Owner\n- Data platform\n\n## Agent lane\n- codex`,
    projects.r5.id,
    [L.settlement, L.schema, L.p1],
    2
  );

  // UTV2-SET-02
  await createIssue(
    'UTV2-SET-02: Implement grading and correction path',
    `## Problem\nPicks need to be graded against outcomes and corrections handled without mutating immutable records.\n\n## Why now\nSettlement is the terminal event for a pick's lifecycle.\n\n## Source of truth or contract\n- docs/02_architecture/contracts/settlement_contract.md\n- UTV2-SET-01\n\n## Scope in\n- Grading service\n- Settlement record creation\n- Correction record creation\n\n## Scope out\n- Manual override UI\n\n## Acceptance criteria\n- Picks are graded and produce settlement records\n- Corrections create new records without mutating originals\n- Settlement events are emitted\n\n## Risks\n- Ambiguous outcome data leading to incorrect grades\n\n## Test proof required\n- Unit tests for grading logic\n- Correction scenario test\n\n## Migration impact\n- Replaces legacy grading logic\n\n## Dependencies\n- UTV2-SET-01\n- UTV2-PIPE-04\n\n## Owner\n- Engineering\n\n## Agent lane\n- codex`,
    projects.r5.id,
    [L.settlement, L.build, L.p1],
    2
  );

  // UTV2-OPS-01
  await createIssue(
    'UTV2-OPS-01: Define operator read model',
    `## Problem\nOperators need a structured read model before health and visibility tooling can be built.\n\n## Why now\nOperator control tooling depends on a defined read model to avoid direct DB queries.\n\n## Source of truth or contract\n- docs/02_architecture/contracts/writer_authority_contract.md\n- docs/02_architecture/domain_model.md\n\n## Scope in\n- Read model entity list\n- Staleness and refresh rules\n- Authority boundaries for read vs write\n\n## Scope out\n- UI implementation\n\n## Acceptance criteria\n- Operator read model is documented\n- Authority boundaries are explicit\n\n## Risks\n- Read model drift from canonical tables\n\n## Test proof required\n- Design review\n\n## Migration impact\n- None direct\n\n## Dependencies\n- UTV2-CONTRACT-02\n- UTV2-PIPE-01\n\n## Owner\n- Engineering\n\n## Agent lane\n- claude`,
    projects.r6.id,
    [L['operator-web'], L.docs, L.p2],
    3
  );

  // UTV2-OPS-02
  await createIssue(
    'UTV2-OPS-02: Implement service health and run visibility',
    `## Problem\nOperators have no visibility into service health or run state without an implemented read model view.\n\n## Why now\nOperator visibility is required before cutover can be considered safe.\n\n## Source of truth or contract\n- UTV2-OPS-01\n- docs/05_operations/risk_register.md\n\n## Scope in\n- Health endpoint per service\n- Run state query\n- Operator-facing read surface\n\n## Scope out\n- Full alerting pipeline\n\n## Acceptance criteria\n- Operators can query current run state\n- Service health is visible without direct DB access\n\n## Risks\n- Stale read model producing misleading health state\n\n## Test proof required\n- Manual operator walkthrough\n\n## Migration impact\n- None direct\n\n## Dependencies\n- UTV2-OPS-01\n- UTV2-PIPE-04\n\n## Owner\n- Engineering\n\n## Agent lane\n- codex`,
    projects.r6.id,
    [L['operator-web'], L.observability, L.build, L.p2],
    3
  );

  // UTV2-MIG-01
  await createIssue(
    'UTV2-MIG-01: Create migration ledger from legacy repo',
    `## Problem\nThe rebuild needs a clear map of what is reusable, rewrite-only, or delete-on-arrival from the legacy repo.\n\n## Why now\nWithout a ledger, legacy code will leak into the rebuild opportunistically.\n\n## Source of truth or contract\n- docs/05_operations/migration_cutover_plan.md\n- docs/01_principles/rebuild_charter.md\n\n## Scope in\n- Legacy path inventory\n- Keep, rewrite, delete decisions\n- Rationale per item\n\n## Scope out\n- Porting implementation\n\n## Acceptance criteria\n- Ledger exists and covers critical legacy surfaces\n\n## Risks\n- Missing legacy hotspots may distort future estimates\n\n## Test proof required\n- Ledger review\n\n## Migration impact\n- Establishes the migration work queue\n\n## Dependencies\n- UTV2-FOUND-01\n- UTV2-CONTRACT-02\n\n## Owner\n- Engineering\n\n## Agent lane\n- codex`,
    projects.r7.id,
    [L.migration, L.docs, L.investigation, L.p1],
    2
  );

  // UTV2-MIG-02
  await createIssue(
    'UTV2-MIG-02: Identify reusable lifecycle logic',
    `## Problem\nSome legacy lifecycle logic may be portable to V2 without a full rewrite.\n\n## Why now\nIdentifying reusable logic early reduces implementation risk in the core pipeline.\n\n## Source of truth or contract\n- UTV2-MIG-01\n- docs/02_architecture/contracts/pick_lifecycle_contract.md\n\n## Scope in\n- Lifecycle logic inventory from legacy\n- Compatibility assessment against V2 contract\n- Recommendation per component\n\n## Scope out\n- Porting implementation\n\n## Acceptance criteria\n- Each legacy lifecycle component has a reuse/rewrite/delete decision\n\n## Risks\n- Porting logic that carries legacy assumptions\n\n## Test proof required\n- Ledger review\n\n## Migration impact\n- Informs UTV2-PIPE-04 implementation\n\n## Dependencies\n- UTV2-MIG-01\n- UTV2-CONTRACT-03\n\n## Owner\n- Engineering\n\n## Agent lane\n- codex`,
    projects.r7.id,
    [L.migration, L.investigation, L.p2],
    3
  );

  // UTV2-MIG-03
  await createIssue(
    'UTV2-MIG-03: Stage shadow validation plan',
    `## Problem\nCutover safety requires a shadow validation plan before live traffic is migrated.\n\n## Why now\nShadow validation must be designed before implementation is complete.\n\n## Source of truth or contract\n- docs/05_operations/migration_cutover_plan.md\n\n## Scope in\n- Shadow run design\n- Parity check criteria\n- Validation sign-off process\n\n## Scope out\n- Live shadow run execution\n\n## Acceptance criteria\n- Shadow validation plan exists with acceptance criteria\n\n## Risks\n- Parity gaps not caught before cutover\n\n## Test proof required\n- Plan review signoff\n\n## Migration impact\n- Gates the cutover readiness milestone\n\n## Dependencies\n- UTV2-MIG-01\n\n## Owner\n- Engineering\n\n## Agent lane\n- claude`,
    projects.r7.id,
    [L.migration, L.docs, L.p2],
    3
  );

  // UTV2-HARD-01
  await createIssue(
    'UTV2-HARD-01: Define incident and rollback plan',
    `## Problem\nThe rebuild needs a documented response and rollback posture before cutover readiness work is considered complete.\n\n## Why now\nProduction hardening should not be deferred until the final week of migration.\n\n## Source of truth or contract\n- docs/05_operations/migration_cutover_plan.md\n- docs/05_operations/risk_register.md\n\n## Scope in\n- Incident ownership\n- Rollback expectations\n- Minimum signals required for safe cutover\n\n## Scope out\n- Full on-call tooling rollout\n\n## Acceptance criteria\n- Incident and rollback plan exists with named responsibilities\n\n## Risks\n- Hardening may become performative if not tied to real signals\n\n## Test proof required\n- Operations review signoff\n\n## Migration impact\n- Reduces cutover risk for the migration program\n\n## Dependencies\n- UTV2-MIG-01\n\n## Owner\n- Operations\n\n## Agent lane\n- claude-os`,
    projects.r8.id,
    [L.security, L.observability, L.docs, L['cutover-risk'], L.p2],
    3
  );

  // UTV2-HARD-02
  await createIssue(
    'UTV2-HARD-02: Add hardening backlog for cutover-risk items',
    `## Problem\nThe risk register contains items that need a tracked backlog before cutover.\n\n## Why now\nUntracked risks will be discovered during cutover instead of before it.\n\n## Source of truth or contract\n- docs/05_operations/risk_register.md\n\n## Scope in\n- Risk register review\n- Backlog issue creation per cutover-risk item\n- Prioritisation\n\n## Scope out\n- Full mitigation implementation\n\n## Acceptance criteria\n- All cutover-risk items from the register have a tracked issue\n\n## Risks\n- Risk register may be incomplete\n\n## Test proof required\n- Backlog review signoff\n\n## Migration impact\n- Directly feeds cutover readiness\n\n## Dependencies\n- UTV2-HARD-01\n\n## Owner\n- Operations\n\n## Agent lane\n- claude-os`,
    projects.r8.id,
    [L.security, L['cutover-risk'], L.docs, L.p2],
    3
  );

  console.log('\n=== Build complete ===');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
