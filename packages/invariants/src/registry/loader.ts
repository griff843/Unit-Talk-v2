import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InvariantRegistry, InvariantIdLedger, InvariantRegistryEntry } from '../types.js';

const DIR = dirname(fileURLToPath(import.meta.url));

function read<T>(filename: string): T {
  const raw = readFileSync(join(DIR, filename), 'utf8');
  return JSON.parse(raw) as T;
}

let _registry: InvariantRegistry | null = null;
let _ledger: InvariantIdLedger | null = null;

export function loadRegistry(): InvariantRegistry {
  if (!_registry) {
    _registry = read<InvariantRegistry>('invariant-registry.json');
  }
  return _registry;
}

export function loadLedger(): InvariantIdLedger {
  if (!_ledger) {
    _ledger = read<InvariantIdLedger>('id-ledger.json');
  }
  return _ledger;
}

export function getInvariant(id: string): InvariantRegistryEntry | undefined {
  return loadRegistry().invariants.find((inv) => inv.id === id);
}

export function getActiveInvariants(): InvariantRegistryEntry[] {
  return loadRegistry().invariants.filter((inv) => inv.status === 'active');
}

export function registryHash(): string {
  const raw = readFileSync(join(DIR, 'invariant-registry.json'), 'utf8');
  return createHash('sha256').update(raw).digest('hex');
}

/** Validates ledger consistency: every registry entry has a ledger entry. */
export function validateConsistency(): { ok: boolean; errors: string[] } {
  const registry = loadRegistry();
  const ledger = loadLedger();
  const errors: string[] = [];

  const ledgerIds = new Set(ledger.entries.map((e) => e.id));

  for (const inv of registry.invariants) {
    if (!ledgerIds.has(inv.id)) {
      errors.push(`Registry entry ${inv.id} has no ledger allocation`);
    }
  }

  // Every ledger entry must have matching status in the registry
  for (const entry of ledger.entries) {
    const inv = registry.invariants.find((i) => i.id === entry.id);
    if (inv && inv.status !== entry.status) {
      errors.push(
        `Ledger status mismatch for ${entry.id}: ledger=${entry.status}, registry=${inv.status}`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}
