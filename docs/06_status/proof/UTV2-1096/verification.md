# Verification — UTV2-1096: Certification Entity and Lifecycle States

**Merge SHA:** `c2974f9d9296f92b9148aa9db6728c75dd711573`
**Supabase project:** `zfzdnfwdarxucxtaojxm`
**Tier:** T1
**Executor:** claude

## Verification

### Static verification

```
pnpm --filter @unit-talk/invariants type-check
→ exit 0, zero TS errors

pnpm --filter @unit-talk/db type-check
→ exit 0, zero TS errors

pnpm --filter @unit-talk/invariants test
→ 209/209 tests PASS, 0 fail (15 new certification tests)
```

### Test coverage

New tests in `packages/invariants/src/certification/certification.test.ts`:

- `initiate()` — correct fields, SHA validation (evidenceSha 64-hex, mergeSha 40-hex)
- Valid transitions: pending→active, pending→revoked, active→suspended, active→expired, suspended→active, expired→pending
- Invalid transitions: revoked→active (terminal), active→pending (no path), revoked without trigger, revocationTrigger on non-revoked
- Revocation propagation: replay revokes divergence/quarantine/proof_lineage/freshness/cert_evidence; invariant revokes divergence/proof_lineage/cert_evidence; already-revoked domains skipped
- `isCertified()` fail-closed: null, pending, suspended, revoked, clock-expired, and active all handled
- `getProgramBlockers()`: all 7 blocked, subset blocked, none blocked
- `DOMAIN_DEPENDENCIES` structural invariants: root domains have no deps, cert_evidence depends on all 6

### Runtime verification — Supabase migration

Migration `20260526001_utv2_1096_certification_records.sql` applied via MCP `apply_migration`:
```
success: true
```

Objects created:
- Enums: `certification_domain`, `certification_status`, `revocation_trigger`
- Tables: `certification_records` (append-only + immutability triggers), `certification_transition_events` (append-only + immutability triggers)
- View: `current_certification_state` (DISTINCT ON latest per program_id, domain)
- Indexes: `idx_cert_records_program_domain`, `idx_cert_records_status`, `idx_cert_records_predecessor`, `idx_cert_events_domain_occurred`
- Triggers: `certification_records_no_update`, `certification_records_no_delete`, `cert_events_no_update`, `cert_events_no_delete`

TypeScript types regenerated via MCP `generate_typescript_types`:
- `packages/db/src/database.types.ts` updated with `certification_records` (8 references), new enums
- `pnpm --filter @unit-talk/db type-check` exits 0

### Acceptance criteria check

| Criterion | Status |
|---|---|
| `certification_records` table created and migrated | PASS |
| State machine enforced at DB level | PASS — `revoked_requires_trigger` CHECK constraint, immutability triggers |
| All cert domains representable as records | PASS — `certification_domain` enum covers all 7 |
| Type-safe TypeScript bindings generated | PASS — database.types.ts regenerated, type-check clean |
| Pure state machine in `@unit-talk/invariants` | PASS — no I/O, no DB, no HTTP |
| Append-only semantics | PASS — triggers prevent UPDATE/DELETE on both tables |
| Fail-closed gate | PASS — `isCertified()` returns false for null, non-active, or expired |
| Revocation propagation | PASS — `computePropagation()` recursive with dedup, dependency_revoked trigger |
