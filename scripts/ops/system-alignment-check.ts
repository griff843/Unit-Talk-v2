import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export type AlignmentSeverity = 'fail' | 'warn';
export type AlignmentCategory =
  | 'current-authority-contradiction'
  | 'historical-archive-noise'
  | 'implementation-gap';

export interface DeprecatedControlPlaneRule {
  path: string;
  allowed_terms: string[];
  forbidden_patterns: string[];
}

export interface ToolSurface {
  name: string;
  kind: string;
  category: string;
  automation?: string;
  target_issue?: string;
}

export interface AlignmentRegistry {
  schema_version: number;
  reference_root?: string;
  active_authority_files: string[];
  historical_files: string[];
  deprecated_live_control_planes: DeprecatedControlPlaneRule[];
  tool_surfaces: ToolSurface[];
}

export interface AlignmentFinding {
  severity: AlignmentSeverity;
  category: AlignmentCategory;
  code: string;
  file: string;
  line?: number;
  detail: string;
}

export interface AlignmentReport {
  verdict: 'PASS' | 'FAIL';
  checked_at: string;
  registry_path: string;
  summary: {
    fail: number;
    warn: number;
    current_authority_contradictions: number;
    historical_archive_noise: number;
    implementation_gaps: number;
  };
  findings: AlignmentFinding[];
}

const DEFAULT_REGISTRY = 'docs/05_operations/system-alignment-registry.json';
const PATH_PATTERN = /`(docs\/[^`*]+\.(?:md|json|yml|yaml))`/g;
const GATE_CLAIM_PATTERN = /\b(prompt agent|\.claude\/agents|agent)\b.*\b(blocking|required gate|blocks merge|prevents merge)\b/i;
const ISSUE_PATTERN = /^UTV2-\d+$/;
const CONTROL_PLANE_ROOTS = [
  'AGENTS.md',
  'CLAUDE.md',
  '.agents',
  '.claude',
  '.github',
  'docs',
  'scripts',
  'package.json',
];
const CONTROL_PLANE_EXCLUDED_PARTS = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  'docs/archive',
  '.claude/worktrees',
]);
const STALE_CONTROL_PLANE_PATTERNS: Array<{ code: string; pattern: RegExp; detail: string }> = [
  {
    code: 'ALIGN_STALE_LANES_JSON_REFERENCE',
    pattern: /\.claude\/lanes\.json/,
    detail: 'active control-plane file references removed .claude/lanes.json authority',
  },
  {
    code: 'ALIGN_STALE_LANE_START_COMMAND',
    pattern: /ops:lane:start/,
    detail: 'active control-plane file references stale colon-style ops:lane:start command',
  },
  {
    code: 'ALIGN_STALE_LANE_CLOSE_COMMAND',
    pattern: /ops:lane:close/,
    detail: 'active control-plane file references stale colon-style ops:lane:close command',
  },
  {
    code: 'ALIGN_STALE_CONCURRENCY_LIMIT',
    pattern: /Claude Code\s*\|\s*1 active lane|Codex CLI\s*\|\s*2 active lane|Default:\s*max 2 active Codex|third Codex slot/i,
    detail: 'active control-plane file references pre-6-lane concurrency limits',
  },
];
const REQUIRED_CONCURRENCY_CONSUMERS = [
  'scripts/ops/lane-start.ts',
  'scripts/ops/execution-state.ts',
  'scripts/ops/merge-risk.ts',
  'scripts/ops/lane-maximizer.ts',
  'scripts/ops/merge-mutex.ts',
];

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function normalizeCategory(category: string): string {
  return category.toLowerCase().trim();
}

function lineAllowsDeprecatedClaim(line: string, allowedTerms: string[]): boolean {
  const lower = line.toLowerCase();
  return allowedTerms.some(term => lower.includes(term.toLowerCase()));
}

function patternMatches(line: string, pattern: string): boolean {
  return new RegExp(pattern, 'i').test(line);
}

function resolveFromRoot(filePath: string, root = process.cwd()): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
}

function shouldSkipControlPlanePath(relativePath: string): boolean {
  if (relativePath.endsWith('.test.ts')) return true;
  if (relativePath === 'scripts/ops/system-alignment-check.ts') return true;
  for (const excluded of CONTROL_PLANE_EXCLUDED_PARTS) {
    if (relativePath === excluded || relativePath.startsWith(`${excluded}/`)) return true;
  }
  return false;
}

function walkFiles(root: string, relativePath: string): string[] {
  if (shouldSkipControlPlanePath(relativePath)) return [];
  const absolutePath = resolveFromRoot(relativePath, root);
  if (!existsSync(absolutePath)) return [];
  const stat = statSync(absolutePath);
  if (stat.isFile()) return [relativePath];
  if (!stat.isDirectory()) return [];
  return readdirSync(absolutePath)
    .flatMap((entry) => walkFiles(root, path.posix.join(relativePath, entry)));
}

export function checkRegistryShape(registry: AlignmentRegistry, registryPath: string): AlignmentFinding[] {
  const findings: AlignmentFinding[] = [];
  const referenceRoot = registry.reference_root ?? process.cwd();

  if (registry.schema_version !== 1) {
    findings.push({
      severity: 'fail',
      category: 'current-authority-contradiction',
      code: 'ALIGN_SCHEMA_VERSION',
      file: registryPath,
      detail: 'system alignment registry must have schema_version 1',
    });
  }

  for (const file of registry.active_authority_files) {
    const resolvedFile = resolveFromRoot(file, referenceRoot);
    if (!existsSync(resolvedFile)) {
      findings.push({
        severity: 'fail',
        category: 'current-authority-contradiction',
        code: 'ALIGN_ACTIVE_FILE_MISSING',
        file,
        detail: 'active authority file listed in registry does not exist',
      });
    }
  }

  for (const surface of registry.tool_surfaces) {
    const category = normalizeCategory(surface.category);
    const isManualRecurring = category === 'manual-tool' || category === 'manual-transitional';
    const isAllowedManual = category === 'manual-diagnostic' || category === 'one-shot-migration-aid';
    const isRetirement = category === 'archive-delete-candidate';

    if (isManualRecurring && !ISSUE_PATTERN.test(surface.target_issue ?? '')) {
      findings.push({
        severity: 'fail',
        category: 'implementation-gap',
        code: 'ALIGN_MANUAL_RECURRING_UNTRACKED',
        file: registryPath,
        detail: `${surface.name} is recurring manual tooling without a valid target_issue`,
      });
    }

    if (category.includes('required-gate') && !surface.automation) {
      findings.push({
        severity: 'fail',
        category: 'implementation-gap',
        code: 'ALIGN_GATE_WITHOUT_AUTOMATION',
        file: registryPath,
        detail: `${surface.name} is classified as a gate but has no automation path`,
      });
    }

    if (isRetirement && !ISSUE_PATTERN.test(surface.target_issue ?? '')) {
      findings.push({
        severity: 'fail',
        category: 'implementation-gap',
        code: 'ALIGN_RETIREMENT_UNTRACKED',
        file: registryPath,
        detail: `${surface.name} is an archive/delete candidate without a valid target_issue`,
      });
    }

    if (!isManualRecurring && !isAllowedManual && !isRetirement && category !== 'scheduled-monitor' && !category.includes('required-gate')) {
      findings.push({
        severity: 'warn',
        category: 'implementation-gap',
        code: 'ALIGN_UNKNOWN_TOOL_CATEGORY',
        file: registryPath,
        detail: `${surface.name} uses unknown category "${surface.category}"`,
      });
    }
  }

  return findings;
}

export function checkDeprecatedControlPlaneClaims(registry: AlignmentRegistry): AlignmentFinding[] {
  const findings: AlignmentFinding[] = [];
  const referenceRoot = registry.reference_root ?? process.cwd();

  for (const file of registry.active_authority_files) {
    const resolvedFile = resolveFromRoot(file, referenceRoot);
    if (!existsSync(resolvedFile)) continue;
    const lines = readFileSync(resolvedFile, 'utf8').split(/\r?\n/);

    for (const rule of registry.deprecated_live_control_planes) {
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (!line.includes(path.basename(rule.path)) && !line.includes(rule.path)) continue;
        if (lineAllowsDeprecatedClaim(line, rule.allowed_terms)) continue;

        const matched = rule.forbidden_patterns.some(pattern => patternMatches(line, pattern));
        if (!matched) continue;

        findings.push({
          severity: 'fail',
          category: 'current-authority-contradiction',
          code: 'ALIGN_DEPRECATED_CONTROL_PLANE_CLAIM',
          file,
          line: index + 1,
          detail: `${rule.path} is deprecated/historical but this line describes it as live authority: ${line.trim()}`,
        });
      }
    }
  }

  return findings;
}

export function checkMissingReferences(registry: AlignmentRegistry): AlignmentFinding[] {
  const findings: AlignmentFinding[] = [];
  const referenceRoot = registry.reference_root ?? process.cwd();

  for (const file of registry.active_authority_files) {
    const resolvedFile = resolveFromRoot(file, referenceRoot);
    if (!existsSync(resolvedFile)) continue;
    const lines = readFileSync(resolvedFile, 'utf8').split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const match of line.matchAll(PATH_PATTERN)) {
        const referenced = match[1];
        if (existsSync(resolveFromRoot(referenced, referenceRoot))) continue;

        findings.push({
          severity: 'fail',
          category: 'current-authority-contradiction',
          code: 'ALIGN_REFERENCE_MISSING',
          file,
          line: index + 1,
          detail: `active authority doc references missing path: ${referenced}`,
        });
      }
    }
  }

  return findings;
}

export function checkPromptAgentGateClaims(registry: AlignmentRegistry): AlignmentFinding[] {
  const findings: AlignmentFinding[] = [];
  const referenceRoot = registry.reference_root ?? process.cwd();

  for (const file of registry.active_authority_files) {
    const resolvedFile = resolveFromRoot(file, referenceRoot);
    if (!existsSync(resolvedFile)) continue;
    const lines = readFileSync(resolvedFile, 'utf8').split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!GATE_CLAIM_PATTERN.test(line)) continue;
      if (/not|unless|do not|cannot/i.test(line)) continue;

      findings.push({
        severity: 'fail',
        category: 'current-authority-contradiction',
        code: 'ALIGN_PROMPT_AGENT_GATE_CLAIM',
        file,
        line: index + 1,
        detail: `prompt agent described as blocking without automation qualification: ${line.trim()}`,
      });
    }
  }

  return findings;
}

export function checkActiveControlPlaneStaleReferences(root = process.cwd()): AlignmentFinding[] {
  const findings: AlignmentFinding[] = [];
  const files = CONTROL_PLANE_ROOTS.flatMap((entry) => walkFiles(root, entry));

  for (const file of files) {
    const absolutePath = resolveFromRoot(file, root);
    const lines = readFileSync(absolutePath, 'utf8').split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const rule of STALE_CONTROL_PLANE_PATTERNS) {
        if (!rule.pattern.test(line)) continue;
        findings.push({
          severity: 'fail',
          category: 'current-authority-contradiction',
          code: rule.code,
          file,
          line: index + 1,
          detail: `${rule.detail}: ${line.trim()}`,
        });
      }
    }
  }

  return findings;
}

export function checkConcurrencyConfigConsumers(root = process.cwd()): AlignmentFinding[] {
  const findings: AlignmentFinding[] = [];
  for (const file of REQUIRED_CONCURRENCY_CONSUMERS) {
    const absolutePath = resolveFromRoot(file, root);
    if (!existsSync(absolutePath)) {
      findings.push({
        severity: 'fail',
        category: 'implementation-gap',
        code: 'ALIGN_CONCURRENCY_CONSUMER_MISSING',
        file,
        detail: 'required concurrency config consumer file is missing',
      });
      continue;
    }
    const source = readFileSync(absolutePath, 'utf8');
    if (!source.includes("from './concurrency-config.js'") || !source.includes('loadConcurrencyConfig')) {
      findings.push({
        severity: 'fail',
        category: 'implementation-gap',
        code: 'ALIGN_CONCURRENCY_CONFIG_NOT_USED',
        file,
        detail: 'required consumer must import and call loadConcurrencyConfig from ./concurrency-config.js',
      });
    }
  }
  return findings;
}

export function buildAlignmentReport(registryPath = DEFAULT_REGISTRY): AlignmentReport {
  const registry = readJson<AlignmentRegistry>(registryPath);
  const referenceRoot = registry.reference_root ?? process.cwd();
  const findings = [
    ...checkRegistryShape(registry, registryPath),
    ...checkDeprecatedControlPlaneClaims(registry),
    ...checkMissingReferences(registry),
    ...checkPromptAgentGateClaims(registry),
    ...checkActiveControlPlaneStaleReferences(referenceRoot),
    ...checkConcurrencyConfigConsumers(referenceRoot),
  ];

  const fail = findings.filter(finding => finding.severity === 'fail').length;
  const warn = findings.filter(finding => finding.severity === 'warn').length;

  return {
    verdict: fail === 0 ? 'PASS' : 'FAIL',
    checked_at: new Date().toISOString(),
    registry_path: registryPath,
    summary: {
      fail,
      warn,
      current_authority_contradictions: findings.filter(finding => finding.category === 'current-authority-contradiction').length,
      historical_archive_noise: findings.filter(finding => finding.category === 'historical-archive-noise').length,
      implementation_gaps: findings.filter(finding => finding.category === 'implementation-gap').length,
    },
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

function printText(report: AlignmentReport): void {
  console.log(`[system-alignment] verdict=${report.verdict} fail=${report.summary.fail} warn=${report.summary.warn}`);
  for (const finding of report.findings) {
    const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
    console.log(`[${finding.severity.toUpperCase()}] ${finding.code} ${location} — ${finding.detail}`);
  }
}

const invokedPath = process.argv[1] ?? '';
if (invokedPath.endsWith('system-alignment-check.ts') || invokedPath.endsWith('system-alignment-check.js')) {
  const args = parseArgs(process.argv.slice(2));
  const report = buildAlignmentReport(args.registryPath);

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
