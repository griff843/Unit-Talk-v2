#!/usr/bin/env tsx
/**
 * invariant-registry-gate — Constitutional CI gate (UTV2-1088).
 *
 * Validates the invariant registry is internally consistent:
 *   - Closed-schema validation: no unknown fields allowed
 *   - Every registry ID has a ledger allocation
 *   - Every registry ID has a source-manifest entry (bidirectional)
 *   - Append-only ledger: IDs present at base cannot be deleted
 *   - Source-manifest carries a machine-readable PM ratification record
 *   - Active invariants have at least one non-governance enforcing layer
 *   - Superseded/retired invariants have required trailing fields
 *   - No duplicate IDs; ID format matches INV-NNNN
 *
 * Exit 0  → registry valid (gate passes).
 * Exit 1  → registry invalid (gate fails, output lists all violations).
 * Exit 2  → infrastructure error (unreadable files, invalid base ref).
 *
 * Usage:
 *   tsx scripts/ci/invariant-registry-gate.ts [--base <ref>] [--json]
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { InvariantRegistryEntry } from '@unit-talk/contracts';

// ─── Known-field sets for closed-schema validation ───────────────────────────

const KNOWN_REGISTRY_KEYS = new Set([
  'schema_version', 'description', 'invariants',
]);

const KNOWN_INVARIANT_KEYS = new Set([
  'id', 'title', 'description', 'severity', 'enforcing_layer',
  'quarantine_behavior', 'escalation_target', 'status', 'source_ref',
  'audit_gap_ref', 'ratified_at', 'ratified_by', 'superseded_by', 'retired_reason',
]);

const KNOWN_MANIFEST_KEYS = new Set([
  'schema_version', 'description', 'ratified_at', 'ratified_by',
  'ratification_ref', 'sources',
]);

const KNOWN_SOURCE_KEYS = new Set([
  'invariant_id', 'canonical_docs', 'code_refs', 'ci_enforced_by',
]);

const KNOWN_LEDGER_KEYS = new Set([
  'schema_version', 'description', 'entries',
]);

const KNOWN_LEDGER_ENTRY_KEYS = new Set([
  'id', 'title', 'allocated_at', 'status',
]);

// ─── Types ────────────────────────────────────────────────────────────────────

interface InvariantRegistry {
  schema_version: number;
  description?: string;
  invariants: InvariantRegistryEntry[];
}

interface InvariantIdLedger {
  schema_version: number;
  description?: string;
  entries: Array<{ id: string; title: string; allocated_at: string; status: string }>;
}

interface SourceManifest {
  schema_version: number;
  description?: string;
  ratified_at?: string;
  ratified_by?: string;
  ratification_ref?: string;
  sources: Array<{ invariant_id: string; canonical_docs: string[]; code_refs: string[]; ci_enforced_by: string[] }>;
}

interface ParsedArgs {
  base: string;
  json: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let base = 'origin/main';
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base' && argv[i + 1]) {
      base = argv[++i]!;
    } else if (argv[i] === '--json') {
      json = true;
    }
  }
  return { base, json };
}

interface GateViolation {
  invariant_id: string;
  rule: string;
  detail: string;
}

interface GateResult {
  schema_version: 1;
  gate: 'invariant-registry';
  base: string;
  registry_hash: string;
  invariant_count: number;
  active_count: number;
  violations: GateViolation[];
  ok: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readJson<T>(path: string): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (err) {
    process.stderr.write(`INFRA_ERROR — cannot read ${path}: ${(err as Error).message}\n`);
    process.exit(2);
  }
}

function resolveBase(base: string): void {
  try {
    execSync(`git rev-parse --verify "${base}"`, { encoding: 'utf8', stdio: 'pipe' });
  } catch {
    process.stderr.write(
      `invariant-registry-gate: INFRA_ERROR — cannot resolve base ref: ${base}\n` +
      `  If running locally, ensure you have fetched: git fetch origin\n`,
    );
    process.exit(2);
  }
}

function readBaseJson<T>(base: string, gitPath: string): T | null {
  try {
    const raw = execSync(`git show "${base}:${gitPath}"`, { encoding: 'utf8', stdio: 'pipe' });
    return JSON.parse(raw) as T;
  } catch {
    return null; // file didn't exist at base
  }
}

// ─── Validation rules ─────────────────────────────────────────────────────────

function validateRegistrySchema(registry: Record<string, unknown>): GateViolation[] {
  const violations: GateViolation[] = [];

  // Top-level unknown fields
  for (const key of Object.keys(registry)) {
    if (!KNOWN_REGISTRY_KEYS.has(key)) {
      violations.push({ invariant_id: 'registry', rule: 'unknown-field', detail: `Unknown top-level field: "${key}"` });
    }
  }

  // Per-invariant unknown fields
  const invariants = (registry['invariants'] as Record<string, unknown>[]) ?? [];
  for (const inv of invariants) {
    const id = (inv['id'] as string) ?? '?';
    for (const key of Object.keys(inv)) {
      if (!KNOWN_INVARIANT_KEYS.has(key)) {
        violations.push({ invariant_id: id, rule: 'unknown-field', detail: `Unknown invariant field: "${key}"` });
      }
    }
  }
  return violations;
}

function validateManifestSchema(manifest: Record<string, unknown>): GateViolation[] {
  const violations: GateViolation[] = [];
  for (const key of Object.keys(manifest)) {
    if (!KNOWN_MANIFEST_KEYS.has(key)) {
      violations.push({ invariant_id: 'source-manifest', rule: 'unknown-field', detail: `Unknown source-manifest field: "${key}"` });
    }
  }
  const sources = (manifest['sources'] as Record<string, unknown>[]) ?? [];
  for (const src of sources) {
    for (const key of Object.keys(src)) {
      if (!KNOWN_SOURCE_KEYS.has(key)) {
        const id = (src['invariant_id'] as string) ?? '?';
        violations.push({ invariant_id: id, rule: 'unknown-field', detail: `Unknown source entry field: "${key}"` });
      }
    }
  }
  return violations;
}

function validateLedgerSchema(ledger: Record<string, unknown>): GateViolation[] {
  const violations: GateViolation[] = [];
  for (const key of Object.keys(ledger)) {
    if (!KNOWN_LEDGER_KEYS.has(key)) {
      violations.push({ invariant_id: 'id-ledger', rule: 'unknown-field', detail: `Unknown ledger field: "${key}"` });
    }
  }
  const entries = (ledger['entries'] as Record<string, unknown>[]) ?? [];
  for (const entry of entries) {
    const id = (entry['id'] as string) ?? '?';
    for (const key of Object.keys(entry)) {
      if (!KNOWN_LEDGER_ENTRY_KEYS.has(key)) {
        violations.push({ invariant_id: id, rule: 'unknown-field', detail: `Unknown ledger entry field: "${key}"` });
      }
    }
  }
  return violations;
}

function validateManifestRatification(manifest: SourceManifest): GateViolation[] {
  const violations: GateViolation[] = [];
  if (!manifest.ratified_by || !manifest.ratified_at || !manifest.ratification_ref) {
    violations.push({
      invariant_id: 'source-manifest',
      rule: 'ratification-record',
      detail: 'source-manifest.json must have ratified_by, ratified_at, and ratification_ref — add PM ratification before merging registry changes',
    });
  }
  return violations;
}

function validateLedgerAppendOnly(ledger: InvariantIdLedger, base: string, ledgerPath: string): GateViolation[] {
  const violations: GateViolation[] = [];
  const baseLedger = readBaseJson<InvariantIdLedger>(base, ledgerPath);
  if (!baseLedger) return violations; // new file at base — no baseline to enforce

  const currentIds = new Set(ledger.entries.map((e) => e.id));
  for (const entry of baseLedger.entries) {
    if (!currentIds.has(entry.id)) {
      violations.push({
        invariant_id: entry.id,
        rule: 'ledger-deletion',
        detail: `${entry.id} was allocated at base but is missing from current ledger — ledger is append-only; IDs cannot be deleted`,
      });
    }
  }
  return violations;
}

function validateRegistryEntries(
  registry: InvariantRegistry,
  ledger: InvariantIdLedger,
  manifest: SourceManifest,
): GateViolation[] {
  const violations: GateViolation[] = [];
  const ledgerIds = new Set(ledger.entries.map((e) => e.id));
  const manifestIds = new Set(manifest.sources.map((s) => s.invariant_id));
  const seenIds = new Set<string>();

  for (const inv of registry.invariants) {
    // Rule: ID format
    if (!/^INV-\d{4}$/.test(inv.id)) {
      violations.push({ invariant_id: inv.id, rule: 'id-format', detail: `${inv.id} does not match required format INV-NNNN` });
    }

    // Rule: No duplicates
    if (seenIds.has(inv.id)) {
      violations.push({ invariant_id: inv.id, rule: 'duplicate-id', detail: `${inv.id} appears more than once in the registry` });
    }
    seenIds.add(inv.id);

    // Rule: Ledger allocation
    if (!ledgerIds.has(inv.id)) {
      violations.push({ invariant_id: inv.id, rule: 'ledger-allocation', detail: `No ledger entry for ${inv.id} — allocate the ID in id-ledger.json first` });
    }

    // Rule: Source-manifest coverage (registry → manifest)
    if (!manifestIds.has(inv.id)) {
      violations.push({ invariant_id: inv.id, rule: 'source-manifest-coverage', detail: `${inv.id} has no source-manifest entry` });
    }

    // Rule: Active invariants must have a mechanical enforcing layer
    if (inv.status === 'active') {
      const mechanicalLayers = inv.enforcing_layer.filter((l) => l !== 'governance');
      if (mechanicalLayers.length === 0) {
        violations.push({
          invariant_id: inv.id,
          rule: 'mechanical-enforcement',
          detail: `${inv.id} is governance-only — must have at least one mechanical enforcing layer`,
        });
      }
    }

    // Rule: Superseded must reference successor
    if (inv.status === 'superseded' && !inv.superseded_by) {
      violations.push({ invariant_id: inv.id, rule: 'superseded-ref', detail: `${inv.id} has status=superseded but no superseded_by field` });
    }

    // Rule: Retired must have a reason
    if (inv.status === 'retired' && !inv.retired_reason) {
      violations.push({ invariant_id: inv.id, rule: 'retired-reason', detail: `${inv.id} has status=retired but no retired_reason field` });
    }
  }

  // Rule: Source-manifest → registry (no orphan manifest entries)
  const registryIds = new Set(registry.invariants.map((i) => i.id));
  for (const src of manifest.sources) {
    if (!registryIds.has(src.invariant_id)) {
      violations.push({
        invariant_id: src.invariant_id,
        rule: 'source-manifest-orphan',
        detail: `source-manifest has entry for ${src.invariant_id} but that ID is not in the registry`,
      });
    }
  }

  return violations;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  resolveBase(args.base);

  const registryPath = join(process.cwd(), 'packages/invariants/src/registry/invariant-registry.json');
  const ledgerPath = join(process.cwd(), 'packages/invariants/src/registry/id-ledger.json');
  const manifestPath = join(process.cwd(), 'packages/invariants/src/registry/source-manifest.json');

  const rawRegistry = readFileSync(registryPath, 'utf8');
  const registryRaw = JSON.parse(rawRegistry) as Record<string, unknown>;
  const registry = registryRaw as unknown as InvariantRegistry;
  const ledger = readJson<InvariantIdLedger>(ledgerPath);
  const manifest = readJson<SourceManifest>(manifestPath);
  const registryHash = createHash('sha256').update(rawRegistry).digest('hex');

  const violations: GateViolation[] = [
    ...validateRegistrySchema(registryRaw),
    ...validateManifestSchema(manifest as unknown as Record<string, unknown>),
    ...validateLedgerSchema(ledger as unknown as Record<string, unknown>),
    ...validateManifestRatification(manifest),
    ...validateLedgerAppendOnly(ledger, args.base, 'packages/invariants/src/registry/id-ledger.json'),
    ...validateRegistryEntries(registry, ledger, manifest),
  ];

  const activeCount = registry.invariants.filter((i) => i.status === 'active').length;
  const ok = violations.length === 0;

  const result: GateResult = {
    schema_version: 1,
    gate: 'invariant-registry',
    base: args.base,
    registry_hash: registryHash,
    invariant_count: registry.invariants.length,
    active_count: activeCount,
    violations,
    ok,
  };

  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(`invariant-registry-gate\n`);
    process.stdout.write(`  base: ${args.base}\n`);
    process.stdout.write(`  registry hash: ${registryHash.slice(0, 16)}...\n`);
    process.stdout.write(`  invariants: ${registry.invariants.length} total, ${activeCount} active\n`);
    if (violations.length > 0) {
      process.stdout.write(`\nVIOLATIONS (${violations.length}):\n`);
      for (const v of violations) {
        process.stdout.write(`  [FAIL] ${v.invariant_id} — ${v.rule}: ${v.detail}\n`);
      }
      process.stdout.write(`\ninvariant-registry-gate: FAIL\n`);
    } else {
      process.stdout.write(`\ninvariant-registry-gate: PASS\n`);
    }
  }

  if (!ok) {
    process.exit(1);
  }
}

main();
