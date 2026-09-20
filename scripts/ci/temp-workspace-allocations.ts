/**
 * UTV2-1949 — per-allocation analysis of temporary-directory creation.
 *
 * This replaces an earlier file-wide token heuristic that asked only whether a
 * cleanup token appeared *anywhere* in the same file. That question is not the
 * question: `scripts/ops/execution-packet.test.ts` allocates roots at lines 164 and
 * 188 with no teardown, and unrelated `fs.rmSync` calls 2,700 lines later made the
 * whole file read as clean. The heuristic reported green while `/tmp` kept growing.
 *
 * The rule enforced here is per allocation, not per file: every `mkdtemp`/`mkdtempSync`
 * call must bind its result to a name, and that name must be referenced by a release
 * call (`releaseTempWorkspace`, `rmSync`, `rm`, `rmdirSync`) somewhere inside the
 * scope that owns the allocation. A directory obtained from `createTempWorkspace()`
 * is governed by construction and is not an allocation at all.
 *
 * Analysis is syntactic (TypeScript AST, no type-checker), so it is fast enough to
 * run inside `pnpm test` and depends on no build output.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/** Names that, when called, release a directory passed to them. */
const RELEASE_CALLEES = new Set(['releaseTempWorkspace', 'rmSync', 'rm', 'rmdirSync', 'removeSync']);

/** Names that allocate a raw temporary directory. */
const ALLOCATOR_CALLEES = new Set(['mkdtemp', 'mkdtempSync']);

/** The governed helper. A call to it is not a raw allocation. */
export const GOVERNED_HELPER = 'createTempWorkspace';

/**
 * `released`  — a release call in the owning scope names this directory.
 * `escapes`   — the directory leaves its scope (returned to a caller), so ownership
 *               transfers and this scope is not the one that must release it.
 * `unreleased` — nothing in the owning scope can ever release it. This is the leak.
 */
export type AllocationVerdict = 'released' | 'escapes' | 'unreleased';

export interface Allocation {
  /** Repo-relative POSIX path. */
  readonly file: string;
  readonly line: number;
  /** The identifier the directory was bound to, or null when it was not bound. */
  readonly binding: string | null;
  readonly verdict: AllocationVerdict;
  /** Why it counts as unreleased, for the failure message. */
  readonly reason: string | null;
}

/** The trailing name of a callee: `fs.mkdtempSync` -> `mkdtempSync`, `rm` -> `rm`. */
function calleeName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

/**
 * The scope that owns an allocation: the nearest enclosing function-like node, or
 * the source file when the allocation is at module top level. A release must appear
 * inside this scope — a cleanup elsewhere in the file cannot reach this binding.
 */
function owningScope(node: ts.Node): ts.Node {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isSourceFile(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return node.getSourceFile();
}

/** Every identifier referenced by a release call anywhere inside `scope`. */
function releasedNames(scope: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (name && RELEASE_CALLEES.has(name)) {
        for (const argument of node.arguments) {
          collectIdentifiers(argument, names);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return names;
}

function collectIdentifiers(node: ts.Node, into: Set<string>): void {
  if (ts.isIdentifier(node)) {
    into.add(node.text);
    return;
  }
  ts.forEachChild(node, (child) => collectIdentifiers(child, into));
}

/**
 * The name that owns an allocation.
 *
 * The allocation is often wrapped before it is bound — `const filePath =
 * path.join(fs.mkdtempSync(...), 'queue.md')` is released by
 * `rmSync(path.dirname(filePath))`, so the owner is `filePath`, not the raw call.
 * The walk therefore climbs out of wrapping expressions to the enclosing
 * declaration or assignment, and stops at a statement boundary so it can never
 * attribute an allocation to something in an unrelated statement.
 */
function bindingName(call: ts.CallExpression): { name: string; assigned: boolean } | null {
  let current: ts.Node | undefined = call.parent;
  while (current) {
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
      return { name: current.name.text, assigned: false };
    }
    if (
      ts.isBinaryExpression(current) &&
      current.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(current.left)
    ) {
      return { name: current.left.text, assigned: true };
    }
    if (ts.isStatement(current) || ts.isPropertyAssignment(current)) return null;
    current = current.parent;
  }
  return null;
}

/**
 * True when the allocation leaves its scope: either the call itself is returned, or
 * the name it was bound to is mentioned inside a `return`. A factory such as
 * `function makeRepo() { const repoRoot = fs.mkdtempSync(...); return { repoRoot }; }`
 * hands ownership to its caller, and demanding a release here would be wrong.
 */
function escapesScope(call: ts.CallExpression, binding: string | null, scope: ts.Node): boolean {
  // `return fs.mkdtempSync(...)` / `() => fs.mkdtempSync(...)`
  let current: ts.Node | undefined = call.parent;
  while (current && current !== scope) {
    if (ts.isReturnStatement(current)) return true;
    if (ts.isArrowFunction(current) && current.body === call) return true;
    current = current.parent;
  }
  if (!binding) return false;

  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isReturnStatement(node)) {
      const names = new Set<string>();
      if (node.expression) collectIdentifiers(node.expression, names);
      if (names.has(binding)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return found;
}

/** Analyse one source file and return every raw temp-directory allocation in it. */
export function analyzeSource(relativePath: string, source: string): Allocation[] {
  const sourceFile = ts.createSourceFile(relativePath, source, ts.ScriptTarget.ES2022, true);
  const allocations: Allocation[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (name && ALLOCATOR_CALLEES.has(name)) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        const bound = bindingName(node);
        const binding = bound?.name ?? null;
        // An assignment writes a name declared in an outer scope — the classic
        // `let dir` + `before`/`after` pair — so the release lives in a sibling
        // scope, not this one. Widen to the file for that form only.
        const scope = bound?.assigned ? sourceFile : owningScope(node);

        if (escapesScope(node, binding, scope)) {
          allocations.push({ file: relativePath, line, binding, verdict: 'escapes', reason: null });
        } else if (!binding) {
          allocations.push({
            file: relativePath,
            line,
            binding: null,
            verdict: 'unreleased',
            reason: 'the result is not bound to a name and does not leave the scope, so nothing can release it',
          });
        } else if (releasedNames(scope).has(binding)) {
          allocations.push({ file: relativePath, line, binding, verdict: 'released', reason: null });
        } else {
          allocations.push({
            file: relativePath,
            line,
            binding,
            verdict: 'unreleased',
            reason: `\`${binding}\` is never passed to a release call in its own scope`,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return allocations;
}

export function analyzeFile(repoRoot: string, absolutePath: string): Allocation[] {
  const relativePath = path.relative(repoRoot, absolutePath).split(path.sep).join('/');
  return analyzeSource(relativePath, fs.readFileSync(absolutePath, 'utf8'));
}

/** Recursively collect `*.test.ts` under `dir`, skipping build and dependency output. */
export function collectTestFiles(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist') continue;
      collectTestFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
}
