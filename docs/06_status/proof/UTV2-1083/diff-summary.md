# Diff Summary: UTV2-1083 — INIT-1.1.0 Reversible Migration Capability

## Scope

Phase A additive scaffolding. No existing code modified; all changes are net-new files.

## Files Changed (17 files, +1645 insertions)

**Down scripts for existing migrations:**
- `db/migrations-rollback/202605090003_utv2_871_provider_offers_quarantine_prune_fix.down.sql`
- `db/migrations-rollback/202605120001_utv2_883_link_market_universe_participant_ids.down.sql` (IRREVERSIBLE — ratified)
- `db/migrations-rollback/202605130001_utv2_921_audit_log_retention_immutability.down.sql`
- `db/migrations-rollback/202605130002_utv2_920_db_invariant_rpc_guards.down.sql` (IRREVERSIBLE — ratified)
- `db/migrations-rollback/202605140001_utv2_912_market_type_id_alias_backfill.down.sql`
- `db/migrations-rollback/README.md` — convention documentation
- `db/migrations-rollback/irreversible-exemption-registry.json` — PM-ratified exemptions

**CI gate:**
- `scripts/ci/migration-reversibility-gate.ts` — fail-closed reversibility gate (exit 0/1/2)
- `scripts/ci/migration-reversibility-gate.test.ts` — 7 adversarial fixtures
- `scripts/ci/schema-roundtrip-hash.ts` — pg_dump schema hash for round-trip comparison
- `scripts/ci/proof-binding-validator.ts` — schema v2 proof binding validator
- `.github/workflows/migration-reversibility-gate.yml` — presence check + round-trip drill

**Governance lane contract:**
- `.lane/lanes/governance.yml` — add `packages/invariants/**` and `db/migrations-rollback/**` to allowed paths

**Ops/proof:**
- `.ops/sync/UTV2-1083.yml` — per-issue sync metadata
- `docs/06_status/lanes/UTV2-1083.json` — lane manifest (lane_type: governance)
- `docs/06_status/proof/UTV2-1083/evidence.json` — T1 evidence bundle (schema v2)
- `docs/06_status/proof/UTV2-1083/proof.md` — proof narrative
- `docs/06_status/proof/UTV2-1083/verification.md` — pnpm verify + test:db log

## Risk Assessment

- **No runtime code changed.** Gate and hash scripts are CI-only tooling.
- **No DB schema changes.** Down scripts are only executed on rollback, not on deploy.
- **IRREVERSIBLE migrations ratified.** Two existing migrations have `-- IRREVERSIBLE:` markers with PM-ratified exemption records.
- **Gate is fail-closed.** `migration-reversibility-gate.ts` exits 1 on missing/comment-only down scripts; exits 2 on infra errors. Never passes silently.
- **7 adversarial fixtures** verify each negative case produces the correct non-zero exit.
