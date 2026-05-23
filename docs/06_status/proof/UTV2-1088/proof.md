# Proof: UTV2-1088 — INIT-1.3.1 Machine-Readable Invariant Registry Substrate

## Summary

Phase A additive scaffolding for the constitutional invariant registry. Deliverables:

- `packages/invariants/src/registry/invariant-registry.json` — 15 invariants (INV-0001..INV-0015)
- `packages/invariants/src/registry/id-ledger.json` — append-only ID allocation ledger
- `packages/invariants/src/registry/source-manifest.json` — PM-ratified source crosswalk
- `packages/invariants/src/loader.ts` — typed registry loader
- `packages/contracts/src/invariant-registry.ts` — `InvariantRegistryEntry` type contract
- `scripts/ci/invariant-registry-gate.ts` — fail-closed CI gate (exit 0/1/2)
- `.github/workflows/invariant-registry-gate.yml` — blocking CI check

Schema v2 proof binding:
- `verified_source_sha`: `7ece212e447fedefc9e69408c5b39d89a980c820`
- Last substantive commit: ledger mutation detection + fresh-ratification binding
- Post-substantive commits: evidence.json only (verified by proof-binding-validator)

## Evidence

```text
pnpm verify: PASS (lint + type-check + build + test — all packages)

pnpm test:db: 7/7 PASS (live Supabase)

invariant-registry-gate local run:
  invariant-registry-gate
    base: origin/main
    registry hash: 45cf55bf7903336ccfeeef6311028def49b7e192211fad87b9b69625784ac78b
    invariants: 15 total, 15 active
  invariant-registry-gate: PASS

Gate rules enforced:
  - Closed-schema: unknown fields in registry/ledger/manifest exit 1
  - Ledger allocation: every registry ID must have a ledger entry
  - Source-manifest coverage: bidirectional (registry→manifest and manifest→registry)
  - Append-only ledger: deletion exits 1; mutation of title/allocated_at exits 1
  - Fresh ratification: registry/ledger content change requires updated ratification_ref + ratified_at
  - Mechanical enforcement: active invariants must have a non-governance enforcing layer

proof-binding-validator (schema v2):
  verified_source_sha: 7ece212e447fedef...
  evidence_commit_sha: e218cf06edeb0648... (resolved by CI from git log)
  current_pr_head_sha: (resolved by CI from GITHUB_SHA at runtime)
  proof-binding-validator: PASS
```

## Verification

Binding integrity: `verified_source_sha` `7ece212e` is an ancestor of PR head. All commits
between `verified_source_sha` and HEAD touch only `docs/06_status/proof/UTV2-1088/evidence.json`
— verified mechanically by `scripts/ci/proof-binding-validator.ts`.

Gate correctness: local adversarial checks confirmed —
- Deleting INV-0001 from ledger: exits 1 (ledger-deletion)
- Mutating INV-0001.title: exits 1 (ledger-mutation)
- Registry change without fresh ratification: exits 1 (fresh-ratification)
- Unknown field in registry entry: exits 1 (unknown-field)
- Manifest entry without registry counterpart: exits 1 (source-manifest-orphan)

Source manifest: 15 entries, ratified_by griff843, ratified_at 2026-05-22,
ratification_ref "UTV2-1088 / INIT-1.3.1 Phase A PM ratification".
