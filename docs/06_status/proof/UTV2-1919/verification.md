# PROOF: UTV2-1919

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Issue: UTV2-1919
Tier: T1
Lane type: runtime
Branch: claude/utv2-1919-evidence-settlement-correction
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1589
Head SHA: f9ec8add91c30978a4cc797f4aecac2f09ceafdb
result: pass

## ASSERTIONS:

- [x] An evidence-plane settlement can be corrected at all. Before this lane the second operator grade was written as another *original* (`corrects_id` null), which production's partial unique index `settlement_records_pick_source_idx (pick_id, source) WHERE corrects_id IS NULL` rejects with 23505.
- [x] The original settlement row is never mutated. Asserted twice — in memory by reading it back from `listByPick` after the correction, and against real Postgres by reading the ordered chain back and asserting the root still reads `'win'`.
- [x] A correction creates a NEW settlement row whose `corrects_id` references the **superseded** settlement, not always the original. Asserted pairwise across a three-grade chain, so "always points at the root" fails.
- [x] The latest effective settlement wins at **every** point in the chain, not only at the end: after grade N the effective result is grade N's and `correction_depth` is N-1.
- [x] A 23505 can no longer be swallowed and returned as a fake success. The catch is retained as a genuine race guard and now throws `ApiError(409, SETTLEMENT_ALREADY_RECORDED)`.
- [x] WIN -> LOSS -> WIN produces exactly ONE statistical contribution at each point (`settlementSummary.total_picks === 1`) while the audit trail grows (`total_records === index + 1`).
- [x] Zero member delivery, outbox or execution-intent artifacts are produced by a correction — asserted across all five outbox statuses in memory and as a zero row count on `distribution_outbox` in staging.
- [x] Both repairs are mutation-proven: each one, reverted alone, turns a distinct named test red.
- [x] No containment surface is touched — no `deploy.yml`, compose, `.env`, entrypoint or kill-switch path, zero migrations, zero production writes.

## EVIDENCE:

Measured on head `f9ec8add91c30978a4cc797f4aecac2f09ceafdb` in the lane worktree.

```
$ pnpm exec tsx --test apps/api/src/settlement-service.test.ts
# tests 38
# pass  38
# fail  0
exit 0

$ pnpm test
# tests 6807
# pass  6807
# fail  0
(zero 'not ok' TAP lines across the whole workspace)
exit 0

$ pnpm type-check
exit 0

$ pnpm exec eslint apps/api/src/settlement-service.ts \
    apps/api/src/settlement-service.test.ts \
    apps/api/src/t1-proof-utv2-1904-operator-evidence-settlement.test.ts
exit 0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 9
Rules matched: settlement-grading
Advisory (PM-gated) artifacts missing: r4-fault-report [PM-gated]
exit 0

$ pnpm verify
not runnable on this host — ci:assert-staging-target refuses a workstation with no staging
credential. Its execution site is the required `verify` check on this PR, and the live-DB
half is the `Writable DB proof (staging only)` job, per this lane's
t1_live_db_precondition: deferred_to_ci.
```

### The mutation battery — run alone, restored verifiably

Each mutation was applied to `apps/api/src/settlement-service.ts` by itself, the suite run,
then the file restored byte-for-byte from a pre-mutation copy.

**M1 — drop `...(isCorrection ? { correctsId: priorSettlement.id } : {})` from the write**,
i.e. keep the pre-insert read but write the correction as another root:

```
not ok 36 - UTV2-1919: a second operator grade corrects the first rather than writing a second original
  actual: 'MULTIPLE_ROOT_RECORDS'
not ok 37 - UTV2-1919: WIN -> LOSS -> WIN yields one contribution at each point and never two
# pass 36
# fail 2
```

The in-memory repository does **not** implement the partial unique index — `packages/db/CLAUDE.md`
records this under Known Drift in as many words — so it never throws 23505 and a mutation test
cannot assert on that error here. What it *can* observe is the downstream consequence the index
exists to prevent: `resolveEffectiveSettlement` refuses two root records and returns
`effectiveSettlement: null`. That is why `MULTIPLE_ROOT_RECORDS` is a real discriminator rather
than a restatement of the code. The race test stayed green, correctly — it does not depend on
linkage.

**M2 — restore main's exact pre-lane 23505 catch body** (re-read `findLatestForPick` and
return it as this request's `settlementRecord` with `auditRecords: []`):

```
not ok 38 - UTV2-1919: a duplicate-key race is refused, never reported as a successful settlement
# pass 37
# fail 1
```

The other 37 pass, which is the point: before this lane nothing in the repository failed on that
behaviour.

**Correction to the earlier record (2026-09-23).** Re-running M2 at the resynced head showed the
race test was weaker than first recorded: its stub returned `null` from *every*
`findLatestForPick` call, so the fake-success branch could never find a row, and the mutant failed
only because the raw 23505 message did not match the expected pattern. Commit `f9ec8add9` makes
only the pre-insert read miss — every later read sees the other writer's row, as in the real race —
so the mutant now **resolves** with that row and the test fails for the reason it names.

**Restored:**

```
# tests 38
# pass  38
# fail  0
```

## Verification
- [x] `pnpm type-check`: exit 0
- [x] `pnpm test`: exit 0 — 6807 tests, 6807 pass, 0 fail
- [ ] `pnpm verify`: not runnable locally (staging-target assertion); executed by the required `verify` check on this PR
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: Verdict PASS; the one advisory artifact is PM-gated and not required

## Runtime Verification

The live-DB half of T1 runtime proof is deferred to CI under this lane's
`t1_live_db_precondition: deferred_to_ci`, and is supplied by the `Writable DB proof
(staging only)` job on the merge SHA against staging `xskgrzbteyqdufktjrjx`. It is **not**
fabricated here: `runtime_proof.status` in `evidence.json` reads `PENDING_CI` and is
populated at closeout by `autoHarvestCiDbProofIntoEvidence`.

This lane extends the already-wired `t1-proof-utv2-1904-operator-evidence-settlement.test.ts`,
which `test:t1-proof:live` already invokes, with a third test that does what the in-memory suite
structurally cannot: it submits three operator grades on one real Track Only pick through
`submitPickController` against real PostgREST, reads the chain back ordered by `created_at`, and
asserts that **exactly one** of the three rows has `corrects_id IS NULL`. It is the live partial
unique index that permits the second and third rows only because they carry `corrects_id`; a
second canonical row would have been rejected by Postgres before the test could count it. It also
asserts the pairwise linkage, that the original still reads `'win'` after two later grades, that
the effective settlement is the tip at `correction_depth 2` with `total_picks === 1`, that
`picks.status` is still `'validated'`, that zero `pick_lifecycle` rows carry `to_state='settled'`,
and that `distribution_outbox` holds zero rows for the pick.

The three tests fail locally with `Failed to find pick by idempotency key: TypeError: fetch failed`
— and so do the two pre-existing tests in the same file, identically, which is how that was
confirmed environmental rather than a defect: the containment placeholder `SUPABASE_URL` is
unreachable from this workstation.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1589
Approved PR head: pending merge
Execution SHA: f9ec8add91c30978a4cc797f4aecac2f09ceafdb
