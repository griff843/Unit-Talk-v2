#!/usr/bin/env tsx
/**
 * Validates the operating capability map against the repository surfaces it
 * names. A map entry is useful only when its primary capability and fallback
 * can actually be reached; stale names turn the map into misleading prose.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_MAP_PATH = 'docs/05_operations/CAPABILITY_MAP.json';
const VALID_KINDS = new Set(['command', 'agent', 'skill']);

export interface CapabilityMapFinding {
  code: string;
  path: string;
  detail: string;
}

export interface CapabilityMapReport {
  verdict: 'PASS' | 'FAIL';
  map_path: string;
  entries_checked: number;
  findings: CapabilityMapFinding[];
}

interface CapabilityEntry {
  situation?: unknown;
  capability?: unknown;
  kind?: unknown;
  authority?: unknown;
  fallback?: unknown;
}

interface CapabilityMap {
  schema_version?: unknown;
  authority_levels?: unknown;
  field_contract?: unknown;
  situations?: unknown;
}

function add(findings: CapabilityMapFinding[], code: string, findingPath: string, detail: string): void {
  findings.push({ code, path: findingPath, detail });
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function readPackageScripts(root: string): Set<string> {
  const packagePath = path.join(root, 'package.json');
  try {
    const parsed = JSON.parse(readFileSync(packagePath, 'utf8')) as { scripts?: Record<string, unknown> };
    return new Set(Object.keys(parsed.scripts ?? {}).filter((name) => typeof parsed.scripts?.[name] === 'string'));
  } catch {
    return new Set();
  }
}

function commandScripts(reference: string): string[] | null {
  const segments = reference.split(/\s+\/\s+/);
  const scripts: string[] = [];
  for (const segment of segments) {
    const match = /^pnpm\s+([^\s]+)(?:\s+.*)?$/.exec(segment.trim());
    if (!match) return null;
    scripts.push(match[1]);
  }
  return scripts;
}

function namedSurfaceExists(root: string, kind: 'agent' | 'skill', reference: string): boolean {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(reference)) return false;
  const directory = kind === 'agent' ? '.claude/agents' : '.claude/commands';
  return existsSync(path.join(root, directory, `${reference}.md`));
}

function capabilityExists(root: string, scripts: Set<string>, kind: 'command' | 'agent' | 'skill', reference: string): boolean {
  if (kind === 'command') {
    const names = commandScripts(reference);
    return names !== null && names.every((name) => scripts.has(name));
  }
  return namedSurfaceExists(root, kind, reference);
}

function anyCapabilityExists(root: string, scripts: Set<string>, reference: string): boolean {
  return (
    capabilityExists(root, scripts, 'command', reference) ||
    capabilityExists(root, scripts, 'agent', reference) ||
    capabilityExists(root, scripts, 'skill', reference)
  );
}

export function validateCapabilityMap(
  map: CapabilityMap,
  options: { root?: string; mapPath?: string } = {},
): CapabilityMapReport {
  const root = options.root ?? REPO_ROOT;
  const mapPath = options.mapPath ?? DEFAULT_MAP_PATH;
  const findings: CapabilityMapFinding[] = [];
  const scripts = readPackageScripts(root);

  if (map.schema_version !== 1) {
    add(findings, 'CAPABILITY_MAP_SCHEMA_VERSION', 'schema_version', 'must equal supported schema version 1');
  }
  if (!map.field_contract || typeof map.field_contract !== 'object' || Array.isArray(map.field_contract)) {
    add(findings, 'CAPABILITY_MAP_FIELD_CONTRACT', 'field_contract', 'must be an object describing entry fields');
  }
  if (!map.authority_levels || typeof map.authority_levels !== 'object' || Array.isArray(map.authority_levels)) {
    add(findings, 'CAPABILITY_MAP_AUTHORITY_LEVELS', 'authority_levels', 'must be an object');
  }

  const authorityLevels =
    map.authority_levels && typeof map.authority_levels === 'object' && !Array.isArray(map.authority_levels)
      ? new Set(Object.keys(map.authority_levels))
      : new Set<string>();

  if (!Array.isArray(map.situations) || map.situations.length === 0) {
    add(findings, 'CAPABILITY_MAP_SITUATIONS', 'situations', 'must be a non-empty array');
    return { verdict: 'FAIL', map_path: mapPath, entries_checked: 0, findings };
  }

  const seenSituations = new Set<string>();
  for (const [index, entry] of map.situations.entries()) {
    const entryPath = `situations[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      add(findings, 'CAPABILITY_MAP_ENTRY', entryPath, 'must be an object');
      continue;
    }
    const typedEntry = entry as CapabilityEntry;
    if (!nonEmptyString(typedEntry.situation)) {
      add(findings, 'CAPABILITY_MAP_SITUATION', `${entryPath}.situation`, 'must be a non-empty string');
    } else if (seenSituations.has(typedEntry.situation)) {
      add(findings, 'CAPABILITY_MAP_DUPLICATE_SITUATION', `${entryPath}.situation`, 'duplicates an earlier situation');
    } else {
      seenSituations.add(typedEntry.situation);
    }
    if (!nonEmptyString(typedEntry.capability)) {
      add(findings, 'CAPABILITY_MAP_CAPABILITY', `${entryPath}.capability`, 'must be a non-empty string');
    }
    if (!nonEmptyString(typedEntry.kind) || !VALID_KINDS.has(typedEntry.kind)) {
      add(findings, 'CAPABILITY_MAP_KIND', `${entryPath}.kind`, 'must be command, agent, or skill');
    }
    if (!nonEmptyString(typedEntry.authority) || !authorityLevels.has(typedEntry.authority)) {
      add(findings, 'CAPABILITY_MAP_AUTHORITY', `${entryPath}.authority`, 'must name a declared authority level');
    }
    if (typedEntry.fallback !== null && !nonEmptyString(typedEntry.fallback)) {
      add(findings, 'CAPABILITY_MAP_FALLBACK', `${entryPath}.fallback`, 'must be a non-empty string or null');
    }

    if (nonEmptyString(typedEntry.capability) && nonEmptyString(typedEntry.kind) && VALID_KINDS.has(typedEntry.kind)) {
      const kind = typedEntry.kind as 'command' | 'agent' | 'skill';
      if (!capabilityExists(root, scripts, kind, typedEntry.capability)) {
        add(
          findings,
          'CAPABILITY_MAP_UNRESOLVED_CAPABILITY',
          `${entryPath}.capability`,
          `${kind} reference ${JSON.stringify(typedEntry.capability)} does not resolve in this repository`,
        );
      }
    }
    if (nonEmptyString(typedEntry.fallback) && !anyCapabilityExists(root, scripts, typedEntry.fallback)) {
      add(
        findings,
        'CAPABILITY_MAP_UNRESOLVED_FALLBACK',
        `${entryPath}.fallback`,
        `fallback ${JSON.stringify(typedEntry.fallback)} does not resolve to a command, agent, or skill`,
      );
    }
  }

  return { verdict: findings.length === 0 ? 'PASS' : 'FAIL', map_path: mapPath, entries_checked: map.situations.length, findings };
}

export function validateCapabilityMapFile(
  options: { root?: string; mapPath?: string } = {},
): CapabilityMapReport {
  const root = options.root ?? REPO_ROOT;
  const mapPath = options.mapPath ?? DEFAULT_MAP_PATH;
  const absolutePath = path.join(root, mapPath);
  if (!existsSync(absolutePath)) {
    return {
      verdict: 'FAIL',
      map_path: mapPath,
      entries_checked: 0,
      findings: [{ code: 'CAPABILITY_MAP_MISSING', path: mapPath, detail: 'capability map file does not exist' }],
    };
  }
  try {
    return validateCapabilityMap(JSON.parse(readFileSync(absolutePath, 'utf8')) as CapabilityMap, { root, mapPath });
  } catch (error) {
    return {
      verdict: 'FAIL',
      map_path: mapPath,
      entries_checked: 0,
      findings: [{ code: 'CAPABILITY_MAP_INVALID_JSON', path: mapPath, detail: error instanceof Error ? error.message : String(error) }],
    };
  }
}

function main(): void {
  const mapIndex = process.argv.indexOf('--map');
  const mapPath = mapIndex >= 0 ? process.argv[mapIndex + 1] : DEFAULT_MAP_PATH;
  if (!mapPath) throw new Error('--map requires a repository-relative path');
  const report = validateCapabilityMapFile({ mapPath });
  for (const finding of report.findings) console.error(`[${finding.code}] ${finding.path}: ${finding.detail}`);
  console.log(`Capability map: ${report.verdict} (${report.entries_checked} entries checked)`);
  if (report.verdict === 'FAIL') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
