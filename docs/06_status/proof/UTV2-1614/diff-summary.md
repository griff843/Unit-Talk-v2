# Diff summary

MERGE_SHA: pending merge

Substantive source binding: `3b3846c37423f3654843db6be99a096def164298`.

## What this PR changes

- `scripts/ops/proof-rebind.ts` — NEW `ops:proof-rebind` CLI: surgical,
  fail-closed SHA rebinding for existing proof bundles, replacing destructive
  template regeneration for the rebind half of the job. Only an explicit
  allowlist of binding regions is writable (top-level `MERGE_SHA:` line, the
  canonical rows of exactly one `## Merge SHA Binding` section, four dotted
  `sha_binding` JSON paths plus per-entry `test_run_logs[].merge_sha`); every
  byte outside those regions is proven unchanged by a masking guard, a
  changed-line guard and an exact byte-delta guard. Per-file atomic replacement
  (temp + fsync + rename + parent-directory fsync), truthful rollback with a
  single-final-checksum partition of `restored_files` vs `possibly_corrupted`,
  idempotent recovery, machine-readable preview/receipt with before/after
  checksums for every file.
  - PR/merge identity is validated against GitHub before any write. The
    identity core is the shared `MergedPrAttestation` shape exported by
    `scripts/ops/proof-schema.ts` (the same record the shipped evidence
    contract and `ops:truth-check` consume), built fail-closed by
    `buildMergedPrAttestation`. The three SHA classes stay distinct:
    execution SHA ≠ approved PR head ≠ merge SHA.
  - HARD GUARD: `--apply` is allowlisted to bundles affirmatively classified
    `static` by the contract's own profile precedence (`declaredProfileForLaneType`
    on the lane manifest's `lane_type` wins; the authored `proof_profile` may
    not conflict). app-runtime, migration, legacy, incident/containment or
    otherwise unmapped lane types, conflicts, unknown profiles and unparseable
    bundles refuse with the named code `proof_rebind_apply_profile_refused`,
    before identity validation, writing zero bytes. Preview never writes.
- `scripts/ops/proof-rebind.test.ts` — 75 tests, every substantive guard locked
  by an adversarial regression asserting its FAIL branch, including CLI-driven
  refusals proven to write zero bytes and a read-only real-bundle preview
  contract over a fixture copy of a merged migration bundle.
- `package.json` — `proof-rebind.test.ts` wired into `test:ops` (merge kept
  both sides' test entries).
- `docs/06_status/proof/UTV2-1614/**` — this lane's own evidence bundle,
  upgraded to schema v2 (`proof_profile: static`, CI-resolved sentinels, no
  self-authored verifier block) with the sixth-iteration narrative and the
  genuine staging `pnpm test:db` TAP from workflow run 32279673068.

## Verification commands

`pnpm type-check`, `pnpm lint`, `pnpm test` (via `pnpm verify:static`, exit 0),
`pnpm verify` (live-db half is CI's `staging-ci` responsibility; the required
`verify` CI context is authoritative), `npx tsx scripts/ci/r-level-check.ts
--base origin/main --head HEAD` → PASS.
