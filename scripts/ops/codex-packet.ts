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
 *   pnpm ops:codex-packet --packet docs/mission/packets/<name>.md
 *                         [--profile codex-terra-medium] [--cwd <dir>] [--dry-run]
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

const require = createRequire(import.meta.url);

export const MODEL_ROUTING_POLICY_PATH = 'docs/05_operations/policies/codex-model-routing.json';
export const DEFAULT_PROFILE = 'codex-terra-medium';

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

export interface ModelProfile {
  model: string;
  reasoning_effort: string;
}

/** Resolves a logical profile against the canonical routing policy. Throws on
 *  an unknown or disabled profile — a silent CLI default is exactly the drift
 *  the routing policy exists to prevent. */
export function resolveProfile(policy: unknown, name: string): ModelProfile {
  const profiles = (policy as { profiles?: Record<string, Record<string, unknown>> } | null)?.profiles;
  if (!profiles || typeof profiles !== 'object') {
    throw new Error(`Model routing policy has no "profiles" map (${MODEL_ROUTING_POLICY_PATH}).`);
  }
  const p = profiles[name];
  if (!p) {
    throw new Error(`Unknown model profile "${name}". Available: ${Object.keys(profiles).join(', ')}`);
  }
  if (p.enabled === false) {
    throw new Error(`Model profile "${name}" is disabled in ${MODEL_ROUTING_POLICY_PATH}.`);
  }
  if (typeof p.model !== 'string' || typeof p.reasoning_effort !== 'string') {
    throw new Error(`Model profile "${name}" is malformed: model/reasoning_effort must be strings.`);
  }
  return { model: p.model, reasoning_effort: p.reasoning_effort };
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

  const profileName = args.get('profile') || parsed.profile || DEFAULT_PROFILE;
  let profile: ModelProfile;
  try {
    const policy = JSON.parse(fs.readFileSync(path.join(repoRoot, MODEL_ROUTING_POLICY_PATH), 'utf8'));
    profile = resolveProfile(policy, profileName);
  } catch (error) {
    fail(`model routing: ${(error as Error).message}`);
  }

  const surfaces = classifyScope(repoRoot, parsed.scopePaths);
  const cwd = path.resolve(repoRoot, args.get('cwd') || '.');
  const prompt = buildPrompt(path.relative(repoRoot, packetPath).split(path.sep).join('/'), packetText);

  process.stdout.write(
    [
      `packet:  ${packetArg}${parsed.title ? ` — ${parsed.title}` : ''}`,
      `profile: ${profileName} (${profile.model}, effort=${profile.reasoning_effort})`,
      `cwd:     ${cwd}`,
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
    ['exec', '--model', profile.model, '-c', `model_reasoning_effort=${profile.reasoning_effort}`, '-s', 'danger-full-access', prompt],
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
