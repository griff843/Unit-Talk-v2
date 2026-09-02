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
    scopePaths: extractScopePaths(sections['scope'] || ''),
  };
}

/** Pulls path-shaped tokens out of the Scope section's bullets. */
export function extractScopePaths(scope: string): string[] {
  const out: string[] = [];
  for (const line of scope.split(/\r?\n/)) {
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (!bullet) continue;
    const token = bullet[1].match(/`([^`]+)`/)?.[1] ?? bullet[1].trim().split(/\s+/)[0];
    if (token && /[/.]/.test(token) && !token.startsWith('http')) out.push(token.replace(/[,;]$/, ''));
  }
  return out;
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
export function assertIsolatedWorktree(cwd: string): { toplevel: string; branch: string } {
  const git = (args: string[]): string => {
    const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
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
  const gitDir = path.resolve(git(['rev-parse', '--absolute-git-dir']));
  const commonDir = path.resolve(toplevel, git(['rev-parse', '--git-common-dir']));
  if (gitDir === commonDir) {
    throw new Error(
      `refusing to run in the primary (control) checkout: ${toplevel}. ` +
        'Create an isolated worktree and pass it: ' +
        'git worktree add ../wt-<name> -b <branch> origin/main && ' +
        'pnpm ops:codex-packet --packet <path> --cwd ../wt-<name>'
    );
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

/** Path-only reserved-surface classification of the packet's declared scope.
 *  Advisory: a reserved packet still runs. The gate is at merge, not here. */
export function classifyScope(repoRoot: string, scopePaths: string[]): string[] {
  if (scopePaths.length === 0) return [];
  try {
    const ma = require(path.join(repoRoot, 'scripts/ops/merge-authority.cjs')) as {
      loadPolicy: (root: string) => unknown;
      classifyDiff: (input: { files: { filename: string; patch: string }[]; policy: unknown }) => {
        authority: string;
        surfaces: string[];
      };
    };
    const policy = ma.loadPolicy(repoRoot);
    const result = ma.classifyDiff({
      files: scopePaths.map((filename) => ({ filename, patch: '' })),
      policy,
    });
    return result.surfaces.filter((s) => s !== 'unclassifiable');
  } catch {
    // The merge gate fails closed on an unreadable policy; this advisory does
    // not need to duplicate that, and must not block delegation on it.
    return [];
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

  const surfaces = classifyScope(repoRoot, parsed.scopePaths);

  const profileName = args.get('profile') || parsed.profile || DEFAULT_PROFILE;
  let profile: ModelRoutingBlock;
  try {
    profile = resolveProfileForScope(profileName, surfaces.length > 0);
  } catch (error) {
    fail(`model routing: ${(error as Error).message}`);
  }

  const cwd = path.resolve(repoRoot, args.get('cwd') || '.');
  let checkout: { toplevel: string; branch: string };
  try {
    checkout = assertIsolatedWorktree(cwd);
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
      surfaces.length > 0
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
    { cwd, stdio: 'inherit', shell: process.platform === 'win32' }
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
