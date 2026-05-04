import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

type DiscordQaMap = {
  guildId: string;
  roles: Record<string, string>;
  channels: Record<string, string>;
};

const REQUIRED_ROLE_KEYS = ['admin', 'operator', 'capper', 'vip', 'vipPlus', 'free', 'noAccess'] as const;
const REQUIRED_CHANNEL_KEYS = [
  'qaBotLog',
  'qaAccessCheck',
  'qaPickDelivery',
  'freePicks',
  'vipPicks',
  'vipPlusPicks',
  'adminOps',
  'recap',
] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function collectMissingEntries(map: DiscordQaMap): string[] {
  const missing: string[] = [];

  if (!isNonEmptyString(map.guildId)) {
    missing.push('guildId');
  }

  for (const key of REQUIRED_ROLE_KEYS) {
    if (!isNonEmptyString(map.roles?.[key])) {
      missing.push(`roles.${key}`);
    }
  }

  for (const key of REQUIRED_CHANNEL_KEYS) {
    if (!isNonEmptyString(map.channels?.[key])) {
      missing.push(`channels.${key}`);
    }
  }

  return missing;
}

function parseMap(filePath: string): DiscordQaMap {
  const raw = readFileSync(filePath, 'utf8');
  const parsed: unknown = JSON.parse(raw);

  assert.ok(parsed && typeof parsed === 'object', 'Root JSON value must be an object');

  const map = parsed as Partial<DiscordQaMap>;
  assert.ok(map.roles && typeof map.roles === 'object', 'roles must be present and must be an object');
  assert.ok(map.channels && typeof map.channels === 'object', 'channels must be present and must be an object');

  return {
    guildId: typeof map.guildId === 'string' ? map.guildId : '',
    roles: map.roles as Record<string, string>,
    channels: map.channels as Record<string, string>,
  };
}

function main(): number {
  const [, , inputPath] = process.argv;

  if (!inputPath) {
    console.error('FAIL: missing JSON path argument');
    console.error('Usage: pnpm tsx apps/qa-agent/scripts/validate-discord-qa-map.ts <path-to-json>');
    return 1;
  }

  const resolvedPath = path.resolve(process.cwd(), inputPath);

  try {
    const map = parseMap(resolvedPath);
    const missing = collectMissingEntries(map);

    if (missing.length > 0) {
      console.error(`FAIL: ${resolvedPath}`);
      console.error(`Missing or empty required entries: ${missing.join(', ')}`);
      return 1;
    }

    console.log(`PASS: ${resolvedPath}`);
    console.log(`Validated guildId, ${REQUIRED_ROLE_KEYS.length} role keys, and ${REQUIRED_CHANNEL_KEYS.length} channel keys.`);
    return 0;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`FAIL: ${resolvedPath}`);
    console.error(detail);
    return 1;
  }
}

process.exitCode = main();
