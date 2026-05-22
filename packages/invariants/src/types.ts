/**
 * Re-export canonical invariant types from @unit-talk/contracts.
 * Types are defined in contracts so callers can depend on the contract
 * without pulling in the Node.js fs-based registry loader.
 */
export type {
  InvariantRegistryEntry,
  InvariantSeverity,
  InvariantEnforcingLayer,
  InvariantQuarantineBehavior,
  InvariantStatus,
} from '@unit-talk/contracts';

/** The full registry file shape (invariant-registry.json). */
export interface InvariantRegistry {
  schema_version: 1;
  description: string;
  invariants: InvariantRegistryEntry[];
}

/** The ID ledger file shape (id-ledger.json — append-only). */
export interface InvariantIdLedger {
  schema_version: 1;
  description: string;
  entries: Array<{
    id: string;
    title: string;
    allocated_at: string;
    status: InvariantStatus;
  }>;
}
