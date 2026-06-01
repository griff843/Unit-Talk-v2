# Diff Summary: UTV2-1088 — INIT-1.3.1 Machine-Readable Invariant Registry Substrate

**Merge SHA:** 2194b018fab116ad803a8b967b4b3fc9173cf4b6 (PR #830)

## Scope

Phase A additive scaffolding. No existing code modified; all changes are net-new files.

## Files Changed (22 files, +1535 / -12)

**New package — `@unit-talk/invariants`:**
- `packages/invariants/package.json` — new package declaration
- `packages/invariants/tsconfig.json` — TypeScript config
- `packages/invariants/src/index.ts` — package barrel export
- `packages/invariants/src/types.ts` — shared type re-exports
- `packages/invariants/src/registry/invariant-registry.json` — 15 invariants (INV-0001..INV-0015)
- `packages/invariants/src/registry/id-ledger.json` — append-only ID allocation ledger
- `packages/invariants/src/registry/source-manifest.json` — PM-ratified source crosswalk
- `packages/invariants/src/registry/loader.ts` — typed registry loader

**Contracts package:**
- `packages/contracts/src/invariant-registry.ts` — `InvariantRegistryEntry` type contract
- `packages/contracts/src/index.ts` — re-export of `InvariantRegistryEntry`

**CI gate:**
- `scripts/ci/invariant-registry-gate.ts` — fail-closed registry gate (exit 0/1/2)
- `scripts/ci/proof-binding-validator.ts` — schema v2 proof binding validator
- `.github/workflows/invariant-registry-gate.yml` — blocking CI workflow

**Workspace config:**
- `tsconfig.json` — add `packages/invariants` to project references
- `pnpm-lock.yaml` — lockfile update for new package

**Governance lane contract:**
- `.lane/lanes/governance.yml` — add `packages/invariants/**` and `db/migrations-rollback/**` to allowed paths

**Ops/proof:**
- `.ops/sync/UTV2-1088.yml` — per-issue sync metadata
- `docs/06_status/lanes/UTV2-1088.json` — lane manifest
- `docs/06_status/proof/UTV2-1088/evidence.json` — T1 evidence bundle (schema v2)
- `docs/06_status/proof/UTV2-1088/proof.md` — proof narrative
- `docs/06_status/proof/UTV2-1088/verification.md` — pnpm verify + test:db log

## Risk Assessment

- **No runtime code changed.** New package is pure types + stateless loader.
- **No DB changes.** No migrations.
- **Additive only.** Existing packages untouched except for type re-export in `contracts/src/index.ts`.
- **Gate is fail-closed.** `invariant-registry-gate.ts` exits 1/2 on violations — never passes silently.
