# PROOF: UTV2-1951

MERGE_SHA: d5f976a6f9fbab425d5370eac51c7c4d6c516741
Execution SHA: 513fddf8d01b2b5c03fc5474d7648a0de03343ea

Settlement-recap provenance, grading extraction, and the `deploy/rollback.sh`
command-substitution repair — the runtime slice carved out of the UTV2-1950
Command Center lane. Scope, defect narrative and the carve-out reason are in
diff-summary.md.

## Verification

ASSERTIONS:
- [x] The generated rollback remote script contains the literal text ```docker compose up``` and invokes no docker binary while it is being assembled — measured with a stub `docker` first on `PATH`: 1 invocation before, 0 after.
- [x] `scripts/ci/deploy-config-rollback.test.ts` passes 19/19 with the real Docker Desktop shim still on `PATH`, where it previously failed 5. No `PATH` filtering was needed.
- [x] The new substitution guard is not vacuous: re-introducing the bare backtick fails it (`not ok 31`, `# fail 1`); re-escaping passes (`# pass 31`, `# fail 0`).
- [x] `observeSettlementRecap` persists a `recap.post` run row before the attempt runs — the attempt itself reads the row back and asserts `status = 'running'`, so a run recorded only after the fact fails.
- [x] The three recap outcomes stay distinguishable in the persisted record: `succeeded`, `cancelled` (known refusal, with reason) and `failed` (`recap_request_outcome_unknown`, explicitly not a claim the post did not happen).
- [x] The new credentialed test is registered in both places `pnpm verify` fails closed without: `package.json` `test:t1-proof:live` and `docs/05_operations/db-writer-classification.json`.
- [x] pnpm type-check and pnpm test pass; pnpm lint and pnpm build pass.

EVIDENCE:
```text
pnpm test: 6841 passed, 0 failed
pnpm type-check: exit 0
pnpm lint: exit 0
pnpm build: exit 0
scripts/ci/deploy-config-rollback.test.ts (docker shim on PATH): 19 pass, 0 fail
scripts/ci/staging-path-enforcement.test.ts: 31 pass, 0 fail
scripts/ci/r-level-check.ts --head HEAD: Verdict PASS, 19 changed files, no R-level artifacts required
Substitution guard mutation drill: not ok 31 on mutation, 31/31 on restore
Stub-docker substitution drill: 1 invocation before, 0 after
```

**`pnpm verify` exits 1 locally and cannot do otherwise.** Its `test:live-db`
stage runs `ci:assert-staging`, which refuses any target it cannot identify as
the staging project `xskgrzbteyqdufktjrjx`:

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL
```

That is a structural local refusal, not a lane failure — every stage that can run
outside the staging-ci environment is green, and the authoritative `verify` run
is the one CI executes on this PR. This proof does not claim a green local
`pnpm verify`.

The live-DB proof
(`apps/api/src/t1-proof-utv2-1951-settlement-recap-provenance.test.ts`) is gated
on the approved staging project and runs in CI's staging-only job. It sends no
Discord message: every outcome is simulated in-process and the `posted: true`
case returns a synthetic receipt.

No production write, deployment, ingestion activation, kill-switch change or
member-facing delivery was performed by this lane.

## Merge SHA Binding

Merge SHA: `d5f976a6f9fbab425d5370eac51c7c4d6c516741`
PR: https://github.com/griff843/Unit-Talk-v2/pull/1626
