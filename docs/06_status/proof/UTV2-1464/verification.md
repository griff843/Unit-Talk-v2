# PROOF: UTV2-1464 Verification

Issue: UTV2-1464
Tier: T2
Lane type: verification
Branch: codex/utv2-1464-proof-generate-merge-sha-rebind
MERGE_SHA: 67e0134525fa9e81fdddf88b6f11b0b9662c7d22

The SHA above is the implementation commit; post-merge closeout rebinds proof to the squash-merge SHA via `ops:proof-generate --merge-sha`.

## ASSERTIONS:

- [x] `ops:proof-generate` now emits `verification.md` (the file truth-check C4/P3 and proof gates actually read) instead of the legacy `runtime-verification.md`
- [x] A hand-authored `verification.md` that already carries SHA-binding markers is preserved, not clobbered, on regeneration
- [x] Rebind path (`--merge-sha`) updates SHA references in `evidence.json` and `verification.md`
- [x] `scripts/ops/proof-generate.test.ts` updated to the new artifact name and skip behavior: 20/20 pass
- [x] `pnpm type-check` and root `pnpm test` pass; r-level-check matches no rules for this diff

## EVIDENCE:

Commands run 2026-07-04 from the lane worktree.

```text
pnpm exec tsx --test scripts/ops/proof-generate.test.ts
# tests 20
# pass 20
# fail 0
# skipped 0

pnpm type-check → PASS (tsc -b tsconfig.json, zero errors)
pnpm test → PASS (root aggregate suite)
npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
→ Verdict: PASS; Changed files: 8; no R1-R5 rules matched

npx tsx scripts/ops/proof-generate.ts --issue UTV2-1464 --current --runtime-result pass --json
→ generated docs/06_status/proof/UTV2-1464/{diff-summary.md,verification.md} (self-hosting check)
```

## Verify blocker (environmental, out of scope)

`pnpm verify` fails only in `apps/ingestor/src/t1-proof-utv2-1282-bounded-dedup.test.ts` — a live-data precondition asserting SGO ingestion within a 72h window. The SGO API key has been inactive at the vendor since 2026-06-30 12:41 UTC, so the assertion fails on every branch, including baseline main with this lane's changes stashed. All static verify steps pass and `pnpm test:db` passed before the live-proof step. The failing file is outside this lane's file scope.
