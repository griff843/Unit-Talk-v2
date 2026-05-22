#!/usr/bin/env tsx
/**
 * invariant-registry-gate — Constitutional CI gate (UTV2-1088).
 *
 * Validates the invariant registry is internally consistent and that no
 * constitutional invariant remains CI-only (lacks a mechanical enforcing layer).
 *
 * Exit 0  → registry valid (gate passes).
 * Exit 1  → registry invalid (gate fails, output lists all violations).
 *
 * Usage:
 *   tsx scripts/ci/invariant-registry-gate.ts [--registry <path>] [--ledger <path>] [--json]
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { InvariantRegistryEntry } from '@unit-talk/contracts';

interface InvariantRegistry {
  schema_version: number;
  invariants: InvariantRegistryEntry[];
}

interface InvariantIdLedger {
  schema_version: number;
  entries: Array<{ id: string; status: string }>;
}

interface ParsedArgs {
  registryPath: string;
  ledgerPath: string;
  json: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const root = join(process.cwd(), 'packages/invariants/src/registry');
  let registryPath = join(root, 'invariant-registry.json');
  let ledgerPath = join(root, 'id-ledger.json');
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--registry' && argv[i + 1]) {
      registryPath = argv[++i]!;
    } else if (argv[i] === '--ledger' && argv[i + 1]) {
      ledgerPath = argv[++i]!;
    } else if (argv[i] === '--json') {
      json = true;
    }
  }
  return { registryPath, ledgerPath, json };
}

interface GateViolation {
  invariant_id: string;
  rule: string;
  detail: string;
}

interface GateResult {
  schema_version: 1;
  gate: 'invariant-registry';
  registry_hash: string;
  invariant_count: number;
  active_count: number;
  violations: GateViolation[];
  ok: boolean;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  let rawRegistry: string;
  let rawLedger: string;
  try {
    rawRegistry = readFileSync(args.registryPath, 'utf8');
    rawLedger = readFileSync(args.ledgerPath, 'utf8');
  } catch (err) {
    process.stderr.write(`Failed to read registry files: ${(err as Error).message}\n`);
    process.exit(1);
  }

  const registry = JSON.parse(rawRegistry) as InvariantRegistry;
  const ledger = JSON.parse(rawLedger) as InvariantIdLedger;
  const registryHash = createHash('sha256').update(rawRegistry).digest('hex');

  const violations: GateViolation[] = [];
  const ledgerIds = new Set(ledger.entries.map((e) => e.id));

  for (const inv of registry.invariants) {
    // Rule 1: Every invariant must have a ledger entry.
    if (!ledgerIds.has(inv.id)) {
      violations.push({
        invariant_id: inv.id,
        rule: 'ledger-allocation',
        detail: `No ledger entry for ${inv.id} — allocate the ID in id-ledger.json first`,
      });
    }

    // Rule 2: Active invariants must have at least one non-governance enforcing layer.
    // Governance-only invariants are prose, not mechanically enforced (violates INV-0011).
    if (inv.status === 'active') {
      const mechanicalLayers = inv.enforcing_layer.filter(
        (l) => l !== 'governance',
      );
      if (mechanicalLayers.length === 0) {
        violations.push({
          invariant_id: inv.id,
          rule: 'mechanical-enforcement',
          detail: `${inv.id} is governance-only — must have at least one mechanical enforcing layer (ci, db-trigger, db-rpc, application, certification)`,
        });
      }
    }

    // Rule 3: Superseded invariants must reference their successor.
    if (inv.status === 'superseded' && !inv.superseded_by) {
      violations.push({
        invariant_id: inv.id,
        rule: 'superseded-ref',
        detail: `${inv.id} has status=superseded but no superseded_by field`,
      });
    }

    // Rule 4: Retired invariants must have a reason.
    if (inv.status === 'retired' && !inv.retired_reason) {
      violations.push({
        invariant_id: inv.id,
        rule: 'retired-reason',
        detail: `${inv.id} has status=retired but no retired_reason field`,
      });
    }

    // Rule 5: ID format must be INV-NNNN.
    if (!/^INV-\d{4}$/.test(inv.id)) {
      violations.push({
        invariant_id: inv.id,
        rule: 'id-format',
        detail: `${inv.id} does not match required format INV-NNNN`,
      });
    }
  }

  // Rule 6: No duplicate IDs in registry.
  const seenIds = new Set<string>();
  for (const inv of registry.invariants) {
    if (seenIds.has(inv.id)) {
      violations.push({
        invariant_id: inv.id,
        rule: 'duplicate-id',
        detail: `${inv.id} appears more than once in the registry`,
      });
    }
    seenIds.add(inv.id);
  }

  const activeCount = registry.invariants.filter((i) => i.status === 'active').length;
  const ok = violations.length === 0;

  const result: GateResult = {
    schema_version: 1,
    gate: 'invariant-registry',
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
