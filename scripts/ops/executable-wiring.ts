/**
 * UTV2-1624 — Executable wiring coverage.
 *
 * Builds a real execution graph for the repository (root package scripts, every
 * workspace package script, chained `pnpm` calls, direct `tsx --test` /
 * `node --test` invocations, glob expansion and workflow `run:` blocks) and uses
 * it to answer two questions mechanically:
 *
 *   1. Which canonical test files are actually reachable from an executed
 *      command, and by exactly which path?
 *   2. Which `scripts/ops/**` and `scripts/ci/**` capabilities are actually
 *      referenced by something executable?
 *
 * Reachability is never inferred from filename similarity. Every
 * `required-reachable` / `optional-reachable` verdict carries the concrete
 * command chain that reaches the file.
 *
 * Enforcement is staged: existing debt lives in a reviewed baseline ledger that
 * may shrink but never grow, and anything newly unwired fails.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export type TestStatus =
  | 'required-reachable'
  | 'optional-reachable'
  | 'fixture-helper-not-executable'
  | 'quarantined'
  | 'unwired';

export type CapabilityStatus =
  | 'required-gate'
  | 'wired-command'
  | 'wired-workflow'
  | 'invoked-library'
  | 'test-covered-library'
  | 'baselined'
  | 'orphan';

export type Severity = 'fail' | 'warn';

export interface WiringFinding {
  severity: Severity;
  code: string;
  subject: string;
  detail: string;
}

export interface ParserError {
  subject: string;
  detail: string;
}

export interface TestEntry {
  path: string;
  status: TestStatus;
  /** Exact execution-graph path that reaches this file, e.g. `pnpm verify -> verify:static -> test -> test:ops -> tsx --test`. */
  reached_by: string | null;
  /** The named command a human/CI runs to execute this file. */
  command: string | null;
  disposition: string | null;
  owner: string | null;
  issue: string | null;
  expiry: string | null;
}

export interface CapabilityEntry {
  path: string;
  status: CapabilityStatus;
  /** Executable references only (package scripts, workflows, non-test code imports/spawns). */
  references: string[];
  /** Documentation-only references. Never sufficient on their own. */
  doc_references: string[];
  /** References that exist only from test files. Never sufficient on their own. */
  test_references: string[];
  disposition: string | null;
  owner: string | null;
  issue: string | null;
  expiry: string | null;
}

export interface BaselineEntry {
  path: string;
  disposition: string;
  owner?: string;
  issue?: string;
  expiry?: string;
  note?: string;
}

export interface WiringBaseline {
  schema_version: number;
  required_roots?: string[];
  tests?: { max_entries: number; entries: BaselineEntry[] };
  capabilities?: { max_entries: number; entries: BaselineEntry[] };
}

export interface WiringReport {
  verdict: 'PASS' | 'FAIL';
  checked_at: string;
  baseline_path: string | null;
  required_roots: string[];
  totals: {
    test_files: number;
    required_reachable: number;
    optional_reachable: number;
    fixture_helper: number;
    quarantined: number;
    unwired: number;
    unwired_baselined: number;
    unwired_new: number;
    capabilities: number;
    capabilities_wired: number;
    capabilities_orphan: number;
    capabilities_orphan_baselined: number;
    capabilities_orphan_new: number;
    baseline_test_entries: number;
    baseline_capability_entries: number;
    baseline_test_max: number;
    baseline_capability_max: number;
  };
  tests: TestEntry[];
  capabilities: CapabilityEntry[];
  findings: WiringFinding[];
  parser_errors: ParserError[];
}

export interface WiringOptions {
  root?: string;
  baselinePath?: string | null;
  /** Root package scripts treated as the required floor. Defaults to the baseline value, then `['verify']`. */
  requiredRoots?: string[];
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

export const DEFAULT_BASELINE_PATH = 'docs/05_operations/executable-wiring-baseline.json';
const DEFAULT_REQUIRED_ROOTS = ['verify'];

const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const CAPABILITY_PATTERN = /\.(ts|mts|mjs|js|cjs|sh)$/;
const DECLARATION_PATTERN = /\.d\.(ts|mts|cts)$/;
const SOURCE_PATTERN = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const ISSUE_PATTERN = /^UTV2-\d+$/;
const EXPIRY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const SKIPPED_DIRS = new Set([
  '.git',
  '.next',
  '.out',
  '.pnpm-store',
  '.turbo',
  '.worktrees',
  'artifacts',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'playwright-report',
  'test-results',
]);

const CAPABILITY_ROOTS = ['scripts/ops', 'scripts/ci'];
const SOURCE_SCAN_ROOTS = ['scripts', 'apps', 'packages', 'db', 'deploy', 'supabase'];
const DOC_SCAN_ROOTS = ['docs', '.claude', '.agents', 'personas'];

/** Node/tsx flags that consume the following token as a value. */
const VALUE_FLAGS = new Set([
  '--test-name-pattern',
  '--test-reporter',
  '--test-reporter-destination',
  '--test-concurrency',
  '--test-timeout',
  '--test-shard',
  '--import',
  '--loader',
  '--experimental-loader',
  '--require',
  '--conditions',
  '--env-file',
  '-r',
  '-C',
  '--dir',
  '--filter',
  '-F',
  '--workspace-concurrency',
]);

/** Runners that discover their own test files rather than taking an explicit list. */
const DISCOVERY_RUNNERS = new Set(['vitest', 'jest', 'playwright']);

/**
 * Subcommands that mean "this invocation does not run tests". `npx playwright
 * install chromium` must never be read as "playwright discovers every spec in
 * the repository" — that single mis-read is what makes a dead test look alive.
 */
const NON_TEST_RUNNER_SUBCOMMANDS = new Set(['install', 'install-deps', 'codegen', 'show-report', 'merge-reports', 'help']);

export const ALLOWED_TEST_DISPOSITIONS = new Set([
  /** Green and deterministic; simply not wired into a command yet. */
  'phase-b-wiring',
  /** Currently red. Wiring it as-is would block `verify` for the whole program; needs triage first. */
  'failing-triage',
  /** Deliberately held out of CI with an issue, owner and expiry. */
  'quarantined',
  /** Needs a live database, browser or third-party service that required CI does not provision. */
  'external-service',
  /** Mutates shared state; requires isolation before it can be required. */
  'destructive',
  /** Superseded by a suite that already runs. */
  'duplicate-coverage',
  /** Believed obsolete; pending a delete decision (never deleted merely for being unwired). */
  'obsolete-review',
]);

export const ALLOWED_CAPABILITY_DISPOSITIONS = new Set([
  'manual-diagnostic',
  'one-shot-migration-aid',
  'transitional-wiring-gap',
  'archive-delete-candidate',
]);

/* -------------------------------------------------------------------------- */
/* Filesystem helpers                                                         */
/* -------------------------------------------------------------------------- */

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

function walk(root: string, relativeDir: string, out: string[]): void {
  const absolute = path.join(root, relativeDir);
  let entries: string[];
  try {
    entries = readdirSync(absolute);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIPPED_DIRS.has(entry)) continue;
    const relative = relativeDir ? `${relativeDir}/${entry}` : entry;
    let stat;
    try {
      stat = statSync(path.join(root, relative));
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walk(root, relative, out);
      continue;
    }
    out.push(relative);
  }
}

export function listRepoFiles(root: string, subdirectory = ''): string[] {
  const out: string[] = [];
  walk(root, subdirectory, out);
  return out.sort();
}

/* -------------------------------------------------------------------------- */
/* Command parsing                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Split a shell command into individually executed segments, quote-aware.
 * Splits on `&&`, `||`, `;`, `|` and newlines.
 */
export function splitCommandSegments(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: string | null = null;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] as string;

    if (quote) {
      current += char;
      if (char === quote && command[index - 1] !== '\\') quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '\n' || char === ';') {
      segments.push(current);
      current = '';
      continue;
    }
    if (char === '&' && command[index + 1] === '&') {
      segments.push(current);
      current = '';
      index += 1;
      continue;
    }
    if (char === '|') {
      if (command[index + 1] === '|') index += 1;
      segments.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  segments.push(current);
  return segments.map(segment => segment.trim()).filter(segment => segment.length > 0);
}

/** Tokenize a single command segment, quote-aware. Quotes are stripped from the result. */
export function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: string | null = null;
  let started = false;

  for (let index = 0; index < segment.length; index += 1) {
    const char = segment[index] as string;
    if (quote) {
      if (char === quote) {
        quote = null;
        continue;
      }
      current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started || current.length > 0) tokens.push(current);
      current = '';
      started = false;
      continue;
    }
    current += char;
  }
  if (started || current.length > 0) tokens.push(current);
  return tokens;
}

/* -------------------------------------------------------------------------- */
/* Glob expansion                                                             */
/* -------------------------------------------------------------------------- */

function segmentToRegExp(segment: string): RegExp {
  let source = '^';
  for (const char of segment) {
    if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`${source}$`);
}

export function hasGlobMagic(pattern: string): boolean {
  return /[*?]/.test(pattern);
}

/**
 * Expand a glob against the working tree.
 *
 * `globstar: false` models POSIX `sh` (the shell pnpm runs scripts under), where
 * `**` collapses to a single-segment `*`. `globstar: true` models Node's own
 * `--test` glob expansion, which is only reached when the shell finds no match
 * and passes the literal pattern through.
 */
export function expandGlob(pattern: string, cwd: string, options: { globstar?: boolean } = {}): string[] {
  const globstar = options.globstar ?? false;
  const normalized = toPosix(pattern);
  if (!hasGlobMagic(normalized)) {
    return existsSync(path.join(cwd, normalized)) ? [normalized] : [];
  }

  const segments = normalized.split('/').filter(segment => segment.length > 0);
  let frontier: string[] = [''];

  for (const segment of segments) {
    const next: string[] = [];
    if (segment === '**' && globstar) {
      const stack = [...frontier];
      const seen = new Set<string>();
      while (stack.length > 0) {
        const dir = stack.pop() as string;
        if (seen.has(dir)) continue;
        seen.add(dir);
        next.push(dir);
        let entries: string[];
        try {
          entries = readdirSync(path.join(cwd, dir));
        } catch {
          continue;
        }
        for (const entry of entries) {
          if (SKIPPED_DIRS.has(entry)) continue;
          const child = dir ? `${dir}/${entry}` : entry;
          try {
            if (statSync(path.join(cwd, child)).isDirectory()) stack.push(child);
          } catch {
            /* ignore unreadable entries */
          }
        }
      }
      frontier = next;
      continue;
    }

    const matcher = segmentToRegExp(segment === '**' ? '*' : segment);
    for (const dir of frontier) {
      let entries: string[];
      try {
        entries = readdirSync(path.join(cwd, dir));
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!matcher.test(entry)) continue;
        next.push(dir ? `${dir}/${entry}` : entry);
      }
    }
    frontier = next;
  }

  return frontier
    .filter(candidate => {
      try {
        return statSync(path.join(cwd, candidate)).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

/**
 * Expand a test-runner path argument exactly the way the pipeline does:
 * POSIX-shell expansion first, Node's recursive glob only when the shell found
 * nothing to substitute.
 */
export function expandTestArgument(
  argument: string,
  cwd: string,
): { files: string[]; shadowed: string[] } {
  const shellMatches = expandGlob(argument, cwd, { globstar: false });
  if (shellMatches.length > 0) {
    if (argument.includes('**')) {
      const recursive = expandGlob(argument, cwd, { globstar: true });
      const shadowed = recursive.filter(file => !shellMatches.includes(file));
      return { files: shellMatches, shadowed };
    }
    return { files: shellMatches, shadowed: [] };
  }
  return { files: expandGlob(argument, cwd, { globstar: true }), shadowed: [] };
}

/* -------------------------------------------------------------------------- */
/* Execution graph                                                            */
/* -------------------------------------------------------------------------- */

interface PackageNode {
  /** Package name from package.json, or `<root>` for the workspace root. */
  name: string;
  /** Directory relative to the repo root (`''` for the root package). */
  dir: string;
  scripts: Record<string, string>;
}

interface ScriptId {
  pkg: string;
  script: string;
}

function scriptKey(id: ScriptId): string {
  return `${id.pkg}::${id.script}`;
}

export interface ExecutionGraph {
  packages: Map<string, PackageNode>;
  rootPackage: PackageNode;
  parserErrors: ParserError[];
}

function readPackage(root: string, dir: string, parserErrors: ParserError[]): PackageNode | null {
  const manifestPath = path.join(root, dir, 'package.json');
  if (!existsSync(manifestPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name?: string;
      scripts?: Record<string, string>;
    };
    return {
      name: parsed.name ?? (dir === '' ? '<root>' : dir),
      dir,
      scripts: parsed.scripts ?? {},
    };
  } catch (error) {
    parserErrors.push({
      subject: toPosix(path.join(dir, 'package.json')),
      detail: `package.json parse failure: ${(error as Error).message}`,
    });
    return null;
  }
}

function readWorkspaceGlobs(root: string, parserErrors: ParserError[]): string[] {
  const workspacePath = path.join(root, 'pnpm-workspace.yaml');
  if (!existsSync(workspacePath)) return [];
  try {
    const parsed = YAML.parse(readFileSync(workspacePath, 'utf8')) as { packages?: string[] } | null;
    return parsed?.packages ?? [];
  } catch (error) {
    parserErrors.push({
      subject: 'pnpm-workspace.yaml',
      detail: `workspace manifest parse failure: ${(error as Error).message}`,
    });
    return [];
  }
}

function expandWorkspaceGlob(globPattern: string, root: string): string[] {
  const normalized = toPosix(globPattern).replace(/\/$/, '');
  if (!hasGlobMagic(normalized)) {
    return existsSync(path.join(root, normalized, 'package.json')) ? [normalized] : [];
  }
  const parts = normalized.split('/');
  let frontier = [''];
  for (const part of parts) {
    const matcher = segmentToRegExp(part === '**' ? '*' : part);
    const next: string[] = [];
    for (const dir of frontier) {
      let entries: string[];
      try {
        entries = readdirSync(path.join(root, dir));
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (SKIPPED_DIRS.has(entry) || !matcher.test(entry)) continue;
        const child = dir ? `${dir}/${entry}` : entry;
        try {
          if (statSync(path.join(root, child)).isDirectory()) next.push(child);
        } catch {
          /* ignore */
        }
      }
    }
    frontier = next;
  }
  return frontier;
}

export function buildExecutionGraph(root: string): ExecutionGraph {
  const parserErrors: ParserError[] = [];
  const packages = new Map<string, PackageNode>();

  const rootPackage = readPackage(root, '', parserErrors);
  if (!rootPackage) {
    throw new Error(`no root package.json found at ${root}`);
  }
  packages.set(rootPackage.name, rootPackage);
  packages.set('<root>', rootPackage);

  for (const globPattern of readWorkspaceGlobs(root, parserErrors)) {
    for (const dir of expandWorkspaceGlob(globPattern, root)) {
      const node = readPackage(root, dir, parserErrors);
      if (!node) continue;
      packages.set(node.name, node);
      packages.set(dir, node);
    }
  }

  return { packages, rootPackage, parserErrors };
}

/* -------------------------------------------------------------------------- */
/* Traversal                                                                  */
/* -------------------------------------------------------------------------- */

interface Reach {
  /** Human-readable execution chain, e.g. `pnpm verify -> verify:static -> test -> test:ops`. */
  chain: string;
  /** The entry command a human runs. */
  command: string;
}

export interface TraversalResult {
  /** repo-relative test file -> how it is reached. */
  testFiles: Map<string, Reach>;
  /** repo-relative capability file -> reference labels. */
  capabilityRefs: Map<string, Set<string>>;
  /** Discovery runners rooted at a package dir (vitest/jest/playwright). */
  discoveryRoots: { dir: string; scope: string; chain: string; command: string }[];
  /** `**` globs whose shell expansion hides files a globstar shell would run. */
  globShadowed: { pattern: string; chain: string; hidden: string[] }[];
  visited: Set<string>;
}

interface SegmentContext {
  graph: ExecutionGraph;
  root: string;
  pkg: PackageNode;
  chain: string;
  command: string;
  result: TraversalResult;
  enqueue: (id: ScriptId, chain: string, command: string) => void;
}

function recordCapabilityReference(result: TraversalResult, file: string, label: string): void {
  const existing = result.capabilityRefs.get(file);
  if (existing) existing.add(label);
  else result.capabilityRefs.set(file, new Set([label]));
}

function isUnderCapabilityRoot(file: string): boolean {
  return CAPABILITY_ROOTS.some(prefix => file.startsWith(`${prefix}/`));
}

function recordFileArgument(context: SegmentContext, relativeToRoot: string, chain: string): void {
  if (TEST_FILE_PATTERN.test(relativeToRoot)) {
    if (!context.result.testFiles.has(relativeToRoot)) {
      context.result.testFiles.set(relativeToRoot, { chain, command: context.command });
    }
    return;
  }
  if (isUnderCapabilityRoot(relativeToRoot)) {
    recordCapabilityReference(context.result, relativeToRoot, `command:${context.command}`);
  }
}

function collectRunnerArguments(tokens: string[]): { hasTestFlag: boolean; positional: string[] } {
  let hasTestFlag = false;
  const positional: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as string;
    if (token === '--test') {
      hasTestFlag = true;
      continue;
    }
    if (token.startsWith('-')) {
      const flagName = token.includes('=') ? (token.split('=')[0] as string) : token;
      if (flagName === '--test') hasTestFlag = true;
      if (!token.includes('=') && VALUE_FLAGS.has(flagName)) index += 1;
      continue;
    }
    positional.push(token);
  }
  return { hasTestFlag, positional };
}

function handleRunnerSegment(context: SegmentContext, runner: string, rest: string[]): void {
  const { hasTestFlag, positional } = collectRunnerArguments(rest);
  const cwd = path.join(context.root, context.pkg.dir);
  const chain = `${context.chain} -> ${runner}${hasTestFlag ? ' --test' : ''}`;

  if (!hasTestFlag) {
    // Not a test invocation, but it may still execute a capability script.
    for (const argument of positional) {
      for (const file of expandTestArgument(argument, cwd).files) {
        const relativeToRoot = toPosix(path.join(context.pkg.dir, file));
        if (isUnderCapabilityRoot(relativeToRoot)) {
          recordCapabilityReference(context.result, relativeToRoot, `command:${context.command}`);
        }
      }
    }
    return;
  }

  if (positional.length === 0) {
    context.result.discoveryRoots.push({
      dir: context.pkg.dir,
      scope: context.pkg.dir,
      chain,
      command: context.command,
    });
    return;
  }

  for (const argument of positional) {
    const { files, shadowed } = expandTestArgument(argument, cwd);
    for (const file of files) {
      recordFileArgument(context, toPosix(path.join(context.pkg.dir, file)), chain);
    }
    if (shadowed.length > 0) {
      context.result.globShadowed.push({
        pattern: toPosix(path.join(context.pkg.dir, argument)),
        chain,
        hidden: shadowed.map(file => toPosix(path.join(context.pkg.dir, file))),
      });
    }
  }
}

/**
 * Playwright discovers only what its config's `testDir` points at, so scoping
 * discovery to the whole package would falsely mark unrelated tests reachable.
 */
function resolvePlaywrightTestDir(context: SegmentContext, rest: string[]): string {
  const configIndex = rest.findIndex(token => token === '-c' || token === '--config');
  const explicitConfig = configIndex >= 0 ? rest[configIndex + 1] : undefined;
  const candidates = explicitConfig
    ? [explicitConfig]
    : ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs'];

  for (const candidate of candidates) {
    const relative = toPosix(path.join(context.pkg.dir, candidate));
    const absolute = path.join(context.root, relative);
    if (!existsSync(absolute)) continue;
    let content: string;
    try {
      content = readFileSync(absolute, 'utf8');
    } catch {
      continue;
    }
    const match = /testDir\s*:\s*['"]([^'"]+)['"]/.exec(content);
    if (!match) return context.pkg.dir;
    return toPosix(path.join(context.pkg.dir, match[1] as string));
  }
  return context.pkg.dir;
}

const PNPM_NON_SCRIPT_SUBCOMMANDS = new Set([
  'add',
  'audit',
  'dlx',
  'fetch',
  'import',
  'install',
  'i',
  'licenses',
  'link',
  'list',
  'ls',
  'outdated',
  'pack',
  'patch',
  'prune',
  'publish',
  'rebuild',
  'remove',
  'root',
  'setup',
  'store',
  'update',
  'up',
  'why',
]);

function handlePnpmSegment(context: SegmentContext, rest: string[]): void {
  let filter: string | null = null;
  let recursive = false;
  let index = 0;

  for (; index < rest.length; index += 1) {
    const token = rest[index] as string;
    if (!token.startsWith('-')) break;
    if (token === '--filter' || token === '-F') {
      filter = rest[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token.startsWith('--filter=')) {
      filter = token.slice('--filter='.length);
      continue;
    }
    if (token === '-r' || token === '--recursive') {
      recursive = true;
      continue;
    }
    if (token === '-C' || token === '--dir') {
      index += 1;
      continue;
    }
    // -s, --silent, -w, --workspace-root, --if-present and friends take no value.
  }

  const remainder = rest.slice(index);
  if (remainder.length === 0) return;

  let head = remainder[0] as string;
  let args = remainder.slice(1);

  if (head === 'exec') {
    const target = filter ? (context.graph.packages.get(filter) ?? null) : context.pkg;
    if (!target) return;
    interpretSegment({ ...context, pkg: target, chain: `${context.chain} -> pnpm exec` }, args.join(' '));
    return;
  }

  if (head === 'run') {
    head = (args[0] as string) ?? '';
    args = args.slice(1);
  }

  if (!head || PNPM_NON_SCRIPT_SUBCOMMANDS.has(head)) return;

  if (recursive) {
    const seen = new Set<PackageNode>();
    for (const node of context.graph.packages.values()) {
      if (seen.has(node)) continue;
      seen.add(node);
      if (!node.scripts[head]) continue;
      context.enqueue(
        { pkg: node.name, script: head },
        `${context.chain} -> ${node.name}:${head}`,
        context.command,
      );
    }
    return;
  }

  const target = filter ? (context.graph.packages.get(filter) ?? null) : context.graph.rootPackage;
  if (!target) return;
  if (!target.scripts[head]) return;

  const label = target === context.graph.rootPackage ? head : `${target.name}:${head}`;
  context.enqueue({ pkg: target.name, script: head }, `${context.chain} -> ${label}`, context.command);
}

function interpretSegment(context: SegmentContext, segment: string): void {
  const tokens = tokenize(segment).filter(token => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token));
  if (tokens.length === 0) return;

  let head = tokens[0] as string;
  let rest = tokens.slice(1);

  if (head === 'npx' || head === 'bunx') {
    head = (rest[0] as string) ?? '';
    rest = rest.slice(1);
  }

  if (head === 'pnpm' || head === 'npm' || head === 'yarn') {
    handlePnpmSegment(context, rest);
    return;
  }

  const runnerName = path.basename(head);
  if (runnerName === 'tsx' || runnerName === 'node' || runnerName === 'ts-node') {
    handleRunnerSegment(context, runnerName, rest);
    return;
  }

  if (DISCOVERY_RUNNERS.has(runnerName)) {
    const subcommand = rest.find(token => !token.startsWith('-')) ?? '';
    if (NON_TEST_RUNNER_SUBCOMMANDS.has(subcommand)) return;
    if (runnerName === 'playwright' && subcommand !== 'test') return;
    context.result.discoveryRoots.push({
      dir: context.pkg.dir,
      scope: runnerName === 'playwright' ? resolvePlaywrightTestDir(context, rest) : context.pkg.dir,
      chain: `${context.chain} -> ${runnerName}`,
      command: context.command,
    });
    return;
  }

  // Any other executable: still record capability references from its arguments.
  for (const token of [head, ...rest]) {
    if (token.startsWith('-')) continue;
    const relative = toPosix(path.join(context.pkg.dir, token));
    if (isUnderCapabilityRoot(relative) && existsSync(path.join(context.root, relative))) {
      recordCapabilityReference(context.result, relative, `command:${context.command}`);
    }
  }
}

interface QueueItem {
  id: ScriptId;
  chain: string;
  command: string;
}

export function createTraversalResult(): TraversalResult {
  return {
    testFiles: new Map(),
    capabilityRefs: new Map(),
    discoveryRoots: [],
    globShadowed: [],
    visited: new Set(),
  };
}

/** Traverse the execution graph breadth-first from a set of root package scripts. */
export function traverse(
  graph: ExecutionGraph,
  root: string,
  rootScripts: { pkg: string; script: string; command: string }[],
  result?: TraversalResult,
): TraversalResult {
  const state = result ?? createTraversalResult();

  const queue: QueueItem[] = [];
  for (const entry of rootScripts) {
    const node = graph.packages.get(entry.pkg);
    if (!node?.scripts[entry.script]) continue;
    queue.push({ id: { pkg: node.name, script: entry.script }, chain: entry.command, command: entry.command });
  }

  const enqueue = (id: ScriptId, chain: string, command: string): void => {
    queue.push({ id, chain, command });
  };

  while (queue.length > 0) {
    const item = queue.shift() as QueueItem;
    const key = scriptKey(item.id);
    if (state.visited.has(key)) continue;
    state.visited.add(key);

    const node = graph.packages.get(item.id.pkg);
    const commandText = node?.scripts[item.id.script];
    if (!node || !commandText) continue;

    for (const segment of splitCommandSegments(commandText)) {
      interpretSegment(
        { graph, root, pkg: node, chain: item.chain, command: item.command, result: state, enqueue },
        segment,
      );
    }
  }

  return state;
}

/* -------------------------------------------------------------------------- */
/* Workflow scanning                                                          */
/* -------------------------------------------------------------------------- */

export interface WorkflowInvocation {
  workflow: string;
  run: string;
}

function collectRunStrings(node: unknown, emit: (value: string) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) collectRunStrings(child, emit);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'run' && typeof value === 'string') emit(value);
    else collectRunStrings(value, emit);
  }
}

export function collectWorkflowRunBlocks(root: string): {
  runs: WorkflowInvocation[];
  parserErrors: ParserError[];
} {
  const runs: WorkflowInvocation[] = [];
  const parserErrors: ParserError[] = [];
  const workflowDir = path.join(root, '.github/workflows');
  if (!existsSync(workflowDir)) return { runs, parserErrors };

  for (const entry of readdirSync(workflowDir).sort()) {
    if (!entry.endsWith('.yml') && !entry.endsWith('.yaml')) continue;
    const relative = `.github/workflows/${entry}`;
    let document: unknown;
    try {
      document = YAML.parse(readFileSync(path.join(workflowDir, entry), 'utf8'));
    } catch (error) {
      parserErrors.push({ subject: relative, detail: `workflow parse failure: ${(error as Error).message}` });
      continue;
    }
    collectRunStrings(document, value => runs.push({ workflow: relative, run: value }));
  }

  return { runs, parserErrors };
}

/* -------------------------------------------------------------------------- */
/* Test inventory + classification                                            */
/* -------------------------------------------------------------------------- */

export function listTestFiles(root: string): string[] {
  return listRepoFiles(root).filter(file => TEST_FILE_PATTERN.test(file));
}

const TEST_REGISTRATION_PATTERN = /(^|[^\w.$])(test|it|describe|suite|bench)\s*(\.\w+\s*)?\(/m;
const TEST_IMPORT_PATTERN =
  /from\s+['"](node:test|vitest|@playwright\/test|mocha|@jest\/globals)['"]|require\(['"]node:test['"]\)/;

/** A `*.test.ts` file that registers no tests is a fixture/helper, not an executable test. */
export function isExecutableTestFile(root: string, relativePath: string): boolean {
  let content: string;
  try {
    content = readFileSync(path.join(root, relativePath), 'utf8');
  } catch {
    return true;
  }
  if (TEST_IMPORT_PATTERN.test(content)) return true;
  return TEST_REGISTRATION_PATTERN.test(content);
}

/* -------------------------------------------------------------------------- */
/* Capability inventory                                                       */
/* -------------------------------------------------------------------------- */

export function listCapabilityFiles(root: string): string[] {
  const files: string[] = [];
  for (const capabilityRoot of CAPABILITY_ROOTS) {
    for (const file of listRepoFiles(root, capabilityRoot)) {
      if (!CAPABILITY_PATTERN.test(file)) continue;
      if (TEST_FILE_PATTERN.test(file)) continue;
      if (DECLARATION_PATTERN.test(file)) continue;
      files.push(file);
    }
  }
  return files.sort();
}

const IMPORT_PATTERN = /(?:from\s+|import\s*\(|require\s*\(|import\s+)['"]([^'"]+)['"]/g;

function resolveImport(root: string, fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = toPosix(path.join(path.dirname(fromFile), specifier));
  const candidates = [base];
  if (base.endsWith('.js')) candidates.push(base.replace(/\.js$/, '.ts'));
  if (base.endsWith('.mjs')) candidates.push(base.replace(/\.mjs$/, '.mts'));
  candidates.push(`${base}.ts`, `${base}.mts`, `${base}.js`, `${base}.mjs`, `${base}/index.ts`, `${base}/index.js`);
  for (const candidate of candidates) {
    if (existsSync(path.join(root, candidate))) return candidate;
  }
  return null;
}

export interface CapabilityReferenceIndex {
  executable: Map<string, Set<string>>;
  tests: Map<string, Set<string>>;
  docs: Map<string, Set<string>>;
}

export function indexCapabilityReferences(root: string, capabilities: string[]): CapabilityReferenceIndex {
  const capabilitySet = new Set(capabilities);
  const executable = new Map<string, Set<string>>();
  const tests = new Map<string, Set<string>>();
  const docs = new Map<string, Set<string>>();

  const add = (bucket: Map<string, Set<string>>, key: string, label: string): void => {
    const existing = bucket.get(key);
    if (existing) existing.add(label);
    else bucket.set(key, new Set([label]));
  };

  const sourceFiles: string[] = [];
  for (const scanRoot of SOURCE_SCAN_ROOTS) {
    for (const file of listRepoFiles(root, scanRoot)) {
      if (SOURCE_PATTERN.test(file) || file.endsWith('.sh')) sourceFiles.push(file);
    }
  }

  for (const file of sourceFiles) {
    let content: string;
    try {
      content = readFileSync(path.join(root, file), 'utf8');
    } catch {
      continue;
    }
    const isTest = TEST_FILE_PATTERN.test(file);
    const bucket = isTest ? tests : executable;

    IMPORT_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = IMPORT_PATTERN.exec(content)) !== null) {
      const resolved = resolveImport(root, file, match[1] as string);
      if (resolved && capabilitySet.has(resolved) && resolved !== file) {
        add(bucket, resolved, `${isTest ? 'test-import' : 'import'}:${file}`);
      }
    }

    // Spawn-style invocation: the capability path appears literally in the source.
    for (const capability of capabilities) {
      if (capability === file) continue;
      if (content.includes(capability)) add(bucket, capability, `${isTest ? 'test-literal' : 'literal'}:${file}`);
    }
  }

  for (const scanRoot of DOC_SCAN_ROOTS) {
    for (const file of listRepoFiles(root, scanRoot)) {
      if (!file.endsWith('.md') && !file.endsWith('.mdx') && !file.endsWith('.json')) continue;
      let content: string;
      try {
        content = readFileSync(path.join(root, file), 'utf8');
      } catch {
        continue;
      }
      for (const capability of capabilities) {
        if (content.includes(capability)) add(docs, capability, `doc:${file}`);
      }
    }
  }

  return { executable, tests, docs };
}

/* -------------------------------------------------------------------------- */
/* Baseline ledger                                                            */
/* -------------------------------------------------------------------------- */

export function readBaseline(baselinePath: string | null): WiringBaseline | null {
  if (!baselinePath || !existsSync(baselinePath)) return null;
  return JSON.parse(readFileSync(baselinePath, 'utf8')) as WiringBaseline;
}

function validateBaselineMetadata(
  entry: BaselineEntry,
  allowed: Set<string>,
  code: string,
  findings: WiringFinding[],
): boolean {
  const problems: string[] = [];
  if (!allowed.has(entry.disposition)) {
    problems.push(`disposition "${entry.disposition}" is not one of: ${[...allowed].sort().join(', ')}`);
  }
  if (!entry.owner || entry.owner.trim().length === 0) problems.push('missing owner');
  if (!entry.issue || !ISSUE_PATTERN.test(entry.issue)) problems.push('missing or malformed issue (expected UTV2-###)');
  if (!entry.expiry || !EXPIRY_PATTERN.test(entry.expiry)) problems.push('missing or malformed expiry (expected YYYY-MM-DD)');

  if (problems.length === 0) return true;
  findings.push({
    severity: 'fail',
    code,
    subject: entry.path,
    detail: `baseline entry is incomplete: ${problems.join('; ')}`,
  });
  return false;
}

/* -------------------------------------------------------------------------- */
/* Report                                                                     */
/* -------------------------------------------------------------------------- */

export function buildWiringReport(options: WiringOptions = {}): WiringReport {
  const root = path.resolve(options.root ?? process.cwd());
  const baselinePath =
    options.baselinePath === null
      ? null
      : path.isAbsolute(options.baselinePath ?? DEFAULT_BASELINE_PATH)
        ? (options.baselinePath as string)
        : path.join(root, options.baselinePath ?? DEFAULT_BASELINE_PATH);

  const findings: WiringFinding[] = [];
  const parserErrors: ParserError[] = [];

  let baseline: WiringBaseline | null = null;
  try {
    baseline = readBaseline(baselinePath);
  } catch (error) {
    parserErrors.push({
      subject: baselinePath ? toPosix(path.relative(root, baselinePath)) : 'baseline',
      detail: `baseline parse failure: ${(error as Error).message}`,
    });
  }

  const requiredRoots = options.requiredRoots ?? baseline?.required_roots ?? DEFAULT_REQUIRED_ROOTS;

  const graph = buildExecutionGraph(root);
  parserErrors.push(...graph.parserErrors);

  // Pass 1 — the required floor.
  const required = traverse(
    graph,
    root,
    requiredRoots.map(script => ({ pkg: graph.rootPackage.name, script, command: `pnpm ${script}` })),
  );

  // Pass 2 — every other named command in the workspace.
  const optionalRoots: { pkg: string; script: string; command: string }[] = [];
  const seenPackages = new Set<PackageNode>();
  for (const node of graph.packages.values()) {
    if (seenPackages.has(node)) continue;
    seenPackages.add(node);
    for (const script of Object.keys(node.scripts)) {
      optionalRoots.push({
        pkg: node.name,
        script,
        command: node === graph.rootPackage ? `pnpm ${script}` : `pnpm --filter ${node.name} ${script}`,
      });
    }
  }
  const optional = traverse(graph, root, optionalRoots);

  // Pass 3 — workflow `run:` blocks that execute tests outside package scripts.
  const workflowScan = collectWorkflowRunBlocks(root);
  parserErrors.push(...workflowScan.parserErrors);
  for (const invocation of workflowScan.runs) {
    for (const segment of splitCommandSegments(invocation.run)) {
      interpretSegment(
        {
          graph,
          root,
          pkg: graph.rootPackage,
          chain: invocation.workflow,
          command: invocation.workflow,
          result: optional,
          enqueue: () => {
            /* workflow-invoked package scripts are already covered by the optional pass */
          },
        },
        segment,
      );
    }
  }

  // Discovery runners (vitest/jest/playwright) reach every test under their package.
  const allTestFiles = listTestFiles(root);
  const applyDiscovery = (result: TraversalResult): void => {
    for (const discovery of result.discoveryRoots) {
      const prefix = discovery.scope ? `${discovery.scope}/` : '';
      for (const file of allTestFiles) {
        if (!file.startsWith(prefix)) continue;
        if (result.testFiles.has(file)) continue;
        result.testFiles.set(file, { chain: `${discovery.chain} (runner discovery)`, command: discovery.command });
      }
    }
  };
  applyDiscovery(required);
  applyDiscovery(optional);

  const baselineTests = baseline?.tests?.entries ?? [];
  const baselineTestMap = new Map(baselineTests.map(entry => [entry.path, entry]));
  const baselineTestMax = baseline?.tests?.max_entries ?? 0;
  const today = new Date().toISOString().slice(0, 10);

  const tests: TestEntry[] = [];
  for (const file of allTestFiles) {
    const requiredReach = required.testFiles.get(file);
    const optionalReach = optional.testFiles.get(file);
    const ledgerEntry = baselineTestMap.get(file);

    if (requiredReach) {
      tests.push({
        path: file,
        status: 'required-reachable',
        reached_by: requiredReach.chain,
        command: requiredReach.command,
        disposition: null,
        owner: null,
        issue: null,
        expiry: null,
      });
      continue;
    }
    if (optionalReach) {
      tests.push({
        path: file,
        status: 'optional-reachable',
        reached_by: optionalReach.chain,
        command: optionalReach.command,
        disposition: null,
        owner: null,
        issue: null,
        expiry: null,
      });
      continue;
    }
    if (!isExecutableTestFile(root, file)) {
      tests.push({
        path: file,
        status: 'fixture-helper-not-executable',
        reached_by: null,
        command: null,
        disposition: null,
        owner: null,
        issue: null,
        expiry: null,
      });
      continue;
    }
    if (ledgerEntry) {
      const complete = validateBaselineMetadata(
        ledgerEntry,
        ALLOWED_TEST_DISPOSITIONS,
        'WIRING_BASELINE_TEST_ENTRY_INCOMPLETE',
        findings,
      );
      if (complete && ledgerEntry.expiry && ledgerEntry.expiry < today) {
        findings.push({
          severity: 'warn',
          code: 'WIRING_BASELINE_TEST_ENTRY_EXPIRED',
          subject: file,
          detail: `baseline entry expired on ${ledgerEntry.expiry}; wire it, re-quarantine it with a new expiry, or remove it`,
        });
      }
      tests.push({
        path: file,
        status: ledgerEntry.disposition === 'quarantined' ? 'quarantined' : 'unwired',
        reached_by: null,
        command: null,
        disposition: ledgerEntry.disposition,
        owner: ledgerEntry.owner ?? null,
        issue: ledgerEntry.issue ?? null,
        expiry: ledgerEntry.expiry ?? null,
      });
      continue;
    }

    findings.push({
      severity: 'fail',
      code: 'WIRING_TEST_UNWIRED_NEW',
      subject: file,
      detail:
        'test file is not reachable from any package script or workflow command and is not in the reviewed wiring baseline; wire it into a test command, or add a reviewed baseline entry with disposition, owner, issue and expiry',
    });
    tests.push({
      path: file,
      status: 'unwired',
      reached_by: null,
      command: null,
      disposition: null,
      owner: null,
      issue: null,
      expiry: null,
    });
  }

  // Stale baseline entries must be removed, so the ledger can only shrink.
  const testPathSet = new Set(allTestFiles);
  const noLongerBaselineable = new Set(
    tests
      .filter(
        entry =>
          entry.status === 'required-reachable' ||
          entry.status === 'optional-reachable' ||
          entry.status === 'fixture-helper-not-executable',
      )
      .map(entry => entry.path),
  );
  for (const entry of baselineTests) {
    if (!testPathSet.has(entry.path)) {
      findings.push({
        severity: 'fail',
        code: 'WIRING_BASELINE_TEST_ENTRY_STALE',
        subject: entry.path,
        detail: 'baseline entry references a test file that no longer exists; remove the entry',
      });
      continue;
    }
    if (noLongerBaselineable.has(entry.path)) {
      findings.push({
        severity: 'fail',
        code: 'WIRING_BASELINE_TEST_ENTRY_STALE',
        subject: entry.path,
        detail:
          'baseline entry is now reachable (or is a non-executable fixture); remove the entry so the baseline shrinks',
      });
    }
  }

  if (baselineTests.length > baselineTestMax) {
    findings.push({
      severity: 'fail',
      code: 'WIRING_BASELINE_TESTS_GREW',
      subject: DEFAULT_BASELINE_PATH,
      detail: `baseline holds ${baselineTests.length} test entries but max_entries is ${baselineTestMax}; the wiring baseline may shrink but never grow`,
    });
  }

  // Capabilities.
  const reachableTestFiles = new Set(
    tests
      .filter(entry => entry.status === 'required-reachable' || entry.status === 'optional-reachable')
      .map(entry => entry.path),
  );
  const capabilities = listCapabilityFiles(root);
  const referenceIndex = indexCapabilityReferences(root, capabilities);
  const baselineCapabilities = baseline?.capabilities?.entries ?? [];
  const baselineCapabilityMap = new Map(baselineCapabilities.map(entry => [entry.path, entry]));
  const baselineCapabilityMax = baseline?.capabilities?.max_entries ?? 0;

  const workflowReferences = new Map<string, Set<string>>();
  for (const invocation of workflowScan.runs) {
    for (const capability of capabilities) {
      if (!invocation.run.includes(capability)) continue;
      const existing = workflowReferences.get(capability);
      if (existing) existing.add(`workflow:${invocation.workflow}`);
      else workflowReferences.set(capability, new Set([`workflow:${invocation.workflow}`]));
    }
  }

  const capabilityEntries: CapabilityEntry[] = [];
  for (const capability of capabilities) {
    const executableRefs = new Set<string>();
    for (const label of required.capabilityRefs.get(capability) ?? []) executableRefs.add(`required:${label}`);
    for (const label of optional.capabilityRefs.get(capability) ?? []) executableRefs.add(label);
    for (const label of workflowReferences.get(capability) ?? []) executableRefs.add(label);
    for (const label of referenceIndex.executable.get(capability) ?? []) executableRefs.add(label);

    const testRefs = [...(referenceIndex.tests.get(capability) ?? [])].sort();
    const docRefs = [...(referenceIndex.docs.get(capability) ?? [])].sort();
    const ledgerEntry = baselineCapabilityMap.get(capability);

    // A module imported by a test that actually runs IS executed. A module
    // imported only by a test that itself never runs is not.
    const coveringTests = testRefs.filter(label => {
      const file = label.slice(label.indexOf(':') + 1);
      return reachableTestFiles.has(file);
    });

    let status: CapabilityStatus;
    if ([...executableRefs].some(label => label.startsWith('required:'))) status = 'required-gate';
    else if ([...executableRefs].some(label => label.startsWith('command:'))) status = 'wired-command';
    else if ([...executableRefs].some(label => label.startsWith('workflow:'))) status = 'wired-workflow';
    else if (executableRefs.size > 0) status = 'invoked-library';
    else if (coveringTests.length > 0) status = 'test-covered-library';
    else if (ledgerEntry) status = 'baselined';
    else status = 'orphan';

    if (status === 'baselined' && ledgerEntry) {
      const complete = validateBaselineMetadata(
        ledgerEntry,
        ALLOWED_CAPABILITY_DISPOSITIONS,
        'WIRING_BASELINE_CAPABILITY_ENTRY_INCOMPLETE',
        findings,
      );
      if (complete && ledgerEntry.expiry && ledgerEntry.expiry < today) {
        findings.push({
          severity: 'warn',
          code: 'WIRING_BASELINE_CAPABILITY_ENTRY_EXPIRED',
          subject: capability,
          detail: `capability disposition expired on ${ledgerEntry.expiry}`,
        });
      }
    }

    if (status === 'orphan') {
      findings.push({
        severity: 'fail',
        code: 'WIRING_CAPABILITY_ORPHAN',
        subject: capability,
        detail:
          docRefs.length > 0
            ? 'active capability has documentation-only references and no executable reference; documentation is not sufficient for a capability claimed as automated — wire it, or give it a reviewed disposition and owner'
            : 'active capability has no executable reference from any package script, workflow or code path; wire it, or give it a reviewed disposition and owner',
      });
    }

    capabilityEntries.push({
      path: capability,
      status,
      references: [...executableRefs].sort(),
      doc_references: docRefs,
      test_references: testRefs,
      disposition: ledgerEntry?.disposition ?? null,
      owner: ledgerEntry?.owner ?? null,
      issue: ledgerEntry?.issue ?? null,
      expiry: ledgerEntry?.expiry ?? null,
    });
  }

  const capabilityPathSet = new Set(capabilities);
  const wiredCapabilities = new Set(
    capabilityEntries
      .filter(entry => entry.status !== 'orphan' && entry.status !== 'baselined')
      .map(entry => entry.path),
  );
  for (const entry of baselineCapabilities) {
    if (!capabilityPathSet.has(entry.path)) {
      findings.push({
        severity: 'fail',
        code: 'WIRING_BASELINE_CAPABILITY_ENTRY_STALE',
        subject: entry.path,
        detail: 'baseline entry references a capability that no longer exists; remove the entry',
      });
      continue;
    }
    if (wiredCapabilities.has(entry.path)) {
      findings.push({
        severity: 'fail',
        code: 'WIRING_BASELINE_CAPABILITY_ENTRY_STALE',
        subject: entry.path,
        detail: 'baseline entry is now wired; remove the entry so the baseline shrinks',
      });
    }
  }

  if (baselineCapabilities.length > baselineCapabilityMax) {
    findings.push({
      severity: 'fail',
      code: 'WIRING_BASELINE_CAPABILITIES_GREW',
      subject: DEFAULT_BASELINE_PATH,
      detail: `baseline holds ${baselineCapabilities.length} capability entries but max_entries is ${baselineCapabilityMax}; the wiring baseline may shrink but never grow`,
    });
  }

  // `**` globs that POSIX sh silently collapses to a single path segment.
  const shadowSeen = new Set<string>();
  for (const shadowed of [...required.globShadowed, ...optional.globShadowed]) {
    if (shadowSeen.has(shadowed.pattern)) continue;
    shadowSeen.add(shadowed.pattern);
    findings.push({
      severity: 'warn',
      code: 'WIRING_GLOB_SHADOWED',
      subject: shadowed.pattern,
      detail: `POSIX sh expands "**" as a single path segment, so ${shadowed.hidden.length} file(s) under this pattern never run: ${shadowed.hidden.join(', ')}`,
    });
  }

  const statusCount = (status: TestStatus): number => tests.filter(entry => entry.status === status).length;
  const unwiredEntries = tests.filter(entry => entry.status === 'unwired');
  const unwiredNew = unwiredEntries.filter(entry => entry.disposition === null).length;
  const quarantined = statusCount('quarantined');
  const orphanEntries = capabilityEntries.filter(entry => entry.status === 'orphan');
  const baselinedCapabilities = capabilityEntries.filter(entry => entry.status === 'baselined');

  const failCount = findings.filter(finding => finding.severity === 'fail').length;

  return {
    verdict: failCount === 0 && parserErrors.length === 0 ? 'PASS' : 'FAIL',
    checked_at: new Date().toISOString(),
    baseline_path: baselinePath ? toPosix(path.relative(root, baselinePath)) : null,
    required_roots: requiredRoots,
    totals: {
      test_files: tests.length,
      required_reachable: statusCount('required-reachable'),
      optional_reachable: statusCount('optional-reachable'),
      fixture_helper: statusCount('fixture-helper-not-executable'),
      quarantined,
      unwired: unwiredEntries.length + quarantined,
      unwired_baselined: unwiredEntries.length - unwiredNew + quarantined,
      unwired_new: unwiredNew,
      capabilities: capabilityEntries.length,
      capabilities_wired: capabilityEntries.length - orphanEntries.length - baselinedCapabilities.length,
      capabilities_orphan: orphanEntries.length + baselinedCapabilities.length,
      capabilities_orphan_baselined: baselinedCapabilities.length,
      capabilities_orphan_new: orphanEntries.length,
      baseline_test_entries: baselineTests.length,
      baseline_capability_entries: baselineCapabilities.length,
      baseline_test_max: baselineTestMax,
      baseline_capability_max: baselineCapabilityMax,
    },
    tests,
    capabilities: capabilityEntries,
    findings,
    parser_errors: parserErrors,
  };
}

export function summarizeWiringReport(report: WiringReport): string[] {
  const totals = report.totals;
  const lines = [
    `[executable-wiring] verdict=${report.verdict} required_roots=${report.required_roots.join(',')}`,
    `[executable-wiring] tests total=${totals.test_files} required-reachable=${totals.required_reachable} ` +
      `optional-reachable=${totals.optional_reachable} fixture-helper=${totals.fixture_helper} ` +
      `quarantined=${totals.quarantined} unwired=${totals.unwired} (baselined=${totals.unwired_baselined} new=${totals.unwired_new})`,
    `[executable-wiring] capabilities total=${totals.capabilities} wired=${totals.capabilities_wired} ` +
      `orphan=${totals.capabilities_orphan} (baselined=${totals.capabilities_orphan_baselined} new=${totals.capabilities_orphan_new})`,
    `[executable-wiring] baseline tests=${totals.baseline_test_entries}/${totals.baseline_test_max} ` +
      `capabilities=${totals.baseline_capability_entries}/${totals.baseline_capability_max}`,
  ];
  for (const error of report.parser_errors) {
    lines.push(`[TOOL-FAILURE] ${error.subject} - ${error.detail}`);
  }
  for (const finding of report.findings) {
    lines.push(`[${finding.severity.toUpperCase()}] ${finding.code} ${finding.subject} - ${finding.detail}`);
  }
  return lines;
}
