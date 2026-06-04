## Diff Summary — UTV2-1198

**Merge SHA:** 492f4ed9763246b9863c66e1ecf59319c510f3cf
**File:** `packages/db/src/database.types.ts`
**Change:** 115 lines added, 0 lines removed (purely additive)

### New table: `execution_intents`

Added at position after `experiment_ledger`. Row type:

```typescript
execution_intents: {
  Row: {
    created_at: string
    decision_record_id: string
    id: string
    idempotency_key: string | null
    inputs_hash: string
    intent_type: string
    issued_at_ms: number
    payload: Json
    pick_id: string
    predecessor_id: string | null
    provenance: Json
    status: string
  }
  // ... Insert, Update, Relationships (self-referencing predecessor_id FK)
}
```

### New table: `settlement_corrections`

Added at position after `settlement_records`. Row type:

```typescript
settlement_corrections: {
  Row: {
    audit_event_id: string | null
    authorizer_1: string
    authorizer_2: string
    correction_at: string
    id: string
    justification: string
    prior_record_id: string
    settlement_record_id: string
  }
  // ... Insert, Update, Relationships (FK to settlement_records x2)
}
```

### No removals

All existing types preserved. `artifact_sha` on `model_registry` remains present — the UTV2-1116 migration was applied to the live DB as part of this lane, bringing the remote schema into parity with the committed migration file.

Merge SHA: 498567e355eaf36221998dad63c44a6f749c7e3f
