/**
 * UTV2-1628 — one enforced boundary for every privileged database client.
 *
 * ## What this guards, and why grep could not
 *
 * UTV2-1630 closed the *workflow* surface: `pnpm ci:assert-staging` became a
 * prerequisite of the writable npm scripts, and production credentials left every
 * PR-triggered workflow. What it did not close is the ~80 modules that call
 * `createClient(...)` from `@supabase/supabase-js` themselves. Those construct a
 * service-role client straight from `process.env` and never pass any gate.
 *
 * UTV2-1627's first attempt at a guard here was a string search. It reported
 * "enforced" because the string it looked for existed — inside code nothing
 * called. A control satisfied by a substring in dead code is not a control.
 *
 * So this guard does two mechanically different things, neither of which a
 * comment or an unreferenced literal can satisfy:
 *
 *  1. **AST inventory.** Every module is parsed. Import bindings are resolved to
 *     their module specifier, and only calls whose callee resolves to a binding
 *     imported from a database driver count. A file that merely mentions
 *     `createClient` in a regex, a docstring or a string literal produces no
 *     site — and a file that imports it under an alias (`createClient as mk`)
 *     produces one anyway. Every site must be classified in
 *     `privileged-db-client-inventory.json`; an unclassified site fails.
 *
 *  2. **Reachability from `pnpm test`.** The `test` npm script is expanded into
 *     its real entrypoint files, and the static import graph is walked from
 *     them. Any raw driver construction reachable from that graph fails,
 *     regardless of how it is classified. This is the check that speaks to the
 *     actual invariant — no path from `pnpm test` constructs a privileged client
 *     — rather than to the presence of text.
 *
 * The boundary itself (`packages/db/src/privileged-client-boundary.ts`) is the
 * single module permitted to call a driver constructor directly. It asserts
 * target identity, using UTV2-1630's `extractProjectRefFromUrl` /
 * `isApprovedStagingTarget`, before returning a client.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import ts from 'typescript';

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

export const INVENTORY_PATH = path.join(
  REPO_ROOT,
  'scripts',
  'ci',
  'privileged-db-client-inventory.json',
);

/**
 * The single module allowed to call a driver constructor directly.
 * Everything else must obtain its client from it.
 */
export const BOUNDARY_MODULE = 'packages/db/src/privileged-client-boundary.ts';

/** Modules that hand out a raw database connection. */
const DRIVER_MODULES = new Map<string, string>([
  ['@supabase/supabase-js', 'supabase'],
  ['pg', 'pg'],
  ['postgres', 'postgres'],
]);

/** Exported names from those modules that produce a connection. */
const DRIVER_FACTORIES = new Set(['createClient', 'Client', 'Pool', 'default']);

const SCAN_ROOTS = ['scripts', 'apps', 'packages'];
const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
  'out',
  'playwright-report',
  'test-results',
]);

/** What the call site IS. Answers "how dangerous is this connection?". */
export type Classification =
  | 'writable-privileged'
  | 'read-only'
  | 'behind-the-boundary'
  | 'dead';

/**
 * What was DONE about it, and therefore what this guard re-checks every run.
 *
 * Each value carries a mechanically falsifiable obligation. A classification on
 * its own would be a self-declared label — the exact shape of control that
 * UTV2-1627 shipped and that turned out to enforce nothing.
 */
export type Disposition =
  /** This file IS the boundary. Only one file may claim it. */
  | 'is-boundary'
  /** Obtains its client from the boundary: zero raw sites, boundary reachable. */
  | 'migrated'
  /** Still constructs directly, but each site asserts through the boundary first. */
  | 'asserted-in-place'
  /** Anon-key only: no service-role credential appears anywhere in the file. */
  | 'unprivileged-direct'
  /**
   * Still unmigrated because another open lane owns the file.
   *
   * This is the one disposition that admits an un-boundaried privileged
   * constructor, and it buys nothing except time: rule 3 still applies to it
   * unconditionally, so the moment the file becomes reachable from `pnpm test`
   * the guard fails regardless of the deferral. It requires a named owning
   * issue, so the debt has an addressee rather than becoming an exemption.
   */
  | 'deferred-cross-lane';

export interface ConstructorSite {
  /** Repo-relative POSIX path. */
  file: string;
  line: number;
  /** The local identifier actually called at this site. */
  callee: string;
  /** The module the binding was imported from. */
  module: string;
  driver: string;
}

export interface InventoryEntry {
  file: string;
  classification: Classification;
  disposition: Disposition;
  reason: string;
  /** Direct construction sites this file had before UTV2-1628. */
  sites_before?: number;
  /**
   * Whether anything references this file — no npm script, no workflow, no
   * import. Recorded, not enforced: dead code still gets migrated, because
   * "nothing calls it today" is not a property that stays true.
   */
  referenced?: boolean;
  /**
   * Whether the file could reach a service-role credential before migration.
   * Recorded alongside `classification` because `dead` would otherwise hide it.
   */
  privileged?: boolean;
  /** Required by `deferred-cross-lane`: the issue that owns the file. */
  owner_issue?: string;
}

export interface Inventory {
  schema: string;
  boundary_module: string;
  generated_from_sha?: string;
  entries: InventoryEntry[];
}

export interface GuardFinding {
  kind:
    | 'unclassified'
    | 'raw-in-migrated'
    | 'boundary-not-reachable'
    | 'unasserted-site'
    | 'privileged-in-read-only'
    | 'no-site-for-direct-entry'
    | 'boundary-claim-conflict'
    | 'deferral-without-owner'
    | 'reachable-from-test';
  file: string;
  detail: string;
}

export interface GuardResult {
  ok: boolean;
  sites: ConstructorSite[];
  reachableFromTest: string[];
  findings: GuardFinding[];
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

// ---------------------------------------------------------------------------
// AST layer
// ---------------------------------------------------------------------------

function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind(fileName));
}

function scriptKind(fileName: string): ts.ScriptKind {
  if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (fileName.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.(js|mjs|cjs)$/u.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

interface Binding {
  module: string;
  driver: string;
  /** true when the binding is a namespace import (`import * as pg from 'pg'`). */
  namespace: boolean;
}

/**
 * Collect local names bound to a database driver.
 *
 * Resolution is by module specifier, not by name. `import { createClient } from
 * './my-helpers.js'` yields nothing; `import { createClient as build } from
 * '@supabase/supabase-js'` yields `build`. That asymmetry is the whole point:
 * the guard follows what the identifier IS, not what it is spelled.
 */
function collectDriverBindings(source: ts.SourceFile): Map<string, Binding> {
  const bindings = new Map<string, Binding>();

  const record = (local: string, module: string, driver: string, ns: boolean): void => {
    bindings.set(local, { module, driver, namespace: ns });
  };

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const driver = DRIVER_MODULES.get(specifier);
    if (!driver) continue;
    const clause = statement.importClause;
    if (!clause) continue;
    // `import type { ... }` never constructs anything.
    if (clause.isTypeOnly) continue;

    if (clause.name) record(clause.name.text, specifier, driver, false);

    const named = clause.namedBindings;
    if (!named) continue;
    if (ts.isNamespaceImport(named)) {
      record(named.name.text, specifier, driver, true);
      continue;
    }
    for (const element of named.elements) {
      if (element.isTypeOnly) continue;
      const imported = element.propertyName?.text ?? element.name.text;
      if (!DRIVER_FACTORIES.has(imported)) continue;
      record(element.name.text, specifier, driver, false);
    }
  }

  return bindings;
}

export function findConstructorSites(
  relativeFile: string,
  text: string,
): ConstructorSite[] {
  const source = parse(relativeFile, text);
  const bindings = collectDriverBindings(source);
  if (bindings.size === 0) return [];

  const sites: ConstructorSite[] = [];

  const resolveCallee = (expression: ts.Expression): { name: string; binding: Binding } | null => {
    if (ts.isIdentifier(expression)) {
      const binding = bindings.get(expression.text);
      return binding && !binding.namespace ? { name: expression.text, binding } : null;
    }
    if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
      const binding = bindings.get(expression.expression.text);
      if (!binding || !binding.namespace) return null;
      if (!DRIVER_FACTORIES.has(expression.name.text)) return null;
      return { name: `${expression.expression.text}.${expression.name.text}`, binding };
    }
    return null;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const resolved = resolveCallee(node.expression);
      if (resolved) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        sites.push({
          file: relativeFile,
          line: line + 1,
          callee: resolved.name,
          module: resolved.binding.module,
          driver: resolved.binding.driver,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return sites;
}

// ---------------------------------------------------------------------------
// Tree walk
// ---------------------------------------------------------------------------

export function listSourceFiles(root: string = REPO_ROOT): string[] {
  const found: string[] = [];
  const walk = (absolute: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(absolute);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRECTORIES.has(entry)) continue;
      const child = path.join(absolute, entry);
      let stat;
      try {
        stat = statSync(child);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(child);
        continue;
      }
      if (!SCAN_EXTENSIONS.has(path.extname(entry))) continue;
      if (entry.endsWith('.d.ts')) continue;
      found.push(toPosix(path.relative(root, child)));
    }
  };
  for (const scanRoot of SCAN_ROOTS) {
    const absolute = path.join(root, scanRoot);
    if (existsSync(absolute)) walk(absolute);
  }
  return found.sort();
}

export function scanTree(root: string = REPO_ROOT): ConstructorSite[] {
  const sites: ConstructorSite[] = [];
  for (const relative of listSourceFiles(root)) {
    let text: string;
    try {
      text = readFileSync(path.join(root, relative), 'utf8');
    } catch {
      continue;
    }
    // Cheap pre-filter, purely for speed. Correctness still comes from the AST:
    // a file containing the substring but no driver import yields no site.
    if (!/@supabase\/supabase-js|from ['"]pg['"]|from ['"]postgres['"]/u.test(text)) continue;
    sites.push(...findConstructorSites(relative, text));
  }
  return sites;
}

// ---------------------------------------------------------------------------
// Reachability from `pnpm test`
// ---------------------------------------------------------------------------

/**
 * Expand the `test` npm script into the files it actually runs.
 *
 * The script is a chain of `pnpm test:*` delegations ending in
 * `tsx --test <files>`. Reading package.json means the entrypoint set follows
 * the suite automatically: adding a test script cannot quietly escape the walk.
 */
export function collectTestEntrypoints(root: string = REPO_ROOT): string[] {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const scripts = pkg.scripts;
  const entrypoints = new Set<string>();
  const seenScripts = new Set<string>();

  const expand = (name: string): void => {
    if (seenScripts.has(name)) return;
    seenScripts.add(name);
    const body = scripts[name];
    if (!body) return;
    for (const segment of body.split('&&')) {
      const command = segment.trim();
      if (!command) continue;
      const delegated = /^pnpm\s+(?:run\s+)?([\w:.-]+)$/u.exec(command);
      if (delegated?.[1]) {
        expand(delegated[1]);
        continue;
      }
      const filtered = /^pnpm\s+--filter\s+(\S+)\s+([\w:.-]+)$/u.exec(command);
      if (filtered?.[1] && filtered[2]) {
        expandWorkspace(filtered[1], filtered[2]);
        continue;
      }
      collectFileArguments(command, root, '.', entrypoints);
    }
  };

  const expandWorkspace = (pkgName: string, script: string): void => {
    const dir = workspaceDirectory(pkgName, root);
    if (!dir) return;
    const manifestPath = path.join(root, dir, 'package.json');
    if (!existsSync(manifestPath)) return;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const body = manifest.scripts?.[script];
    if (!body) return;
    for (const segment of body.split('&&')) {
      collectFileArguments(segment.trim(), root, dir, entrypoints);
    }
  };

  expand('test');
  return [...entrypoints].sort();
}

function workspaceDirectory(pkgName: string, root: string): string | null {
  for (const base of ['apps', 'packages']) {
    const baseDir = path.join(root, base);
    if (!existsSync(baseDir)) continue;
    for (const entry of readdirSync(baseDir)) {
      const manifestPath = path.join(baseDir, entry, 'package.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string };
      if (manifest.name === pkgName) return `${base}/${entry}`;
    }
  }
  return null;
}

/**
 * Pull file/glob arguments out of a `tsx --test ...` invocation.
 *
 * Globs are expanded against the filesystem rather than shelled out, so the
 * walk does not depend on the shell that happens to run CI.
 */
function collectFileArguments(
  command: string,
  root: string,
  cwd: string,
  into: Set<string>,
): void {
  if (!/(^|\s)tsx\s/u.test(command)) return;
  for (const token of command.split(/\s+/u)) {
    if (token.startsWith('-') || token === 'tsx' || token === 'pnpm') continue;
    if (!/\.(m?[jt]sx?)$/u.test(token)) continue;
    const relative = toPosix(path.normalize(path.join(cwd, token)));
    if (relative.includes('*')) {
      for (const match of expandGlob(relative, root)) into.add(match);
      continue;
    }
    if (existsSync(path.join(root, relative))) into.add(relative);
  }
}

function expandGlob(pattern: string, root: string): string[] {
  const PLACEHOLDER = '\u0001';
  const escaped = pattern
    .split('/')
    .map((segment) =>
      segment
        .replace(/[.+^${}()|[\]\\]/gu, '\\$&')
        .replace(/\*\*/gu, PLACEHOLDER)
        .replace(/\*/gu, '[^/]*')
        .replace(new RegExp(PLACEHOLDER, 'gu'), '.*'),
    )
    .join('/');
  const regex = new RegExp(`^${escaped}$`, 'u');
  return listAllFiles(root).filter((file) => regex.test(file));
}

let allFilesCache: string[] | null = null;
function listAllFiles(root: string): string[] {
  if (allFilesCache) return allFilesCache;
  allFilesCache = listSourceFiles(root);
  return allFilesCache;
}

/**
 * Walk the static import graph from a set of entrypoints.
 *
 * Only static `import`/`export ... from` edges are followed. Dynamic
 * `import(expr)` with a computed specifier is unresolvable by construction; the
 * inventory rule covers what the graph walk cannot see.
 */
export function reachableModules(
  entrypoints: string[],
  root: string = REPO_ROOT,
): Set<string> {
  const seen = new Set<string>();
  const queue = [...entrypoints];

  while (queue.length > 0) {
    const current = queue.pop() as string;
    if (seen.has(current)) continue;
    seen.add(current);

    let text: string;
    try {
      text = readFileSync(path.join(root, current), 'utf8');
    } catch {
      continue;
    }
    for (const specifier of importSpecifiers(current, text)) {
      const resolved = resolveSpecifier(specifier, current, root);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return seen;
}

function importSpecifiers(fileName: string, text: string): string[] {
  const source = parse(fileName, text);
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) {
        // A type-only import cannot construct anything at runtime.
      } else {
        specifiers.push(node.moduleSpecifier.text);
      }
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push((node.arguments[0] as ts.StringLiteral).text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

const WORKSPACE_ENTRY_CACHE = new Map<string, string | null>();

function resolveSpecifier(
  specifier: string,
  fromFile: string,
  root: string,
): string | null {
  if (specifier.startsWith('.')) {
    const base = toPosix(path.normalize(path.join(path.dirname(fromFile), specifier)));
    return resolveFileCandidates(rewriteDistToSource(base), root);
  }
  if (specifier.startsWith('@unit-talk/')) {
    let cached = WORKSPACE_ENTRY_CACHE.get(specifier);
    if (cached === undefined) {
      // Honour the package's `exports` subpaths (`@unit-talk/db/target-identity`),
      // then fall back to the barrel.
      const [, scopeName, subpath] = /^(@unit-talk\/[^/]+)(?:\/(.+))?$/u.exec(specifier) ?? [];
      const dir = scopeName ? workspaceDirectory(scopeName, root) : null;
      cached = dir
        ? resolveFileCandidates(subpath ? `${dir}/src/${subpath}` : `${dir}/src/index`, root)
        : null;
      WORKSPACE_ENTRY_CACHE.set(specifier, cached);
    }
    return cached;
  }
  // Third-party packages are out of scope: the boundary governs OUR construction
  // of a client, and a dependency cannot read this repo's environment for us.
  return null;
}

/**
 * `packages/<pkg>/dist/x.js` describes the same module as
 * `packages/<pkg>/src/x.ts`.
 *
 * `apps/command-center` imports the built output rather than the workspace
 * source, because Next's bundler does not transpile TypeScript out of the
 * workspace packages. Following the edge to `dist` would walk emitted files that
 * this guard deliberately does not scan, so the graph would silently stop at the
 * package edge and report a Command Center path as clean. Rewriting to `src`
 * keeps the walk on the code that is actually reviewed.
 */
function rewriteDistToSource(relative: string): string {
  const match = /^((?:packages|apps)\/[^/]+)\/dist\/(.+)$/u.exec(relative);
  if (!match?.[1] || !match[2]) return relative;
  return `${match[1]}/src/${match[2]}`;
}

function resolveFileCandidates(base: string, root: string): string | null {
  // `.js` in TypeScript ESM source resolves to the `.ts` sibling.
  const withoutExt = base.replace(/\.(m?js)$/u, '');
  const candidates = [
    base,
    `${withoutExt}.ts`,
    `${withoutExt}.tsx`,
    `${withoutExt}.mts`,
    `${withoutExt}.mjs`,
    `${withoutExt}.js`,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
  ];
  for (const candidate of candidates) {
    const absolute = path.join(root, candidate);
    if (existsSync(absolute) && statSync(absolute).isFile()) return toPosix(candidate);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

export function loadInventory(inventoryPath: string = INVENTORY_PATH): Inventory {
  return JSON.parse(readFileSync(inventoryPath, 'utf8')) as Inventory;
}

export interface AssertionUse {
  /** true when every raw site in the file passes its target through the boundary. */
  everySiteAsserted: boolean;
}

/**
 * Does every raw construction site in this file hand its target to a boundary
 * assertion first?
 *
 * The assertion must be an argument of the construction call itself
 * (`postgres(assertPostgresConnectionAllowed(url, ...), ...)`), not merely
 * present somewhere in the file. A call earlier in the module, or in a branch
 * that is not taken, would satisfy a proximity check while asserting nothing —
 * which is the failure mode this guard exists to avoid.
 */
export function everySiteAsserted(relativeFile: string, text: string): boolean {
  const source = parse(relativeFile, text);
  const assertionNames = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!/privileged-client-boundary|@unit-talk\/db$/u.test(statement.moduleSpecifier.text)) {
      continue;
    }
    const named = statement.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const element of named.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (imported.startsWith('assert')) assertionNames.add(element.name.text);
    }
  }
  if (assertionNames.size === 0) return false;

  const bindings = collectDriverBindings(source);
  if (bindings.size === 0) return true;

  let allAsserted = true;
  const visit = (node: ts.Node): void => {
    if (
      (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
      ts.isIdentifier(node.expression) &&
      bindings.has(node.expression.text)
    ) {
      const asserted = (node.arguments ?? []).some(
        (argument) =>
          ts.isCallExpression(argument) &&
          ts.isIdentifier(argument.expression) &&
          assertionNames.has(argument.expression.text),
      );
      if (!asserted) allAsserted = false;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return allAsserted;
}

/**
 * Names that only appear when a module can reach a service-role credential.
 *
 * Matched as identifiers, property names and string literals via the AST, so a
 * mention inside a comment or an unrelated word does not count.
 */
const PRIVILEGED_CREDENTIAL_NAMES = new Set([
  'SUPABASE_SERVICE_ROLE_KEY',
  'CI_SUPABASE_SERVICE_ROLE_KEY',
  'V1_SUPABASE_SERVICE_ROLE_KEY',
  'serviceRoleKey',
  'service_role',
  'SUPABASE_DB_URL',
  'DATABASE_URL',
  // Not a credential name, but the only thing these callers ever say: they take
  // the connection from @unit-talk/db and never name the key. Classifying them
  // read-only on the absence of a literal credential name was wrong; two files
  // were mis-bucketed that way before this was added.
  'createServiceRoleDatabaseConnectionConfig',
]);

export function referencesPrivilegedCredential(
  relativeFile: string,
  text: string,
): string | null {
  const source = parse(relativeFile, text);
  let found: string | null = null;
  const check = (name: string): void => {
    if (!found && PRIVILEGED_CREDENTIAL_NAMES.has(name)) found = name;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) check(node.text);
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) check(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

export function runGuard(options: { root?: string; inventory: Inventory }): GuardResult {
  const root = options.root ?? REPO_ROOT;
  allFilesCache = null;
  WORKSPACE_ENTRY_CACHE.clear();

  const boundary = options.inventory.boundary_module;
  const sites = scanTree(root);
  const findings: GuardFinding[] = [];

  const entries = new Map<string, InventoryEntry>();
  for (const entry of options.inventory.entries) entries.set(entry.file, entry);

  const sitesByFile = new Map<string, ConstructorSite[]>();
  for (const site of sites) {
    const bucket = sitesByFile.get(site.file) ?? [];
    bucket.push(site);
    sitesByFile.set(site.file, bucket);
  }

  const read = (file: string): string => {
    try {
      return readFileSync(path.join(root, file), 'utf8');
    } catch {
      return '';
    }
  };

  // 1. Every file that constructs directly must be classified. This is the
  //    "a new unclassified constructor fails CI" rule.
  const inventoryRelative = toPosix(path.relative(root, INVENTORY_PATH));
  for (const [file, fileSites] of [...sitesByFile].sort(([a], [b]) => a.localeCompare(b))) {
    if (entries.has(file)) continue;
    const detail = fileSites
      .map((site) => `${site.callee}() at line ${site.line} from '${site.module}'`)
      .join('; ');
    findings.push({
      kind: 'unclassified',
      file,
      detail:
        `constructs a database client directly (${detail}) but is absent from ` +
        `${inventoryRelative}. Route it through ${boundary}, or add a classified ` +
        'entry there — with a disposition this guard can verify.',
    });
  }

  // 2. Each entry's disposition carries an obligation. Re-check all of them.
  let boundaryClaims = 0;
  for (const entry of options.inventory.entries) {
    const fileSites = sitesByFile.get(entry.file) ?? [];

    switch (entry.disposition) {
      case 'is-boundary': {
        boundaryClaims += 1;
        if (entry.file !== boundary) {
          findings.push({
            kind: 'boundary-claim-conflict',
            file: entry.file,
            detail: `claims to be the boundary, but the boundary is ${boundary}.`,
          });
        }
        break;
      }

      case 'migrated': {
        if (fileSites.length > 0) {
          findings.push({
            kind: 'raw-in-migrated',
            file: entry.file,
            detail:
              `is recorded as migrated but constructs a client directly again at line(s) ` +
              `${fileSites.map((s) => s.line).join(', ')}. Migration was reverted.`,
          });
          break;
        }
        // A migrated file must still be able to REACH the boundary. Deleting the
        // import while deleting the call site would otherwise look like success.
        if (!reachableModules([entry.file], root).has(boundary)) {
          findings.push({
            kind: 'boundary-not-reachable',
            file: entry.file,
            detail:
              `is recorded as migrated but ${boundary} is not reachable from it ` +
              'through the import graph, so it no longer obtains its client from the boundary.',
          });
        }
        break;
      }

      case 'asserted-in-place': {
        if (fileSites.length === 0) {
          findings.push({
            kind: 'no-site-for-direct-entry',
            file: entry.file,
            detail:
              'is recorded as asserting in place but constructs nothing directly any more. ' +
              'Re-classify it as migrated or drop the entry.',
          });
          break;
        }
        if (!everySiteAsserted(entry.file, read(entry.file))) {
          findings.push({
            kind: 'unasserted-site',
            file: entry.file,
            detail:
              'constructs a connection whose target is not passed through a boundary ' +
              'assertion. Wrap the connection string in assertPostgresConnectionAllowed().',
          });
        }
        break;
      }

      case 'deferred-cross-lane': {
        if (!entry.owner_issue) {
          findings.push({
            kind: 'deferral-without-owner',
            file: entry.file,
            detail:
              'defers migration without naming the issue that owns the file. A ' +
              'deferral without an addressee is an exemption.',
          });
        }
        if (fileSites.length === 0) {
          findings.push({
            kind: 'no-site-for-direct-entry',
            file: entry.file,
            detail:
              'is recorded as deferred but no longer constructs directly. The other ' +
              'lane landed; re-classify it as migrated.',
          });
        }
        break;
      }

      case 'unprivileged-direct': {
        if (fileSites.length === 0) {
          findings.push({
            kind: 'no-site-for-direct-entry',
            file: entry.file,
            detail:
              'is recorded as constructing an unprivileged client directly, but constructs ' +
              'nothing. Drop the entry.',
          });
          break;
        }
        const credential = referencesPrivilegedCredential(entry.file, read(entry.file));
        if (credential) {
          findings.push({
            kind: 'privileged-in-read-only',
            file: entry.file,
            detail:
              `is classified ${entry.classification} / unprivileged-direct but references ` +
              `${credential}. The exemption rested on it having no privileged credential.`,
          });
        }
        break;
      }
    }
  }

  if (boundaryClaims !== 1) {
    findings.push({
      kind: 'boundary-claim-conflict',
      file: boundary,
      detail: `${boundaryClaims} file(s) claim disposition is-boundary; exactly one must.`,
    });
  }

  // 3. The invariant itself: nothing reachable from a `pnpm test` entrypoint may
  //    construct a client directly, whatever the inventory says. The boundary is
  //    the sole exemption, and it is the module that performs the check.
  const reachable = reachableModules(collectTestEntrypoints(root), root);
  const reachableFromTest: string[] = [];
  for (const file of [...sitesByFile.keys()].sort()) {
    if (file === boundary) continue;
    if (!reachable.has(file)) continue;
    reachableFromTest.push(file);
    findings.push({
      kind: 'reachable-from-test',
      file,
      detail:
        'is reachable from a `pnpm test` entrypoint through the static import graph and ' +
        'constructs a database client directly: a path from the test suite to an ' +
        'unguarded privileged client.',
    });
  }

  return { ok: findings.length === 0, sites, reachableFromTest, findings };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function emitInventoryDraft(root: string): void {
  const sites = scanTree(root);
  const byFile = new Map<string, number>();
  for (const site of sites) byFile.set(site.file, (byFile.get(site.file) ?? 0) + 1);
  const draft: Inventory = {
    schema: 'privileged-db-client-inventory/v1',
    boundary_module: BOUNDARY_MODULE,
    entries: [...byFile.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([file, count]) => ({
        file,
        classification: 'writable-privileged' as Classification,
        reason: 'TODO: classify',
        sites: count,
      })),
  };
  console.log(JSON.stringify(draft, null, 2));
}

function main(): void {
  const argv = process.argv.slice(2);
  const root = REPO_ROOT;

  if (argv.includes('--draft')) {
    emitInventoryDraft(root);
    return;
  }
  if (argv.includes('--list-sites')) {
    for (const site of scanTree(root)) {
      console.log(`${site.file}:${site.line}\t${site.callee}\t${site.module}`);
    }
    return;
  }
  if (argv.includes('--list-test-entrypoints')) {
    for (const file of collectTestEntrypoints(root)) console.log(file);
    return;
  }

  const result = runGuard({ root, inventory: loadInventory() });
  console.log(
    `[db-client-boundary] ${result.sites.length} direct driver construction site(s) ` +
      `across ${new Set(result.sites.map((s) => s.file)).size} file(s)`,
  );
  if (result.ok) {
    console.log('[db-client-boundary] OK: every site is classified and none is reachable from `pnpm test`');
    return;
  }
  for (const finding of result.findings) {
    console.error(`[db-client-boundary] ${finding.kind}: ${finding.file} ${finding.detail}`);
  }
  console.error(`[db-client-boundary] FAILED with ${result.findings.length} finding(s)`);
  process.exit(1);
}

/** Real-path comparison, for the reason documented in assert-staging-target.ts. */
function isCliEntrypoint(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return realpathSync(invoked) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isCliEntrypoint()) {
  main();
}
