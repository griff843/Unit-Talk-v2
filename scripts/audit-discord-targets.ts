#!/usr/bin/env tsx
/**
 * UTV2-913: Audit UNIT_TALK_DISTRIBUTION_TARGETS and UNIT_TALK_DISCORD_TARGET_MAP
 * to confirm production Discord channels are correctly configured.
 *
 * Usage:
 *   npx tsx scripts/audit-discord-targets.ts
 *   pnpm audit:discord-targets
 *
 * Pass --json to get machine-readable output.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const jsonMode = process.argv.includes('--json');

interface AuditResult {
  ok: boolean;
  env: string;
  distributionTargets: string[];
  targetMap: Record<string, string>;
  findings: Finding[];
  requiredActions: string[];
}

interface Finding {
  level: 'info' | 'warn' | 'error';
  message: string;
}

const REQUIRED_PRODUCTION_TARGETS = ['discord:canary', 'discord:best-bets'];
const KNOWN_PRODUCTION_MAP: Record<string, string> = {
  'discord:canary': '1296531122234327100',
  'discord:best-bets': '1288613037539852329',
  'discord:trader-insights': '1356613995175481405',
  'discord:recaps': '1300411261854547968',
};
const DEFERRED_TARGETS = [
  'discord:exclusive-insights',
  'discord:game-threads',
  'discord:strategy-room',
];

function loadEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const lines = readFileSync(path, 'utf-8').split('\n');
  const result: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    result[key] = val;
  }
  return result;
}

function mergeEnv(): Record<string, string> {
  const localEnv = loadEnvFile(resolve(ROOT, 'local.env'));
  const dotEnv = loadEnvFile(resolve(ROOT, '.env'));
  const dotEnvExample = loadEnvFile(resolve(ROOT, '.env.example'));
  return { ...dotEnvExample, ...dotEnv, ...localEnv, ...(process.env as Record<string, string>) };
}

function parseDistributionTargets(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw.split(',').map((t) => t.trim()).filter(Boolean);
}

function parseTargetMap(raw: string | undefined): Record<string, string> | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, string>;
  } catch {
    return null;
  }
}

function runAudit(): AuditResult {
  const env = mergeEnv();
  const appEnv = env['UNIT_TALK_APP_ENV'] ?? 'unknown';
  const rawTargets = env['UNIT_TALK_DISTRIBUTION_TARGETS'];
  const rawMap = env['UNIT_TALK_DISCORD_TARGET_MAP'];
  const workerAdapter = env['UNIT_TALK_WORKER_ADAPTER'] ?? 'stub';
  const workerDryRun = env['UNIT_TALK_WORKER_DRY_RUN'] ?? 'true';

  const distributionTargets = parseDistributionTargets(rawTargets);
  const targetMap = parseTargetMap(rawMap) ?? {};
  const findings: Finding[] = [];
  const requiredActions: string[] = [];

  // 1. App environment
  findings.push({ level: 'info', message: `UNIT_TALK_APP_ENV=${appEnv}` });
  if (appEnv === 'local' || appEnv === 'development') {
    findings.push({
      level: 'warn',
      message: 'Local/dev env: delivery targets are forced to discord:canary by resolveDeliveryTarget()',
    });
  }

  // 2. Worker mode
  findings.push({ level: 'info', message: `UNIT_TALK_WORKER_ADAPTER=${workerAdapter}` });
  findings.push({ level: 'info', message: `UNIT_TALK_WORKER_DRY_RUN=${workerDryRun}` });
  if (workerAdapter === 'stub') {
    findings.push({ level: 'warn', message: 'Worker adapter is stub — no real Discord delivery' });
  }
  if (workerDryRun === 'true') {
    findings.push({ level: 'warn', message: 'Worker dry-run is enabled — outbox rows claimed but not delivered' });
  }

  // 3. UNIT_TALK_DISTRIBUTION_TARGETS
  if (!rawTargets) {
    findings.push({ level: 'error', message: 'UNIT_TALK_DISTRIBUTION_TARGETS is not set' });
    requiredActions.push('Set UNIT_TALK_DISTRIBUTION_TARGETS in production environment');
  } else {
    findings.push({ level: 'info', message: `UNIT_TALK_DISTRIBUTION_TARGETS: ${distributionTargets.join(', ')}` });
    for (const required of REQUIRED_PRODUCTION_TARGETS) {
      if (!distributionTargets.includes(required)) {
        findings.push({ level: 'error', message: `Required target missing from UNIT_TALK_DISTRIBUTION_TARGETS: ${required}` });
        requiredActions.push(`Add "${required}" to UNIT_TALK_DISTRIBUTION_TARGETS`);
      }
    }
    for (const deferred of DEFERRED_TARGETS) {
      if (distributionTargets.includes(deferred)) {
        findings.push({ level: 'error', message: `Deferred target enabled in UNIT_TALK_DISTRIBUTION_TARGETS: ${deferred} — must not be in production` });
        requiredActions.push(`Remove "${deferred}" from UNIT_TALK_DISTRIBUTION_TARGETS`);
      }
    }
  }

  // 4. UNIT_TALK_DISCORD_TARGET_MAP
  if (!rawMap?.trim()) {
    findings.push({ level: 'error', message: 'UNIT_TALK_DISCORD_TARGET_MAP is not set' });
    requiredActions.push('Set UNIT_TALK_DISCORD_TARGET_MAP with production channel IDs');
  } else if (parseTargetMap(rawMap) === null) {
    findings.push({ level: 'error', message: 'UNIT_TALK_DISCORD_TARGET_MAP is not valid JSON' });
    requiredActions.push('Fix UNIT_TALK_DISCORD_TARGET_MAP — must be a valid JSON object');
  } else {
    for (const target of distributionTargets) {
      if (!target.startsWith('discord:')) continue;
      if (!Object.prototype.hasOwnProperty.call(targetMap, target)) {
        findings.push({ level: 'error', message: `No channel ID for enabled target "${target}" in UNIT_TALK_DISCORD_TARGET_MAP` });
        requiredActions.push(`Add mapping for "${target}" in UNIT_TALK_DISCORD_TARGET_MAP`);
      } else {
        const channelId = targetMap[target];
        const knownId = KNOWN_PRODUCTION_MAP[target];
        if (knownId && channelId !== knownId) {
          findings.push({
            level: 'warn',
            message: `Channel ID for "${target}" is "${channelId}" — expected production ID is "${knownId}"`,
          });
        } else {
          findings.push({ level: 'info', message: `${target} → ${channelId} ✓` });
        }
      }
    }
  }

  // 5. deploy.yml gap check
  findings.push({
    level: 'warn',
    message: 'FINDING: deploy.yml does not inject UNIT_TALK_DISTRIBUTION_TARGETS or UNIT_TALK_DISCORD_TARGET_MAP into Hetzner containers. These must be set in the server-side .env or docker-compose override.',
  });
  requiredActions.push(
    'Confirm UNIT_TALK_DISTRIBUTION_TARGETS and UNIT_TALK_DISCORD_TARGET_MAP are set in Hetzner server .env or docker-compose.override.yml (not controlled by deploy.yml)',
  );

  const ok = findings.every((f) => f.level !== 'error');
  return { ok, env: appEnv, distributionTargets, targetMap, findings, requiredActions };
}

const result = runAudit();

if (jsonMode) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const icon = (level: string) => ({ info: 'ℹ', warn: '⚠', error: '✗' }[level] ?? '?');
  console.log('\n=== Discord Distribution Target Audit ===\n');
  for (const f of result.findings) {
    console.log(`  ${icon(f.level)}  ${f.message}`);
  }
  if (result.requiredActions.length > 0) {
    console.log('\n--- Required Actions ---');
    for (const action of result.requiredActions) {
      console.log(`  [ ] ${action}`);
    }
  }
  const status = result.ok ? 'PASS' : 'FAIL (errors found — see above)';
  console.log(`\nAudit: ${status}\n`);
  if (!result.ok) process.exit(1);
}
