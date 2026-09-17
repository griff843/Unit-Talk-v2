# PROOF: UTV2-1926

MERGE_SHA: 09326d5531a859961654970f1cf1ff78beaf0247

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-17T15:05:00Z
Issue: UTV2-1926
Tier: T1
Lane type: governance
Branch: claude/utv2-1926-merge-gate-bounce-field
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1596
Head SHA: 43888904f76fa0ba1c361e3922fc5305462ff4cb
result: pass

## ASSERTIONS:

- [x] A `CHANGES_REQUIRED` verdict with no `Bounce:` field does not count toward the bounce limit — `docs/05_operations/schemas/pm-verdict-v1.md` validation rule 6 makes that field required and numeric, so a comment without it is not a valid bounce declaration.
- [x] A malformed `Bounce:` value does not count. Measured across five shapes: `two`, `2 of 3`, `-1`, `1.5`, `one`.
- [x] A valid `Bounce: 1` is accepted and does not trip the limit.
- [x] A valid `Bounce: 2` is accepted and does not trip the limit.
- [x] A valid `Bounce: 3` trips Failed / PM triage, with the error naming the declared value and the triage destination, exactly as the canonical Bounce Limit section specifies.
- [x] Bounce state is derived from the explicit `Bounce:` field, never from the lifetime count of CHANGES_REQUIRED-shaped comments — nine authorized `Bounce: 1` verdicts never trip the limit, and one `Bounce: 3` does.
- [x] Bounce state is the declared MAXIMUM, not the latest declaration: a `Bounce: 1` posted after a `Bounce: 3` does not reset the freeze.
- [x] Bot and non-CODEOWNERS verdicts remain ignored — an unauthorized comment declaring `Bounce: 3` counts for nothing, and the trust filter still runs before latest-verdict selection.
- [x] Exact-PR and exact-head APPROVED validation is unchanged: stale head, PR mismatch and missing `Head SHA:` all still fail, with the same messages, after the same three-comment history.
- [x] An invalid `CHANGES_REQUIRED` still BLOCKS, via the untouched latest-verdict rule. Narrowing the freeze did not become a fail-open — every no-Bounce and malformed-Bounce case asserts the `not "APPROVED"` refusal is still raised.
- [x] Historical PR comments are untouched. The repair reads them; nothing in this lane edits, deletes or re-posts a PM verdict comment.
- [x] The regression tests are not vacuous: replayed against the pre-repair module at this branch's base, **10 of them fail**, including #1592's exact shape.
- [x] Replaying PR #1592's REAL comment bodies read-only through both modules reproduces the live `Merge Gate` failure before the repair and removes only the phantom error after it.
- [x] No workflow, CODEOWNERS or branch-protection file is touched. `.github/` is untouched; the diff is two script files plus this lane's own governance artifacts.

## EVIDENCE:

Measured on head `43888904f76fa0ba1c361e3922fc5305462ff4cb` in the lane worktree.

The live defect, from PR #1592's `Merge Gate` check-run `105242746400`, read before any
change (`gh api repos/griff843/Unit-Talk-v2/check-runs/105242746400`):

```
Merge Gate: BLOCKED
**Merge blocked:**

- Most recent PM verdict is "CHANGES_REQUIRED", not "APPROVED".
- Bounce limit exceeded (3 CHANGES_REQUIRED verdicts). Issue should be moved to Failed for PM triage.
- T1 requires "t1-approved" label on the PR. PM must apply this label after review.
```

Gate results on this head:

```
$ pnpm type-check
exit 0

$ pnpm lint
exit 0

$ pnpm test
# tests 6432
# pass  6432
# fail  0
exit 0

$ npx tsx --test scripts/ops/merge-gate-verdict.test.ts
# tests 33
# pass  33
# fail  0
exit 0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 5
Rules matched: (none) — no R-level artifacts required for this diff
exit 0

$ pnpm verify
not runnable on this host — ci:assert-staging-target refuses a workstation with no staging
credential. Its execution site is the required `verify` check on this PR, and the live-DB
half is the `Writable DB proof (staging only)` job, per this lane's
t1_live_db_precondition: deferred_to_ci.
```

### The inversion that makes the new tests meaningful

The same 33-test suite, run against the module as it stands at this branch's base commit
(`git show HEAD~1:scripts/ops/merge-gate-verdict.cjs`), with the tests unchanged:

```
not ok 21 - UTV2-1926: parseVerdict extracts a numeric Bounce field
not ok 22 - UTV2-1926: parseVerdict yields a null bounce for absent or malformed fields
not ok 23 - UTV2-1926 R1: CHANGES_REQUIRED without a Bounce field does not count toward the limit
not ok 24 - UTV2-1926 R2: a malformed Bounce field does not count toward the limit
not ok 27 - UTV2-1926 R5: a valid bounce 3 trips Failed / PM triage
not ok 28 - UTV2-1926 R5: a declared bounce above 3 also trips
not ok 29 - UTV2-1926 R6: bounce state is the declared maximum, not the latest declaration
not ok 30 - UTV2-1926 R6: many CHANGES_REQUIRED comments at bounce 1 never trip the limit
not ok 32 - UTV2-1926: the #1592 shape -- three bounce-less CHANGES_REQUIRED then an exact-head APPROVED passes
not ok 33 - UTV2-1926 R8: exact-PR and exact-head APPROVED validation is unchanged by the repair
# tests 33
# pass  23
# fail  10
```

Ten of the thirteen new assertions fail without the repair. The three that pass without it
(`R3` bounce 1, `R4` bounce 2, `R7` unauthorized bounce 3) are the cases the old
implementation happened to get right for the wrong reason, and they are kept as guards
against the repair over-correcting.

### Replay of PR #1592's real comments

Read-only. The 35 comment bodies were fetched with
`gh api repos/griff843/Unit-Talk-v2/issues/1592/comments --paginate` and passed through both
modules. Nothing was posted, edited or deleted.

```
=== BEFORE (main)
  2026-09-17T02:15:51Z griff843/User CHANGES_REQUIRED bounce=undefined pr=1592 head=3c114559...
  2026-09-17T10:47:18Z griff843/User APPROVED         bounce=undefined pr=1592 head=307311d1...
  2026-09-17T10:48:45Z griff843/User CHANGES_REQUIRED bounce=undefined pr=1592 head=307311d1...
  2026-09-17T12:41:56Z griff843/User CHANGES_REQUIRED bounce=undefined pr=1592 head=3a033ca3...
  errors:
    - Most recent PM verdict is "CHANGES_REQUIRED", not "APPROVED".
    - Bounce limit exceeded (3 CHANGES_REQUIRED verdicts). Issue should be moved to Failed for PM triage.

=== AFTER (UTV2-1926)
  (same four verdicts, bounce=null on every one — none declares the field)
  errors:
    - Most recent PM verdict is "CHANGES_REQUIRED", not "APPROVED".
```

The decisive pair. The same real history plus one hypothetical fresh exact-head APPROVED,
appended in memory only and never posted:

```
=== BEFORE (main) + hypothetical fresh APPROVED
  errors:
    - Bounce limit exceeded (3 CHANGES_REQUIRED verdicts). Issue should be moved to Failed for PM triage.

=== AFTER (UTV2-1926) + hypothetical fresh APPROVED
  errors: (none)
```

Before the repair, no PM verdict could ever clear #1592 — the bounce check runs
unconditionally, outside the `latest !== APPROVED` branch, so an APPROVED removed one error
and left the other standing. After the repair a fresh exact-head APPROVED clears it, and
nothing else does. The repair restores PM authority over #1592; it does not exercise it.

## Verification
- [x] `pnpm type-check`: exit 0
- [x] `pnpm test`: exit 0 — 6432 tests, 6432 pass, 0 fail
- [ ] `pnpm verify`: not runnable locally (staging-target assertion); executed by the required `verify` check on this PR
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: Verdict PASS, no R-level artifacts required

## Runtime Verification

The runtime boundary for this defect is the merge gate itself, and it was exercised at that
boundary rather than asserted. `.github/workflows/merge-gate.yml` `require()`s this module
directly in an `actions/github-script` step, so the module's exported behaviour under real
comment input IS the gate's behaviour. The replay above feeds it PR #1592's actual comment
bodies and the live PR context (`prNumber: 1592`, `headSha: daae6b737…`,
`authorizedReviewers: {griff843}`) and reproduces, byte for byte, the
`Bounce limit exceeded (3 CHANGES_REQUIRED verdicts)` string that check-run `105242746400`
emitted on the running gate — then shows it absent after the repair.

That workflow checks out
`${{ (pull_request || pull_request_review) && github.event.pull_request.base.sha || github.sha }}`,
so the gate always executes the BASE copy of this file, never PR-head content. The repair
therefore takes effect for #1592 only once it is merged to `main` and #1592 is synced onto it
— which is the intended sequence and is why this lane is separate from #1592.

The live-DB half of T1 runtime proof is deferred to CI under this lane's
`t1_live_db_precondition: deferred_to_ci`, and is supplied by the `Writable DB proof
(staging only)` job on the merge SHA. It is not fabricated here. This lane touches no
database path: the diff is two files under `scripts/ops/`, neither of which imports a
repository, a Supabase client or `@unit-talk/db`.

## Merge SHA Binding

Merge SHA: 09326d5531a859961654970f1cf1ff78beaf0247
PR: https://github.com/griff843/Unit-Talk-v2/pull/1596
Approved PR head: 75ea74acda50e67648ccfcf178d8b0373c6983cd
Execution SHA: 43888904f76fa0ba1c361e3922fc5305462ff4cb
