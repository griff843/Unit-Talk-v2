/**
 * `pnpm ops:classify-diff` — what merge authority does this diff carry?
 *
 * A thin, honest CLI over scripts/ops/merge-authority.cjs. It exists because
 * the classifier is a CommonJS module with no entry point: running
 * `node scripts/ops/merge-authority.cjs --base ... --head ...` exits 0 and
 * prints nothing, so an operator following a checklist could believe the risk
 * check passed without ever learning whether the diff was `auto` or `human`.
 *
 * This is a PREVIEW, not the gate. The blocking decision is made by
 * .github/workflows/merge-gate.yml from the PR's base checkout against
 * GitHub's own changed-file list. This command runs the same classifier over a
 * local git range so the answer is known before the PR is opened. The two can
 * differ in exactly one direction that matters: a local range that has drifted
 * from the real merge base will classify a different set of files. `--base`
 * defaults to `origin/main` and the range is a three-dot diff for that reason.
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require_ = createRequire(import.meta.url);

export type ChangedFile = {
  filename: string;
  previous_filename?: string;
  patch?: string;
  status: string;
};

export type Classification = {
  authority: 'auto' | 'human';
  reasons: string[];
  surfaces: string[];
};

const STATUS_BY_CODE: Record<string, string> = {
  A: 'added',
  C: 'copied',
  D: 'removed',
  M: 'modified',
  R: 'renamed',
  T: 'modified',
};

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
}

/**
 * Parses `git diff --name-status -z`.
 *
 * NUL-delimited because a rename emits THREE fields (status, old path, new
 * path) and a path may contain anything but NUL. Parsing the newline form here
 * would lose renames, which is the specific hole the classifier was just fixed
 * for — reading them back wrong at the CLI would reintroduce it one layer up.
 */
export function parseNameStatus(raw: string): ChangedFile[] {
  const fields = raw.split('\0').filter((f) => f !== '');
  const files: ChangedFile[] = [];
  for (let i = 0; i < fields.length; ) {
    const code = fields[i]!;
    const letter = code[0]!;
    i += 1;
    if (letter === 'R' || letter === 'C') {
      const from = fields[i++];
      const to = fields[i++];
      if (from === undefined || to === undefined) break;
      files.push({ filename: to, previous_filename: from, status: STATUS_BY_CODE[letter] ?? 'modified' });
    } else {
      const name = fields[i++];
      if (name === undefined) break;
      files.push({ filename: name, status: STATUS_BY_CODE[letter] ?? 'modified' });
    }
  }
  return files;
}

/**
 * Attaches the unified diff for each file.
 *
 * Content rules (destructive SQL) read added lines, and the classifier treats a
 * MISSING patch as unclassifiable and reserves. Handing it files with no patch
 * would therefore report `human` for every diff — technically fail-closed, and
 * useless as a preview.
 */
export function attachPatches(files: ChangedFile[], base: string, head: string, cwd: string): ChangedFile[] {
  return files.map((file) => {
    if (file.status === 'removed') return file;
    try {
      const patch = git(
        ['diff', '--no-color', `${base}...${head}`, '--', file.previous_filename ?? file.filename, file.filename],
        cwd,
      );
      return { ...file, patch };
    } catch {
      // Leave the patch absent. The classifier reserves on absence, which is
      // the correct outcome for a file we could not read.
      return file;
    }
  });
}

export function collectChangedFiles(base: string, head: string, cwd: string): ChangedFile[] {
  const raw = git(['diff', '--name-status', '-z', `${base}...${head}`], cwd);
  return attachPatches(parseNameStatus(raw), base, head, cwd);
}

/**
 * Reads each changed `package.json` at both refs.
 *
 * The manifest rules compare the PARSED manifest at base against the PARSED
 * manifest at head, and the classifier treats a manifest it was not given as
 * unclassifiable and reserves. Omitting this made the CLI report `human` with
 * `unclassifiable` for every diff touching any package.json -- including the
 * ordinary case of adding a test script, which Merge Gate accepts. A preview
 * that disagrees with the gate in the RESTRICTIVE direction is still wrong:
 * it routes ordinary work to a human who did not need to see it, which is the
 * exact cost RMA exists to avoid.
 */
export function collectManifests(
  files: ChangedFile[],
  base: string,
  head: string,
  cwd: string,
): Record<string, { base: string | null; head: string | null }> {
  const paths = new Set<string>();
  for (const file of files) {
    for (const name of [file.filename, file.previous_filename]) {
      if (name && /(^|\/)package\.json$/.test(name)) paths.add(name);
    }
  }
  const readAt = (p: string, ref: string): string | null => {
    try {
      return git(['show', `${ref}:${p}`], cwd);
    } catch {
      // Absent at that ref -- the file was added or deleted. That is a real
      // state the classifier distinguishes from "could not read".
      return null;
    }
  };
  const manifests: Record<string, { base: string | null; head: string | null }> = {};
  for (const p of paths) manifests[p] = { base: readAt(p, base), head: readAt(p, head) };
  return manifests;
}

export function classify(
  files: ChangedFile[],
  repoRoot: string,
  manifests: Record<string, { base: string | null; head: string | null }> = {},
): Classification {
  const modulePath = path.join(repoRoot, 'scripts', 'ops', 'merge-authority.cjs');
  const { loadPolicy, classifyDiff } = require_(modulePath);
  return classifyDiff({ files, policy: loadPolicy(repoRoot), manifests });
}

export function formatReport(files: ChangedFile[], result: Classification, json: boolean): string {
  if (json) {
    return JSON.stringify({ authority: result.authority, surfaces: result.surfaces, reasons: result.reasons, files: files.length }, null, 2);
  }
  const lines = [
    `authority: ${result.authority}`,
    `files:     ${files.length}`,
    `surfaces:  ${result.surfaces.length > 0 ? result.surfaces.join(', ') : '(none)'}`,
  ];
  if (result.reasons.length > 0) {
    lines.push('', 'why:');
    for (const reason of result.reasons) lines.push(`  - ${reason}`);
  }
  lines.push(
    '',
    result.authority === 'auto'
      ? 'Authorized on green CI. Merge Gate is the authority; this is a preview.'
      : 'Reserved: needs the griff-approved label AND a head-bound pm-verdict/v1 from a CODEOWNERS member.',
  );
  return lines.join('\n');
}

export function parseArgv(argv: string[]): { base: string; head: string; json: boolean } {
  const get = (flag: string, fallback: string): string => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : fallback;
  };
  return {
    base: get('--base', 'origin/main'),
    head: get('--head', 'HEAD'),
    json: argv.includes('--json'),
  };
}

export function main(argv: string[], cwd: string): number {
  const { base, head, json } = parseArgv(argv);
  const repoRoot = git(['rev-parse', '--show-toplevel'], cwd).trim();
  const files = collectChangedFiles(base, head, repoRoot);
  if (files.length === 0) {
    // The gate reserves an empty changed-file list. Locally an empty range is
    // almost always "you have not committed yet", so say that instead of
    // reporting a reservation the gate would never actually make.
    process.stdout.write(`No changes between ${base} and ${head}. Nothing to classify.\n`);
    return 0;
  }
  const result = classify(files, repoRoot, collectManifests(files, base, head, repoRoot));
  process.stdout.write(`${formatReport(files, result, json)}\n`);
  // Exit 0 either way: `human` is a fact about the diff, not a failure. A
  // non-zero exit here would make an ordinary migration look like a broken
  // command and train people to ignore it.
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2), process.cwd());
}
