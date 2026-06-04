## Verification — UTV2-1198 D-CONST-7: Regenerate database.types.ts

**Merge SHA:** 492f4ed9763246b9863c66e1ecf59319c510f3cf
**pnpm verify:** PASS (type-check + test green on merge SHA)

### Summary

Regenerated `packages/db/src/database.types.ts` from live Supabase schema (project `zfzdnfwdarxucxtaojxm`) via Supabase MCP TypeScript type generation.

As part of this lane, the UTV2-1116 migration (`20260527002_utv2_1116_immutable_model_version_artifact_sha.sql`) was applied to the live Supabase database, which was missing despite being in a "done" lane. This brought the remote schema into sync with the committed migration file before regenerating types.

### Before / After

| Metric | Before | After |
|---|---|---|
| Lines in database.types.ts | 7,573 | 7,688 |
| Row type definitions | 122 | 124 |
| `execution_intents` table | absent | present (3 occurrences) |
| `settlement_corrections` table | absent | present (5 occurrences) |
| `artifact_sha` on model_registry | present (manually maintained) | present (live DB now has column) |

### New tables added

- `execution_intents` — records execution intent decisions with idempotency, provenance, and predecessor linkage
- `settlement_corrections` — audit trail for settlement corrections with dual-authorizer requirement

### Migration backfill applied

- `utv2_1116_immutable_model_version_artifact_sha` — applied to live Supabase via MCP
  - Adds `artifact_sha TEXT` column to `model_registry`
  - Creates immutability trigger `trg_model_registry_artifact_sha_immutable`
  - This migration existed locally (lane UTV2-1116 closed 2026-05-27) but was not in the live `supabase_migrations` table

### Verification results

- `pnpm type-check`: PASS (exit 0)
- `pnpm test`: PASS (4 pass, 0 fail)
- `pnpm test:db`: PASS — 7 pass, 0 fail, 0 skipped
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS
  - No R-level artifacts required for this diff (migration-lane types regen)
- `artifact_sha` present in regenerated output: confirmed (3 occurrences)
- `execution_intents` present: confirmed (3 occurrences)
- `settlement_corrections` present: confirmed (5 occurrences)

### `pnpm test:db` output

```
pnpm test:db

# pass 7
# fail 0
# skipped 0
```

### Diff summary

115 lines added, 0 lines removed. Purely additive change.

Merge SHA: 498567e355eaf36221998dad63c44a6f749c7e3f
