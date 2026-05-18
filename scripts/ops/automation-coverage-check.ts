import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type Severity = 'fail' | 'warn';
type Category = 'implementation-gap' | 'current-authority-contradiction';

export interface ToolSurface {
  name: string;
  kind: string;
  category: string;
  automation?: string;
  target_issue?: string;
  owner?: string;
  trigger?: string;
  artifact?: string;
  required_check_status?: string;
  manual_allowance?: string;
  equivalent_gate?: string;
}

export interface AutomationRegistry {
  schema_version: number;
  reference_root?: string;
  tool_surfaces: ToolSurface[];
}

export interface AutomationFinding {
  severity: Severity;
  category: Category;
  code: string;
  surface: string;
  detail: string;
}

export interface AutomationCoverageEntry {
  surface: string;
  kind: string;
  category: string;
  owner: string | null;
  trigger: string | null;
  automation: string | null;
  required_check_status: string | null;
  artifact: string | null;
  target_issue: string | null;
  source_path: string | null;
  source_exists: boolean;
  automation_exists: boolean | null;
}

export interface AutomationCoverageReport {
  verdict: 'PASS' | 'FAIL';
  checked_at: string;
  registry_path: string;
  inventory: {
    prompt_agents: number;
    codex_skills: number;
    ops_scripts: number;
    github_workflows: number;
    classified_surfaces: number;
  };
  summary: {
    fail: number;
    warn: number;
  };
  coverage: AutomationCoverageEntry[];
  findings: AutomationFinding[];
}

const DEFAULT_REGISTRY = 'docs/05_operations/system-alignment-registry.json';
const ISSUE_PATTERN = /^UTV2-\d+$/;
const PROMPT_GATE_CLAIM_PATTERN = /\b(before .*merge gate|before .*t1-approved|required gate|blocks merge|prevents merge|do not merge|do not apply .*t1-approved|orchestrator may .*merge|may apply .*t1-approved)\b/i;
const ALLOWED_MANUAL_ALLOWANCES = new Set([
  'diagnostic',
  'one-shot migration aid',
  'transitional wiring gap',
  'archive/delete candidate',
]);

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function resolveFromRoot(filePath: string, root = process.cwd()): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
}

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function listFiles(root: string, predicate: (filePath: string) => boolean): string[] {
  if (!existsSync(root)) return [];
  const results: string[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of readdirSync(current)) {
      const fullPath = path.join(current, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (predicate(fullPath)) results.push(fullPath);
    }
  }

  return results.sort();
}

function inferSourcePath(surface: ToolSurface): string | null {
  if (surface.name.startsWith('scripts/')) return surface.name;
  if (surface.name === '.agents/skills/**') return '.agents/skills';
  if (surface.name.startsWith('.agents/skills/')) return surface.name;
  if (surface.name.startsWith('apps/')) return surface.name;
  if (surface.name.startsWith('.github/workflows/')) return surface.name;
  if (surface.kind === 'prompt-agent') return `.claude/agents/${surface.name}.md`;
  return null;
}

function isRecurringManual(surface: ToolSurface): boolean {
  const category = normalize(surface.category);
  return category === 'manual-tool' || category === 'manual-transitional';
}

function hasAllowedManualDisposition(surface: ToolSurface): boolean {
  const category = normalize(surface.category);
  const allowance = normalize(surface.manual_allowance);

  if (category === 'manual-diagnostic' || category === 'one-shot-migration-aid' || category === 'archive-delete-candidate') {
    return true;
  }
  if (category === 'manual-transitional') {
    return ISSUE_PATTERN.test(surface.target_issue ?? '');
  }
  if (category === 'manual-tool') {
    return ALLOWED_MANUAL_ALLOWANCES.has(allowance) && (allowance !== 'transitional wiring gap' || ISSUE_PATTERN.test(surface.target_issue ?? ''));
  }
  return false;
}

function buildCoverageEntry(surface: ToolSurface, root: string): AutomationCoverageEntry {
  const sourcePath = inferSourcePath(surface);
  const automationPath = surface.automation ?? surface.equivalent_gate ?? null;

  return {
    surface: surface.name,
    kind: surface.kind,
    category: surface.category,
    owner: surface.owner ?? null,
    trigger: surface.trigger ?? null,
    automation: automationPath,
    required_check_status: surface.required_check_status ?? null,
    artifact: surface.artifact ?? null,
    target_issue: surface.target_issue ?? null,
    source_path: sourcePath,
    source_exists: sourcePath ? existsSync(resolveFromRoot(sourcePath, root)) : false,
    automation_exists: automationPath ? existsSync(resolveFromRoot(automationPath, root)) : null,
  };
}

export function buildAutomationCoverageReport(registryPath = DEFAULT_REGISTRY): AutomationCoverageReport {
  const registry = readJson<AutomationRegistry>(registryPath);
  const root = registry.reference_root ?? process.cwd();
  const findings: AutomationFinding[] = [];
  const coverage = registry.tool_surfaces.map(surface => buildCoverageEntry(surface, root));

  const promptAgents = listFiles(resolveFromRoot('.claude/agents', root), file => file.endsWith('.md'));
  const skills = listFiles(resolveFromRoot('.agents/skills', root), file => path.basename(file) === 'SKILL.md');
  const opsScripts = listFiles(resolveFromRoot('scripts/ops', root), file => file.endsWith('.ts') || file.endsWith('.mjs') || file.endsWith('.js') || file.endsWith('.sh'));
  const workflows = listFiles(resolveFromRoot('.github/workflows', root), file => file.endsWith('.yml') || file.endsWith('.yaml'));

  const classifiedPromptAgents = new Set(
    registry.tool_surfaces
      .filter(surface => surface.kind === 'prompt-agent')
      .map(surface => path.basename(inferSourcePath(surface) ?? '')),
  );

  for (const promptAgent of promptAgents) {
    const basename = path.basename(promptAgent);
    if (!classifiedPromptAgents.has(basename)) {
      findings.push({
        severity: 'fail',
        category: 'implementation-gap',
        code: 'AUTO_PROMPT_AGENT_UNCLASSIFIED',
        surface: promptAgent,
        detail: 'prompt agent exists but is not classified in tool_surfaces',
      });
    }
  }

  for (const surface of registry.tool_surfaces) {
    const entry = coverage.find(item => item.surface === surface.name);
    const category = normalize(surface.category);

    if (entry && !entry.source_exists) {
      findings.push({
        severity: 'fail',
        category: 'implementation-gap',
        code: 'AUTO_SURFACE_SOURCE_MISSING',
        surface: surface.name,
        detail: `classified surface source does not exist: ${entry.source_path ?? 'unknown'}`,
      });
    }

    if ((surface.automation || surface.equivalent_gate) && entry?.automation_exists === false) {
      findings.push({
        severity: 'fail',
        category: 'implementation-gap',
        code: 'AUTO_AUTOMATION_MISSING',
        surface: surface.name,
        detail: `classified automation path does not exist: ${surface.automation ?? surface.equivalent_gate}`,
      });
    }

    if (isRecurringManual(surface) && !hasAllowedManualDisposition(surface)) {
      findings.push({
        severity: 'fail',
        category: 'implementation-gap',
        code: 'AUTO_MANUAL_RECURRING_UNJUSTIFIED',
        surface: surface.name,
        detail: 'recurring manual-purpose surface must be diagnostic, one-shot, transitional with target issue, or archive/delete candidate',
      });
    }

    if ((category.includes('required-gate') || category === 'scheduled-monitor') && !surface.trigger) {
      findings.push({
        severity: 'fail',
        category: 'implementation-gap',
        code: 'AUTO_TRIGGER_MISSING',
        surface: surface.name,
        detail: 'automated or scheduled surface must declare trigger',
      });
    }

    if (category.includes('required-gate') && !surface.required_check_status) {
      findings.push({
        severity: 'fail',
        category: 'implementation-gap',
        code: 'AUTO_REQUIRED_CHECK_STATUS_MISSING',
        surface: surface.name,
        detail: 'required-gate surface must declare required_check_status',
      });
    }

    if (surface.kind === 'prompt-agent') {
      const sourcePath = inferSourcePath(surface);
      if (!sourcePath || !existsSync(resolveFromRoot(sourcePath, root))) continue;
      const content = readFileSync(resolveFromRoot(sourcePath, root), 'utf8');
      const hasGateClaim = PROMPT_GATE_CLAIM_PATTERN.test(content);
      const hasEquivalentBlockingAutomation = Boolean(surface.equivalent_gate || surface.automation);

      if (hasGateClaim && !hasEquivalentBlockingAutomation) {
        findings.push({
          severity: 'fail',
          category: 'current-authority-contradiction',
          code: 'AUTO_PROMPT_AGENT_BLOCKING_WITHOUT_GATE',
          surface: surface.name,
          detail: 'prompt agent text describes merge/label blocking authority but no equivalent blocking automation is classified',
        });
      }
    }
  }

  const fail = findings.filter(finding => finding.severity === 'fail').length;
  const warn = findings.filter(finding => finding.severity === 'warn').length;

  return {
    verdict: fail === 0 ? 'PASS' : 'FAIL',
    checked_at: new Date().toISOString(),
    registry_path: registryPath,
    inventory: {
      prompt_agents: promptAgents.length,
      codex_skills: skills.length,
      ops_scripts: opsScripts.length,
      github_workflows: workflows.length,
      classified_surfaces: registry.tool_surfaces.length,
    },
    summary: { fail, warn },
    coverage,
    findings,
  };
}

function parseArgs(argv: string[]): { registryPath: string; json: boolean; output: string | null } {
  let registryPath = DEFAULT_REGISTRY;
  let json = false;
  let output: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--registry') {
      registryPath = argv[index + 1] ?? registryPath;
      index += 1;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--output') {
      output = argv[index + 1] ?? null;
      index += 1;
    }
  }

  return { registryPath, json, output };
}

function printText(report: AutomationCoverageReport): void {
  console.log(
    `[automation-coverage] verdict=${report.verdict} fail=${report.summary.fail} warn=${report.summary.warn} ` +
      `classified=${report.inventory.classified_surfaces}`,
  );
  for (const finding of report.findings) {
    console.log(`[${finding.severity.toUpperCase()}] ${finding.code} ${finding.surface} - ${finding.detail}`);
  }
}

const invokedPath = process.argv[1] ?? '';
if (invokedPath.endsWith('automation-coverage-check.ts') || invokedPath.endsWith('automation-coverage-check.js')) {
  const args = parseArgs(process.argv.slice(2));
  const report = buildAutomationCoverageReport(args.registryPath);

  if (args.output) {
    mkdirSync(path.dirname(args.output), { recursive: true });
    writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printText(report);
  }

  if (report.verdict !== 'PASS') {
    process.exit(1);
  }
}
