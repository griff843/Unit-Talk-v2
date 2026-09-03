/**
 * Minimal Codex work-packet runner.
 *
 * The mission-native replacement for `ops:codex-exec` as a *delegation* entry
 * point. `codex-exec` requires a lane manifest (`--issue UTV2-###`), a lease, a
 * checkpoint and a closeout; under the mission-native operating model
 * (docs/mission/intent.md) none of those exist, so delegation had no working
 * path at all. This restores one, and deliberately restores nothing else.
 *
 * What it does:
 *   1. reads a work packet (docs/mission/packets/TEMPLATE.md shape)
 *   2. refuses to run an incomplete packet — an underspecified delegation is
 *      the expensive failure, not a missing ticket
 *   2b. refuses to run outside an isolated non-main worktree
 *   3. reports whether the packet's declared scope touches a reserved surface,
 *      using the same policy the merge gate uses
 *   4. resolves a model profile from the canonical routing policy
 *   5. runs `codex exec` with the packet as the task contract
 *
 * What it deliberately does NOT do: create or read a lane manifest, touch
 * Linear, take a lease, write a checkpoint, generate a proof bundle, or close
 * anything out. Codex opens a PR; CI and the merge gate judge it.
 *
 * Usage:
 *   git worktree add ../wt-<name> -b <branch> origin/main
 *   pnpm ops:codex-packet --packet docs/mission/packets/<name>.md --cwd ../wt-<name>
 *                         [--profile codex-terra-medium] [--dry-run]
 *
 * `--cwd` must be an isolated, non-main worktree. Codex runs with full write
 * access; the runner refuses the primary checkout so a packet cannot commit
 * into the control plane.
 *
 * Exit codes:
 *   0 = Codex ran and exited 0
 *   1 = Codex ran and failed
 *   2 = precondition failed (bad packet, unknown/disabled profile, no Codex CLI)
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

import {
  buildCodexModelArgs,
  resolveModelProfile,
  type ModelRoutingBlock,
} from './model-routing.js';

const require = createRequire(import.meta.url);

export const MODEL_ROUTING_POLICY_PATH = 'docs/05_operations/policies/codex-model-routing.json';
export const DEFAULT_PROFILE = 'codex-terra-medium';

/** Branches a packet may never run on directly. Work lands through a PR. */
export const PROTECTED_BRANCHES = new Set(['main', 'master']);

/** Sections a packet must carry. Codex reads nothing else — not Linear, not a
 *  manifest, not this conversation — so anything absent here is absent for it. */
export const REQUIRED_SECTIONS = ['Goal', 'Scope', 'Acceptance', 'Do not touch'] as const;

export interface ParsedPacket {
  title: string;
  profile: string | null;
  sections: Record<string, string>;
  missingSections: string[];
  scopePaths: string[];
  /**
   * Path-shaped scope bullets that could not be normalized to a repo-relative
   * path -- absolute, drive-lettered, or escaping the repo root.
   *
   * Kept rather than dropped. Codex reads the RAW packet, so a bullet silently
   * discarded here is still an instruction to a `danger-full-access` run; a
   * mixed scope (one good path, one `../outside/a.ts`) would otherwise pass the
   * non-empty check while the runner and the model disagreed about the
   * boundary. Any entry here fails the packet.
   */
  invalidScopePaths: string[];
}

/** Splits a packet into `## `-delimited sections, case-insensitively keyed. */
export function parsePacket(text: string): ParsedPacket {
  const lines = text.split(/\r?\n/);
  const sections: Record<string, string> = {};
  let title = '';
  let current: string | null = null;
  let buffer: string[] = [];
  let fenced = false;

  const flush = () => {
    if (current !== null) sections[current.toLowerCase()] = buffer.join('\n').trim();
    buffer = [];
  };

  for (const line of lines) {
    if (line.startsWith('```')) fenced = !fenced;
    if (!fenced && line.startsWith('# ') && !title) {
      title = line.slice(2).trim();
      continue;
    }
    if (!fenced && line.startsWith('## ')) {
      flush();
      current = line.slice(3).trim();
      continue;
    }
    if (current !== null) buffer.push(line);
  }
  flush();

  const missingSections = REQUIRED_SECTIONS.filter(
    (s) => !sections[s.toLowerCase()] || sections[s.toLowerCase()].length === 0
  ).map(String);

  // `Profile:` may appear anywhere before the first section.
  const profileMatch = text.match(/^\s*(?:[-*]\s*)?\*{0,2}Profile:?\*{0,2}\s*[:\s]\s*([\w.-]+)\s*$/im);

  return {
    title,
    profile: profileMatch ? profileMatch[1] : null,
    sections,
    missingSections,
    ...splitScopePaths(sections['scope'] || ''),
  };
}

/**
 * Canonical repo-relative form for a declared scope path, or null if the token
 * cannot be one.
 *
 * The classifier's globs are anchored (`supabase/migrations/**`), so the common
 * spellings `./supabase/...` and `supabase\\...` match NOTHING and the packet
 * reads as unreserved — silently selecting a weaker model profile than its
 * eventual diff requires. Normalizing here is what makes the two agree.
 * Anything that escapes the repo is rejected rather than normalized: a path
 * outside it has no reserved-surface answer at all.
 */
export function normalizeScopePath(token: string): string | null {
  const slashed = token.replace(/\\/g, '/').trim();
  if (slashed === '' || slashed.startsWith('http')) return null;
  if (path.posix.isAbsolute(slashed) || /^[A-Za-z]:\//.test(slashed)) return null;
  const segments: string[] = [];
  for (const segment of slashed.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return null; // escapes the repo root
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length > 0 ? segments.join('/') : null;
}

/**
 * Splits the Scope section's path-shaped bullets into the ones that normalize
 * and the ones that do not. Both halves matter: see `invalidScopePaths`.
 */
export function splitScopePaths(scope: string): {
  scopePaths: string[];
  invalidScopePaths: string[];
} {
  const scopePaths: string[] = [];
  const invalidScopePaths: string[] = [];
  for (const line of scope.split(/\r?\n/)) {
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (!bullet) {
      // A NON-bullet line that is path-shaped is an invalid scope entry, not
      // an absent one. Skipping it silently is the same silent-skip defect
      // this codebase has hit in three separate parsers: a WRONG artifact read
      // as an ABSENT one. Concretely, a Scope of
      //
      //   - `scripts/ops/thing.ts`
      //   Also edit ../outside/a.ts
      //
      // kept the valid bullet, so the nonempty-scope check passed and the
      // packet ran under the default profile -- while the executor still read
      // the raw instruction and could edit a path outside the repository,
      // where neither reserved-surface gate can see it, because a file changed
      // outside Git never reaches a diff. The scope grammar is one path per
      // bullet; anything path-shaped that does not conform is reported, and
      // `invalidScopePaths` is what refuses the packet.
      const stray = line.trim();
      if (
        stray &&
        !stray.startsWith('#') &&
        !stray.startsWith('>') &&
        !stray.startsWith('http') &&
        /(^|\s)[.~/]*[\w.@-]+\/[\w./@*-]+/.test(stray)
      ) {
        invalidScopePaths.push(stray);
      }
      continue;
    }
    const raw = bullet[1].match(/`([^`]+)`/)?.[1] ?? bullet[1].trim().split(/\s+/)[0];
    // Not path-shaped at all: ordinary prose in a bullet, or a URL. Those were
    // never scope declarations, so they are not errors either.
    if (!raw || !/[/.]/.test(raw) || raw.startsWith('http')) continue;
    const token = raw.replace(/[,;]$/, '');
    const normalized = normalizeScopePath(token);
    if (normalized) scopePaths.push(normalized);
    else invalidScopePaths.push(token);
  }
  return { scopePaths, invalidScopePaths };
}

/** Pulls the usable path-shaped tokens out of the Scope section's bullets. */
export function extractScopePaths(scope: string): string[] {
  return splitScopePaths(scope).scopePaths;
}

/**
 * Resolves a logical profile through the CANONICAL fail-closed resolver.
 *
 * This deliberately does not re-implement the checks. `resolveModelProfile`
 * already enforces the policy shape and version, a required boolean `enabled`,
 * the reasoning-effort catalog, and — the one that matters most — that no
 * caller-supplied override can unlock a `requires_pm_authorization` profile. A
 * local reimplementation drifts from those the moment policy changes, and the
 * direction it drifts in is always permissive: a profile with no `enabled`
 * field, or a protected profile later enabled in policy, would run here while
 * every other entry point refused it.
 *
 * `permitted_tiers` is the one input the mission-native model has no direct
 * value for. It is derived from risk rather than invented: a packet whose
 * declared scope touches a reserved surface is the high-consequence class
 * (`T1`), anything else is `T2`. That mapping is strictly tightening — it makes
 * `codex-terra-medium`, which policy permits only for `T2`, unavailable for
 * reserved work instead of quietly running it.
 */
export function resolveProfileForScope(profileName: string, reserved: boolean): ModelRoutingBlock {
  const tier = reserved ? 'T1' : 'T2';
  const resolution = resolveModelProfile({ profileName, tier });
  if (!resolution.ok || !resolution.model_routing) {
    const hint =
      resolution.code === 'PROFILE_NOT_PERMITTED_FOR_TIER' && reserved
        ? ' The declared scope is reserved, so this packet resolves as high-consequence work.' +
          ' Pass --profile codex-sol-high.'
        : '';
    throw new Error(`${resolution.code}: ${resolution.message}.${hint}`);
  }
  return resolution.model_routing;
}

/**
 * Refuses to run anywhere but an isolated, non-main worktree.
 *
 * `codex exec` runs with `-s danger-full-access`: it edits and commits. The
 * default `--cwd` is wherever the command was typed, which is normally the
 * control checkout — the one the orchestrator serializes merges and main-syncs
 * through. A packet running there can commit onto a shared checkout, and every
 * documented example omitted `--cwd`, so that was the likely path rather than
 * the unlucky one.
 *
 * Three independent conditions, because each fails differently: a non-repo cwd
 * is a typo, a primary checkout is the control-plane collision, and `main` is
 * the branch nothing may commit to directly.
 */
export const GIT_REPO_SELECTION_VARS = [
  'GIT_DIR',
  'GIT_COMMON_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CEILING_DIRECTORIES',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM',
] as const;

/**
 * A process environment with every git repository-SELECTION variable removed.
 *
 * These override `-C <dir>`: with `GIT_DIR` exported, `rev-parse` answers about
 * the repository that variable names, not the one at `cwd`. An inherited
 * `GIT_DIR` pointing at a linked worktree would therefore let `--cwd` aim at
 * the primary checkout while every probe below reports an isolated worktree on
 * a feature branch -- the check passes and `codex exec` runs, with its actual
 * filesystem cwd in the control plane. Stripping them makes the probes describe
 * the directory that Codex will really run in.
 */
export function sanitizedGitEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = { ...env };
  for (const name of GIT_REPO_SELECTION_VARS) delete clean[name];
  return clean;
}

export function assertIsolatedWorktree(
  cwd: string,
  repoRoot?: string
): { toplevel: string; branch: string } {
  const env = sanitizedGitEnv();
  const git = (args: string[]): string => {
    const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env });
    if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'git failed').trim());
    return r.stdout.trim();
  };

  let toplevel: string;
  try {
    toplevel = git(['rev-parse', '--show-toplevel']);
  } catch {
    throw new Error(`--cwd is not inside a git repository: ${cwd}`);
  }

  // A linked worktree has its own gitdir under the shared common dir; the
  // primary checkout's two are the same directory. This is the check that
  // actually distinguishes the control checkout from an isolated one — a
  // branch-name test alone would happily run in the control checkout on a
  // feature branch, which is exactly the shared-checkout collision this
  // repository has hit before.
  // `--git-common-dir` is documented as relative to the CURRENT DIRECTORY, not
  // to the toplevel. For `--cwd` inside a subdirectory of the primary checkout
  // it answers something like `../../.git`; resolving that against `toplevel`
  // names a directory outside the repo, the equality below fails, and the
  // control checkout passes as isolated. Resolve it against the cwd git was
  // actually run in, and compare real paths so a symlinked worktree does not
  // read as a different directory either.
  const real = (p: string): string => {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  const gitDir = real(git(['rev-parse', '--absolute-git-dir']));
  const commonDir = real(path.resolve(cwd, git(['rev-parse', '--git-common-dir'])));
  if (gitDir === commonDir) {
    throw new Error(
      `refusing to run in the primary (control) checkout: ${toplevel}. ` +
        'Create an isolated worktree and pass it: ' +
        'git worktree add ../wt-<name> -b <branch> origin/main && ' +
        'pnpm ops:codex-packet --packet <path> --cwd ../wt-<name>'
    );
  }

  // A linked worktree of a DIFFERENT repository satisfies every check above:
  // it is linked, it is not the primary checkout, and it is on a feature
  // branch. Launching a `danger-full-access` run there would point this
  // packet at an unrelated project. Bind the candidate to the repository the
  // command was invoked from.
  if (repoRoot) {
    const invokedCommonDir = (() => {
      const r = spawnSync('git', ['-C', repoRoot, 'rev-parse', '--git-common-dir'], {
        encoding: 'utf8',
        env,
      });
      if (r.status !== 0) return null;
      return real(path.resolve(repoRoot, r.stdout.trim()));
    })();
    if (invokedCommonDir === null) {
      throw new Error(`cannot resolve the invoking repository at ${repoRoot}; refusing to launch.`);
    }
    if (invokedCommonDir !== commonDir) {
      throw new Error(
        `--cwd belongs to a different repository: ${toplevel} shares no git directory with ` +
          `${repoRoot}. A packet must run in a worktree of the repository it was written for.`
      );
    }
  }

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch === 'HEAD') {
    throw new Error(`refusing to run on a detached HEAD in ${toplevel}. Check out a work branch first.`);
  }
  if (PROTECTED_BRANCHES.has(branch)) {
    throw new Error(
      `refusing to run on "${branch}" in ${toplevel}. ` +
        'Work lands through a PR, so the packet needs its own branch: git switch -c <branch>'
    );
  }

  return { toplevel, branch };
}

/** The task contract handed to Codex. The packet is the whole brief; this
 *  preamble only says where the standing rules live and how to finish. */
export function buildPrompt(packetPath: string, packetText: string): string {
  return [
    'You are executing a Unit Talk V2 work packet.',
    '',
    `Packet file: ${packetPath}`,
    '',
    'Standing rules are in AGENTS.md at the repo root — read it first and follow it exactly,',
    'especially the test framework (node:test + tsx --test, never Jest/Vitest), the package',
    'dependency DAG, and the reserved-surface rules.',
    '',
    'There is no Linear issue, no lane manifest and no tier label for this work. Do not look for',
    'one, do not create one, and do not reference one in commits or the PR. The packet below is the',
    'entire contract.',
    '',
    'Reserved filename shapes are prohibited ANYWHERE in your diff, including inside your declared',
    'scope: do not create or edit `.env` or any `.env.*` file that carries values, nor `.npmrc` or',
    '`.pnpmfile.cjs`. These are reserved by filename, not by location, so an ordinary-looking scope',
    'does not admit them. If the work genuinely requires one, stop and say so — the merge classifier',
    'will reserve the PR for a human either way, and finding that out at merge costs a cycle.',
    '',
    'The committed templates `.env.example`, `.env.template` and `.env.sample` are NOT prohibited.',
    'They carry variable names, not values, and the reserved-surface policy excludes them on',
    'purpose: adding an environment variable normally requires updating the template in the same',
    'change. Forbidding them would block that ordinary edit while the classifier itself returns',
    '`auto`, which is a prohibition stricter than the gate it is meant to anticipate.',
    '',
    'When you are done:',
    '  1. `pnpm verify` must be green.',
    '  2. Open a PR with `gh pr create`, using the PR body template in AGENTS.md.',
    '  3. Report what you achieved and — explicitly — what you did not.',
    '',
    'If the packet is wrong, or the real problem is a different one, say so and stop. Reporting that',
    'is useful. Silently widening the scope is not.',
    '',
    '--- BEGIN PACKET ---',
    packetText.trim(),
    '--- END PACKET ---',
  ].join('\n');
}

export interface ScopeClassification {
  /** True when the declared scope touches a reserved surface, OR when the
   *  classification could not be established at all. */
  reserved: boolean;
  surfaces: string[];
}

/**
 * Path-only reserved-surface classification of the packet's declared scope.
 *
 * Advisory in one direction only: a reserved packet still RUNS -- the gate is
 * at merge, not here. But the answer also selects the model profile, and a
 * reserved scope is held to a stricter profile than an unreserved one. So an
 * inability to classify must not read as "nothing reserved": the merge
 * classifier treats exactly that condition as `human`, and this must not be
 * more permissive than the gate it mirrors precisely when policy truth is
 * unavailable.
 */
export function classifyScope(repoRoot: string, scopePaths: string[]): ScopeClassification {
  if (scopePaths.length === 0) {
    return { reserved: true, surfaces: ['unclassifiable'] };
  }
  try {
    const ma = require(path.join(repoRoot, 'scripts/ops/merge-authority.cjs')) as {
      loadPolicy: (root: string) => unknown;
      classifyDiff: (input: { files: { filename: string; patch: string }[]; policy: unknown }) => {
        authority: string;
        surfaces: string[];
      };
    };
    const policy = ma.loadPolicy(repoRoot) as {
      surfaces: { id: string; paths: string[] }[];
    };
    const result = ma.classifyDiff({
      files: scopePaths.map((filename) => ({ filename, patch: '' })),
      policy,
    });
    const surfaces = new Set(result.surfaces);

    // A packet scopes DIRECTORIES ("supabase/migrations", "apps/worker/src"),
    // but the classifier answers about FILES. `supabase/migrations` matches no
    // reserved glob -- the glob is `supabase/migrations/**` -- so a directory
    // whose every descendant is reserved would otherwise be admitted under the
    // permissive profile. A scope is therefore also reserved when it CONTAINS a
    // reserved location: compare each surface glob's literal prefix, the part
    // before its first wildcard, against the scope directory.
    //
    // Both sides are reduced to their literal prefix, and containment is tested
    // in BOTH directions. A scope may itself be a wildcard -- `apps/**` or
    // `supabase/**` -- and comparing that verbatim treated `**` as a literal
    // directory name, so `apps/worker/**` did not appear to live under
    // `apps/**/` and a packet covering the whole of apps/ reported unreserved.
    // A broader scope must be at least as reserved as anything inside it.
    //
    // This containment check covers ANCHORED globs only -- ones whose literal
    // prefix is a real directory. A SUFFIX-ONLY glob (`**/.env`, `**/.env.*`,
    // `**/.npmrc`, `**/.pnpmfile.cjs`) names a filename SHAPE anywhere in the
    // tree, and has no literal prefix; `literalDir` normalises it to `/`, which
    // compares unequal to every scope. That is deliberate, and it is not the
    // hole it looks like:
    //
    //   - A scope that NAMES such a file (`packages/config/.env`) is already
    //     reserved by the classifyDiff call above, which is the same code the
    //     merge gate runs and which honours the surface's excludePaths. Adding
    //     a second glob matcher here would duplicate it less correctly --
    //     `**/.env.example` is excluded from the secrets surface, and a
    //     hand-rolled matcher that ignored excludePaths made this function
    //     STRICTER than the gate it exists to mirror.
    //
    //   - A DIRECTORY scope (`packages/config`) genuinely cannot be answered
    //     from the path: every directory in the repo can contain a `.env`.
    //     Reserving on that basis returns the same answer for every input,
    //     which is not a control. The directory case is carried by the explicit
    //     prohibition in buildPrompt, and enforced at the two places that see
    //     the actual diff: the reserved-surface hook and the merge classifier.
    //     The profile is a prior; the gate is at merge.
    const literalDir = (value: string): string => {
      const prefix = value.split(/[*?[]/)[0] ?? '';
      return prefix.endsWith('/') ? prefix : `${prefix}/`;
    };
    for (const surface of policy.surfaces || []) {
      for (const glob of surface.paths || []) {
        const surfaceDir = literalDir(glob);
        for (const scope of scopePaths) {
          const scopeDir = literalDir(scope);
          if (surfaceDir.startsWith(scopeDir) || scopeDir.startsWith(surfaceDir)) {
            surfaces.add(surface.id);
          }
        }
      }
    }
    return { reserved: surfaces.size > 0, surfaces: [...surfaces] };
  } catch {
    // Missing, malformed or throwing policy. The merge gate reserves here, so
    // this does too -- the packet still runs, but under the stricter profile.
    return { reserved: true, surfaces: ['unclassifiable'] };
  }
}

function fail(message: string): never {
  process.stderr.write(`ops:codex-packet: ${message}\n`);
  process.exit(2);
}

function main(argv: string[]): void {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args.set(key, next);
      i += 1;
    } else {
      args.set(key, 'true');
    }
  }

  const repoRoot = process.cwd();
  const packetArg = args.get('packet');
  if (!packetArg) {
    fail('--packet <path> is required. Start from docs/mission/packets/TEMPLATE.md');
  }

  const packetPath = path.resolve(repoRoot, packetArg);
  if (!fs.existsSync(packetPath)) fail(`packet not found: ${packetArg}`);

  const packetText = fs.readFileSync(packetPath, 'utf8');
  const parsed = parsePacket(packetText);
  if (parsed.missingSections.length > 0) {
    fail(
      `packet is incomplete — missing or empty section(s): ${parsed.missingSections.join(', ')}. ` +
        'Codex reads nothing but this packet; an underspecified packet produces work nobody asked for.'
    );
  }

  // A non-empty `## Scope` is not the same as a usable one: prose, or paths
  // written without bullets, satisfy the section check while yielding nothing
  // to classify. Codex would then run with no mechanically checkable file
  // boundary at all, which is the thing the section exists to establish.
  if (parsed.invalidScopePaths.length > 0) {
    // Dropping these silently would leave the runner and the model disagreeing
    // about the boundary: Codex reads the raw packet, so the offending bullet
    // is still an instruction to a danger-full-access run.
    fail(
      `packet \`## Scope\` declares path(s) that are not inside this repository: ` +
        `${parsed.invalidScopePaths.join(', ')}. Scope must be repo-relative.`
    );
  }

  if (parsed.scopePaths.length === 0) {
    fail(
      'packet `## Scope` declares no usable path. List each path as its own bullet, ' +
        'ideally in backticks, e.g. a line reading: - `apps/api/src/foo.ts`. ' +
        'Prose alone gives the run no ' +
        'file boundary to check against.'
    );
  }

  const { reserved, surfaces } = classifyScope(repoRoot, parsed.scopePaths);

  const profileName = args.get('profile') || parsed.profile || DEFAULT_PROFILE;
  let profile: ModelRoutingBlock;
  try {
    profile = resolveProfileForScope(profileName, reserved);
  } catch (error) {
    fail(`model routing: ${(error as Error).message}`);
  }

  const cwd = path.resolve(repoRoot, args.get('cwd') || '.');
  let checkout: { toplevel: string; branch: string };
  try {
    checkout = assertIsolatedWorktree(cwd, repoRoot);
  } catch (error) {
    fail((error as Error).message);
  }

  const prompt = buildPrompt(path.relative(repoRoot, packetPath).split(path.sep).join('/'), packetText);

  process.stdout.write(
    [
      `packet:  ${packetArg}${parsed.title ? ` — ${parsed.title}` : ''}`,
      `profile: ${profileName} (${profile.model}, effort=${profile.reasoning_effort}, policy ${profile.policy_version})`,
      `cwd:     ${checkout.toplevel} [${checkout.branch}]`,
      `scope:   ${parsed.scopePaths.length} declared path(s)`,
      reserved
        ? `RESERVED: declared scope touches ${surfaces.join(', ')} — the resulting PR will require ` +
          "Griff's approval at merge. That is expected; it does not block the work."
        : 'reserved: none declared — the resulting PR is auto-authorized on green CI.',
      '',
    ].join('\n')
  );

  if (args.get('dry-run') === 'true') {
    process.stdout.write('--dry-run: not invoking Codex.\n\n');
    process.stdout.write(prompt + '\n');
    process.exit(0);
  }

  const health = spawnSync('codex', ['--version'], {
    encoding: 'utf8',
    stdio: 'pipe',
    shell: process.platform === 'win32',
    timeout: 10_000,
  });
  if (health.error || health.status !== 0) {
    fail('Codex CLI unavailable (`codex --version` failed). Install or authenticate it first.');
  }

  const child = spawnSync(
    'codex',
    ['exec', ...buildCodexModelArgs(profile), '-s', 'danger-full-access', prompt],
    // Same sanitation as the probes: the validated worktree must be the one
    // Codex's own git commands act on, not whatever GIT_DIR the caller exported.
    { cwd, stdio: 'inherit', shell: process.platform === 'win32', env: sanitizedGitEnv() }
  );

  if (child.error) {
    process.stderr.write(`ops:codex-packet: codex exec failed to start: ${child.error.message}\n`);
    process.exit(1);
  }
  process.exit(child.status ?? 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}

export { main };
