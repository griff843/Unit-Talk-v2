# PROOF: WORK-2026101203 — Verification

MERGE_SHA: pending merge

> This is pre-merge evidence. The authorized post-merge path binds the merge SHA;
> no merge, production apply, deployment, or provider/delivery activation is claimed.

Issue: WORK-2026101203
Tier: T1
Lane type: migration
Proof profile: migration
Execution SHA: `7791bcbaf9e0fa8e6ea3df43726b6ed4cc733fd6`
result: static_pass_runtime_deferred_to_staging_ci

## ASSERTIONS:

- [x] The frozen official roster contains exactly 15 current 2026 franchises,
      with 7 Eastern and 8 Western teams; Cleveland (2028), Detroit (2029), and
      Philadelphia (2030) are explicitly reconciled as future expansion.
- [x] The migration creates the WNBA sport and league plus all 22 team-market IDs
      in the existing client taxonomy, using existing market-type identities.
- [x] Participant IDs are deterministic UUIDv5 values; reruns preserve compatible
      rows and refuse external-ID, governed-UUID, and ambiguous-name conflicts.
- [x] The rollback locks its targets and refuses participant, league, or sport
      references before deleting the exact governed catalog.
- [x] The staging proof refuses locally before opening a database client.
- [ ] Hosted exact-head migration reversibility, Proof Coverage Guard, writable
      staging proof, and `verify` are pending required CI receipts.

## EVIDENCE:

Official source reconciliation captured 2026-10-12:

```
WNBA FAQ: current teams=15 sha256=b4124bf1bbc8e48490f38f619e4c26c137ea111e86b78c08cf8b1c5a4890accf
WNBA expansion announcement: future teams=3 sha256=56001219ea0aa25f9ccb78f7bcdc5abf75ac61b90411c0bb4d02685b959fcc43
Catalog: sport=1 league=1 availability=22 participants=15
```

## Verification

- `pnpm exec tsx --test packages/db/src/canonical-reference-schema.test.ts`:
  PASS (30 tests; 28 pass, 0 fail, 2 expected local scratch-Postgres skips).
- `pnpm exec tsx --test scripts/ci/participant-catalog-seed-drill.test.ts scripts/ci/migration-reversibility-gate.test.ts scripts/ci/proof-coverage-guard.test.ts`:
  PASS (32 tests; 22 pass, 0 fail, 10 expected local Postgres skips).
- `pnpm --filter @unit-talk/db type-check`: PASS.
- `pnpm verify:static`: PASS, including lint, type-check, build, aggregate tests,
  Smart Form verification, migration version checks, and migration lint.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS;
  9 changed files at the measured source head and no R-level rules matched.
- `pnpm test:db`: correctly REFUSED before mutation because the local target
  resolved to `127.0.0.1/unidentified`, not staging project `xskgrzbteyqdufktjrjx`.
- `pnpm exec tsx packages/db/src/scripts/work-2026101203-wnba-reference-catalog-proof.ts`:
  correctly REFUSED at the same target-identity guard before reading a DB URL or
  starting `psql`.
- `pnpm verify`: all static work passed; its final writable live-DB phase correctly
  REFUSED at `ci:assert-staging` in this containment-isolated worktree.

Writable live-DB proof is blocked/deferred: target identity could not be resolved
from its URL (host=unparseable). Writable DB verification requires
xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with
CI_SUPABASE_* credentials.

The implementation tree verified before the governance-only model-routing rebase
is byte-identical to execution SHA `7791bcbaf9e0fa8e6ea3df43726b6ed4cc733fd6`.
No production database or runtime target was mutated.

## Merge SHA Binding

Merge SHA: pending merge
PR: #1744
Execution SHA: 7791bcbaf9e0fa8e6ea3df43726b6ed4cc733fd6
