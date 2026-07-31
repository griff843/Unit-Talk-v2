/**
 * UTV2-1632 — no workflow may invoke a workspace binary by bare name.
 *
 * ## Why a scanner rather than a review note
 *
 * `.github/workflows/db-health-tripwire.yml` ran `tsx scripts/ops/db-health-tripwire.ts`.
 * `tsx` is a workspace devDependency: pnpm places it in `node_modules/.bin`,
 * which is on PATH inside a `pnpm` script but not inside a raw `run:` block.
 * Every scheduled run exited 127 before Node started, for months, and nobody
 * noticed — because the only signal a monitor emits is red, and red is also
 * what a real finding looks like.
 *
 * The reviewable version of this rule ("remember to use pnpm exec") was already
 * being followed everywhere else in the repository. One file missed it and the
 * consequence was invisible. That is the signature of a rule that belongs in CI
 * rather than in prose (CLAUDE.md invariant 11).
 *
 * ## The rule
 *
 * In any `run:` block, the leading word of a command may not be a binary that
 * exists only because a workspace `package.json` depends on it. Reach those
 * through `pnpm exec`, `pnpm run`, a package script, or an explicit
 * `node_modules/.bin/` path — anything that resolves the workspace bin
 * directory.
 *
 * Binaries installed by a setup action (`supabase` via `supabase/setup-cli`,
 * `psql` via apt, `gh`, `jq`, `docker`, `node`, `pnpm`) are unaffected: they are
 * not workspace dependencies, so they never enter the candidate set. That set is
 * derived from the repository's own manifests rather than hardcoded, so adding a
 * dependency extends the guard automatically.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Packages whose executable name differs from the package name, or which ship
 * no executable at all. Anything absent from this map is assumed to publish a
 * bin matching its own unscoped name, which holds for `tsx`, `eslint`,
 * `prettier`, `playwright` and the rest of this repository's tooling.
 */
export const PACKAGE_BIN_ALIASES: Readonly<Record<string, readonly string[]>> = {
  typescript: ['tsc', 'tsserver'],
  'typescript-eslint': [],
  globals: [],
  micromatch: [],
  yaml: [],
  postgres: [],
};

/**
 * Shell words that may legitimately precede a command without being the command
 * themselves. Stripped before the leading word is identified.
 */
const LEADING_NOISE = new Set([
  '!',
  'sudo',
  'command',
  'exec',
  'env',
  'time',
  'nohup',
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'do',
  'done',
  'while',
  'until',
  'for',
  'case',
  'esac',
  'set',
  '{',
  '}',
  '(',
  ')',
]);

export interface Violation {
  file: string;
  job: string;
  step: string;
  binary: string;
  command: string;
}

function listYamlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listYamlFiles(full));
      continue;
    }
    if (entry.endsWith('.yml') || entry.endsWith('.yaml')) out.push(full);
  }
  return out.sort();
}

function listPackageManifests(root: string): string[] {
  const manifests: string[] = [];
  const rootManifest = path.join(root, 'package.json');
  if (existsSync(rootManifest)) manifests.push(rootManifest);
  for (const group of ['packages', 'apps']) {
    const groupDir = path.join(root, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir)) {
      const manifest = path.join(groupDir, entry, 'package.json');
      if (existsSync(manifest)) manifests.push(manifest);
    }
  }
  return manifests;
}

/**
 * Every binary name that resolves only through the workspace's `node_modules`.
 * Derived from the manifests so the guard cannot drift away from what is
 * actually installed.
 */
export function collectWorkspaceBinaries(root: string = REPO_ROOT): Set<string> {
  const binaries = new Set<string>();
  for (const manifest of listPackageManifests(root)) {
    const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>;
    for (const field of ['dependencies', 'devDependencies'] as const) {
      const deps = pkg[field];
      if (!deps || typeof deps !== 'object') continue;
      for (const name of Object.keys(deps as Record<string, string>)) {
        if (name.startsWith('@unit-talk/')) continue;
        const aliases = PACKAGE_BIN_ALIASES[name];
        if (aliases) {
          for (const alias of aliases) binaries.add(alias);
          continue;
        }
        // A scoped package's bin name is not derivable from its name. Skipping
        // is the safe direction: a false positive here would block unrelated
        // work, and the unscoped names cover every tool this repo shells out to.
        if (name.startsWith('@')) continue;
        binaries.add(name);
      }
    }
  }
  return binaries;
}

/**
 * The leading word of every command in a shell script, with line continuations,
 * operators, pipelines and shell keywords removed.
 */
export function leadingCommandWords(script: string): string[] {
  const flattened = script
    .replace(/\\\r?\n/g, ' ')
    // Command substitution introduces a *new* command, so its contents must be
    // scanned as one rather than being swallowed by the assignment in front of
    // it: `NAME=$(pnpm exec tsx …)` is an invocation of `pnpm`, not of `tsx`.
    // Splitting on the delimiters turns the inner command into its own segment,
    // which keeps a genuinely bare `$(tsx …)` detectable.
    .replace(/\$\(|[`)]/g, '\n');
  const segments = flattened
    .split(/\r?\n|&&|\|\||[;|]/g)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && !segment.startsWith('#'));

  const words: string[] = [];
  for (const segment of segments) {
    for (const token of segment.split(/\s+/)) {
      // `FOO=bar cmd` — a leading assignment is not the command.
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
      if (LEADING_NOISE.has(token)) continue;
      const cleaned = token.replace(/^['"]+|['"]+$/g, '');
      if (!cleaned) continue;
      words.push(cleaned);
      break;
    }
  }
  return words;
}

interface StepLike {
  name?: unknown;
  run?: unknown;
}

function stepsOf(value: unknown): StepLike[] {
  return Array.isArray(value)
    ? (value.filter((step) => step && typeof step === 'object') as StepLike[])
    : [];
}

export function scanDocument(
  relativePath: string,
  text: string,
  binaries: ReadonlySet<string>,
): Violation[] {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch {
    // Unparseable YAML is another gate's problem; this one has nothing to say.
    return [];
  }
  if (!doc || typeof doc !== 'object') return [];

  const violations: Violation[] = [];
  const inspect = (jobName: string, steps: StepLike[]): void => {
    for (const [index, step] of steps.entries()) {
      if (typeof step.run !== 'string') continue;
      const stepName = typeof step.name === 'string' ? step.name : `step[${index}]`;
      for (const word of leadingCommandWords(step.run)) {
        if (!binaries.has(word)) continue;
        violations.push({
          file: relativePath,
          job: jobName,
          step: stepName,
          binary: word,
          command: step.run.trim().split(/\r?\n/)[0] ?? '',
        });
      }
    }
  };

  const record = doc as Record<string, unknown>;

  // Workflow file: jobs.<id>.steps
  const jobs = record['jobs'];
  if (jobs && typeof jobs === 'object') {
    for (const [jobName, job] of Object.entries(jobs as Record<string, unknown>)) {
      if (!job || typeof job !== 'object') continue;
      inspect(jobName, stepsOf((job as Record<string, unknown>)['steps']));
    }
  }

  // Composite action: runs.steps
  const runs = record['runs'];
  if (runs && typeof runs === 'object') {
    inspect('<composite action>', stepsOf((runs as Record<string, unknown>)['steps']));
  }

  return violations;
}

export function runGuard(root: string = REPO_ROOT): Violation[] {
  const binaries = collectWorkspaceBinaries(root);
  const files = [
    ...listYamlFiles(path.join(root, '.github', 'workflows')),
    ...listYamlFiles(path.join(root, '.github', 'actions')),
  ];
  const violations: Violation[] = [];
  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    violations.push(...scanDocument(relative, readFileSync(file, 'utf8'), binaries));
  }
  return violations;
}

export function formatViolations(violations: readonly Violation[]): string {
  return violations
    .map(
      (v) =>
        `  ${v.file} → job "${v.job}" → step "${v.step}"\n` +
        `    invokes workspace binary \`${v.binary}\` by bare name: ${v.command}\n` +
        '    fix: prefix with `pnpm exec`, or call it through a package script.',
    )
    .join('\n\n');
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  const violations = runGuard();
  if (violations.length === 0) {
    console.log(
      '[workflow-bare-binary-guard] PASS — no workflow invokes a workspace binary by bare name',
    );
  } else {
    console.error(
      `[workflow-bare-binary-guard] FAIL — ${violations.length} bare workspace-binary invocation(s):\n`,
    );
    console.error(formatViolations(violations));
    process.exitCode = 1;
  }
}
