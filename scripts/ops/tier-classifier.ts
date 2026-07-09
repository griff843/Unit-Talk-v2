import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  TIER_C_EXACT_PATHS,
  TIER_C_PATH_PATTERNS,
  TIER_C_PATH_PREFIXES,
  isTierCPath,
} from './merge-risk.js';
import { ROOT, emitJson, normalizeRepoRelativePaths } from './shared.js';

export type LaneTier = 'T1' | 'T2' | 'T3';

export interface TierClassifierMatch {
  path: string;
  minimum_tier: LaneTier;
  rule_id: string;
  reason: string;
}

export interface TierClassification {
  declared_tier: LaneTier;
  mechanical_minimum: LaneTier;
  derived_tier: LaneTier;
  escalated: boolean;
  changed_files: string[];
  matches: TierClassifierMatch[];
  advisory: {
    conclusion: 'success' | 'neutral';
    message: string;
  };
}

const TIER_RANK: Record<LaneTier, number> = {
  T1: 3,
  T2: 2,
  T3: 1,
};

const VALID_TIERS = new Set<LaneTier>(['T1', 'T2', 'T3']);

export function parseLaneTier(value: string): LaneTier {
  const normalized = value.trim().toUpperCase().replace(/^TIER:/u, '');
  if (VALID_TIERS.has(normalized as LaneTier)) {
    return normalized as LaneTier;
  }
  throw new Error(`Invalid tier "${value}"; expected T1, T2, or T3`);
}

export function maxTier(left: LaneTier, right: LaneTier): LaneTier {
  return TIER_RANK[left] >= TIER_RANK[right] ? left : right;
}

function matchRule(filePath: string): TierClassifierMatch | null {
  const normalized = filePath.replaceAll('\\', '/').replace(/^\.\//u, '');
  if (!isTierCPath(normalized)) {
    return null;
  }

  let ruleId = 'tier-c-path';
  if (TIER_C_EXACT_PATHS.has(normalized)) {
    ruleId = 'tier-c-exact';
  } else if (TIER_C_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    ruleId = 'tier-c-prefix';
  } else if (TIER_C_PATH_PATTERNS.some((pattern) => pattern.test(normalized))) {
    ruleId = 'tier-c-pattern';
  }

  return {
    path: normalized,
    minimum_tier: 'T1',
    rule_id: ruleId,
    reason: 'Path matches the shared Tier C / tier-sensitive path authority from merge-risk.ts',
  };
}

export function classifyMechanicalMinimum(paths: string[]): {
  mechanicalMinimum: LaneTier;
  matches: TierClassifierMatch[];
} {
  const changedFiles = normalizeRepoRelativePaths(paths);
  const matches = changedFiles
    .map((filePath) => matchRule(filePath))
    .filter((match): match is TierClassifierMatch => match !== null);

  return {
    mechanicalMinimum: matches.reduce(
      (tier, match) => maxTier(tier, match.minimum_tier),
      'T3' as LaneTier,
    ),
    matches,
  };
}

export function classifyDerivedTier(input: {
  declaredTier: LaneTier;
  changedFiles: string[];
}): TierClassification {
  const changedFiles = normalizeRepoRelativePaths(input.changedFiles);
  const { mechanicalMinimum, matches } = classifyMechanicalMinimum(changedFiles);
  const derivedTier = maxTier(input.declaredTier, mechanicalMinimum);
  const escalated = derivedTier !== input.declaredTier;

  return {
    declared_tier: input.declaredTier,
    mechanical_minimum: mechanicalMinimum,
    derived_tier: derivedTier,
    escalated,
    changed_files: changedFiles,
    matches,
    advisory: {
      conclusion: escalated ? 'neutral' : 'success',
      message: escalated
        ? `Advisory-only: declared ${input.declaredTier} would be treated as ${derivedTier} by mechanical tier classification.`
        : `Advisory-only: declared ${input.declaredTier} matches the mechanical tier floor.`,
    },
  };
}

function runCommand(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    throw new Error((result.stderr ?? '').trim() || `Command failed: ${command} ${args.join(' ')}`);
  }

  return (result.stdout ?? '').trim();
}

function diffFiles(root: string, base: string, head: string): string[] {
  const stdout = runCommand('git', ['diff', '--name-only', `${base}...${head}`], root);
  return stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

function parseValue(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  if (index === -1) {
    return null;
  }
  const value = args[index + 1];
  return value != null && !value.startsWith('--') ? value : null;
}

function parseList(value: string | null): string[] {
  if (value == null || value.trim() === '') {
    return [];
  }
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.includes('--help')) {
    process.stdout.write('Usage: npx tsx scripts/ops/tier-classifier.ts --declared-tier T1|T2|T3 [--base origin/main --head HEAD] [--files a,b]\n');
    process.exitCode = 0;
    return;
  }

  const declaredTierValue = parseValue(rawArgs, '--declared-tier');
  if (declaredTierValue == null) {
    throw new Error('Missing required --declared-tier T1|T2|T3');
  }

  const base = parseValue(rawArgs, '--base') ?? 'origin/main';
  const head = parseValue(rawArgs, '--head') ?? 'HEAD';
  const explicitFiles = parseList(parseValue(rawArgs, '--files'));
  const changedFiles = explicitFiles.length > 0 ? explicitFiles : diffFiles(ROOT, base, head);

  emitJson(classifyDerivedTier({
    declaredTier: parseLaneTier(declaredTierValue),
    changedFiles,
  }));
}

const isDirectRun = process.argv[1] != null
  && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  void main().catch((error: unknown) => {
    console.error('[tier-classifier] fatal:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
