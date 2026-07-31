# PROOF: UTV2-1613

MERGE_SHA: 1a533cbf0057ab2543813f25f16660c9e2189308

<!--
  Pre-merge: this is the implementation commit SHA on this PR's own branch
  (an ancestor of / identical to the PR head, as executor-result-validator.yml
  requires). Post-merge, ops:proof-generate --merge-sha rebinds this to the
  actual squash-merge commit SHA on main, matching this repo's standard
  proof-binding convention.
-->

## Summary

`scripts/ops/lane-close.ts`, on the `--repair-merged` path, synthesized a
`truth_check_history` entry with `verdict: "pass"`, `failures: []` and
`runner: "ops:lane-close --repair-merged"` **before** the canonical
truth-check ran, and wrote it unconditionally — including when the proof
bundle was invalid and the close was about to be refused. In the manifest
that entry is indistinguishable from a measured pass, and its runner is
outside the canonical `TruthCheckHistoryEntry['runner']` union, so it is
attributed to a runner that does not exist.

This lane removes the fabrication and replaces the conflated record with an
explicit three-way separation:

1. **inferred merge binding** — what GitHub says about the PR (which PR,
   which head ref, which merge commit);
2. **proposed tracked-file repair** — the manifest content that would be
   written, with hashes of the state it was computed from;
3. **measured truth-check outcome** — what `runTruthCheck()` actually
   returned when it actually ran, or an explicit `executed: false` receipt
   when it did not run at all.

A `verdict: "pass"` record is reachable from exactly one input: a receipt
that executed and exited 0. `truthHistoryEntryForMeasuredReceipt()` is the
only history-entry constructor and returns `null` for an unexecuted receipt.

The lane also fixes the non-idempotent, self-poisoning closeout measured on
the live system, and adds automatic ghost-lock release.

**A second fabrication site was found and fixed.** While independently
repairing a sibling lane's post-merge closeout, the PM found that
`scripts/ops/lane-manifest.ts`'s `record-merge` command
(`applyPrMergeToManifest`) unconditionally wrote a `truth_check_history`
entry with `verdict: "pass"`, `failures: []` and `runner: "manual"` — the
same defect class, from a different call site, with no truth-check running
anywhere in that path either. Because `"manual"` IS a canonical runner value,
a runner-union check alone cannot distinguish it from a genuine manually-
recorded pass. `record-merge` now binds only status/commit_sha/pr_url/
heartbeat_at and never touches `truth_check_history`.

**This lane's own diff was also adversarially self-reviewed** before
requesting merge, and five findings were fixed: a vacuous title-or-branch
identity check on the newly-introduced PR-inference path (in both
`lane-close.ts` and `reconcile.ts`), a missing origin/main reachability check
on that same path, a dead authority-drift check in the repair-packet CLI
(the option was never wired to a real implementation), a `reopened` manifest
being silently eligible for the ghost rule (risking erasure of a genuine
detected regression), and a failed repaired close persisting stale
pre-run history instead of the just-measured failure. Details and tests for
each are in section 9 below.

This is implementation and mechanical-measurement evidence. It does not
claim any production deployment, database mutation, secret change, or
readiness certification.

## Assertions

ASSERTIONS:

- [x] `--repair-merged` appends nothing to `truth_check_history`. The only
      writer on that path is the real `runTruthCheck()` call.
- [x] An unexecuted truth-check yields no history entry at all (`null`),
      not an optimistic placeholder.
- [x] A failed or `infra_error` truth-check records the measured failure
      with its real `failures[]`, never a pass.
- [x] A pass is recorded only when the receipt executed **and** exited 0; a
      `verdict: "pass"` with a non-zero exit code is treated as not-a-pass.
- [x] The exact string `ops:lane-close --repair-merged` is rejected at
      runtime by `assertCanonicalRunner()`, and the canonical union is
      asserted at the manifest write boundary in `finalizeLaneCloseManifest`.
- [x] Repair packets (schema v2) carry the exact command, timestamp, input
      manifest hash, candidate repaired-state hash, selected PR / head ref /
      merge SHA, check IDs and exit code.
- [x] Applying a packet fails closed on input drift, packet tampering, or
      changed GitHub merge authority; an unresolvable PR is treated as
      changed authority, not as agreement. A refused apply writes nothing.
- [x] UTV2-1592 is encoded as a regression fixture: a repair against an
      invalid proof bundle produces a packet in which no field serialises a
      passing verdict.
- [x] The historical-certification flow (an already-merged lane repaired
      with no truth-check execution) applies the binding, lands at `merged`,
      and cannot inherit a pass or reach `done`.
- [x] A successful normal close releases the issue lease idempotently.
- [x] A second invocation on a closed lane is a clean no-op: no active
      lease, no merge lock created, `closed_at` not rewritten.
- [x] A failed truth-check releases no authority and does not mark the lane
      Done; the manifest's latest entry is the measured failure, and
      `classifyTruthCheckAuthorization` classifies it as drift, refusing to
      promote it.
- [x] Re-closing an already-`done` lane no longer raises spurious
      `truth_check_drift`, while a different merge SHA, a non-terminal
      manifest, and a failing latest entry all remain drift.
- [x] This lane's own orphaned-pid merge lock is reaped instead of
      compounding; another lane's lock and a merely-expired lock with a live
      owner are never reaped.
- [x] A run that gives up releases the merge lock it acquired for itself; a
      pre-existing lock it did not acquire is left untouched.
- [x] `releaseCloseoutLocks` warns rather than throwing when the live merge
      lock belongs to another lane, and never releases it.
- [x] A manifest in a lock-holding status whose PR is merged is reconciled
      to `merged` with its `commit_sha` bound, releasing its file-scope and
      concurrency locks — and is never advanced to `done`.
- [x] Existing fabricated history entries are inventoried, not deleted.
- [x] No production write, deployment, restart, or deletion was performed by
      this lane.

## Verification

EVIDENCE:

### 1. The defect, and its removal

The fabricated record previously written by `scripts/ops/lane-close.ts` on
the repair path:

```json
{
  "checked_at": "<now>",
  "verdict": "pass",
  "merge_sha": "<pr merge sha>",
  "failures": [],
  "runner": "ops:lane-close --repair-merged",
  "source": "github_pr_merge_commit_repair"
}
```

That block is deleted. Three tests in `scripts/ops/lane-close.test.ts` that
previously asserted the fabricated entry existed were updated to assert its
absence, each with a comment naming what it used to encode.

### 2. Canonical suites

Command:

```text
npx tsx --test scripts/ops/lane-close.test.ts scripts/ops/lane-close-repair-packet.test.ts scripts/ops/truth-history-audit.test.ts scripts/ops/reconcile.test.ts
```

Result:

```text
# tests 181
# suites 0
# pass 181
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Breakdown: `lane-close.test.ts` 141 (128 pre-existing, all still passing,
plus 13 new), `lane-close-repair-packet.test.ts` 19,
`truth-history-audit.test.ts` 7, `reconcile.test.ts` 14.

### 3. Full unit suite

Command:

```text
pnpm test
```

Result, aggregated across all suites on the `origin/main`-rebased head:

```text
TOTAL tests 4075 pass 4075 fail 0
```

### 4. Static gates

```text
pnpm lint         # clean, no errors
pnpm type-check   # tsc -b, clean
```

### 5. Live inventory of fabricated history entries

Existing fabricated entries are **not** deleted by this lane. Deleting them
would repeat the mistake that created them: a tool silently rewriting the
governance record with no PR and no reviewable diff. `ops:truth-history-audit`
is strictly read-only and exits 0 even when it finds fabrications.

Command:

```text
pnpm ops:truth-history-audit
```

Measured on the rebased head:

```text
scanned_manifests:       647
affected_manifests:      188
fabricated_pass_count:   181
```

Findings by runner:

```text
ops:lane-close --repair-merged   181   fabricated_repair_pass
manual-reconciliation             21   non_canonical_runner
<runner field absent>             19   non_canonical_runner
post-merge-lane-close             13   non_canonical_runner
manual-backfill                   10   non_canonical_runner
manual-close                       6   non_canonical_runner
operator                           4   non_canonical_runner
pm                                 1   non_canonical_runner
```

Every one of the 181 fabricated passes carries the repair runner and
`verdict: "pass"`. A second, previously unreported population exists: 55
entries under five other non-canonical runners, plus 19 entries with no
`runner` field at all — including 13 written by `post-merge-lane-close`.
Those are recorded here for triage; correcting them is out of this lane's
scope.

The count rose from 180 to 181 between the start of this lane and its
rebase, because the defective path was still writing new fabricated entries
on `main` throughout.

### 6. Ghost lanes reconciled — real cases, mechanically

Both live ghost manifests were reconciled by the new `ops:reconcile` ghost
rule, not by hand.

Detection (dry run, whole board):

```text
$ pnpm ops:reconcile --json
manifests: 647 total, 31 active

ghost_merged  UTV2-1553  PR .../pull/1322 is merged (965872d378caa3e88ef4987f8bbb0bab0214856e)
                         but manifest status is "started"
ghost_merged  UTV2-1590  PR .../pull/1309 is merged (67f26057b7e35eff928a1b7c5e71084da5a67e1a)
                         but manifest status is "in_review"
```

Applied to the one whose manifest this PR may carry:

```text
$ pnpm ops:reconcile --apply --issue UTV2-1590
[GHOST-MERGED] status -> merged, commit_sha bound, locks released
verdict: MUTATIONS_APPLIED
```

Resulting manifest change: `status: in_review -> merged`,
`commit_sha: null -> 67f26057b7e35eff928a1b7c5e71084da5a67e1a`, and one
appended entry with `verdict: "fail"`, `runner: "ops:reconcile"` recording
why. It is **not** `done`, and `closed_at` stays `null`.

The second ghost is covered under Known Gaps below.

### 7. Two findings that block the obvious repair path

**`ops:lane-close --repair-merged` cannot load either ghost manifest.**
The stranded manifest has `file_scope_lock: []`, which `validateManifest`
rejects, so `readManifest` throws before any repair logic runs:

```text
$ npx tsx scripts/ops/lane-close.ts UTV2-1590 --repair-merged
{"ok": false, "code": "infra_error",
 "message": "docs/06_status/lanes/UTV2-1590.json: file_scope_lock must contain at least one file"}
```

A lane manifest can therefore be written in a state that every tool going
through `readManifest` refuses to read. This is why the ghost release lives
in `ops:reconcile` (which reads manifests without validating) rather than in
`lane-close` alone.

**A ghost lane blocks the PR that would fix it.**
`scripts/ci/file-scope-guard.ts` resolves a manifest that already exists on
the base branch from the *base* copy, so a PR that reconciles a ghost is
still evaluated against the ghost's stale, lock-holding content. This is a
genuine bootstrap deadlock, and it is why the automatic release was built
into the scheduled reconciler, which runs on `main` rather than through a
lane PR.

### 8. Deliberate non-changes

**`scripts/ci/file-scope-guard.ts` was not modified.** The obvious extension
— treat any manifest with a non-null `commit_sha` as non-blocking — would
*widen* what stops holding locks, based on a field a live lane can
legitimately set mid-flight. The guard is offline and cannot ask GitHub
anything, so it has no sound signal of its own. Moving ghosts to `merged`
(already outside both `ACTIVE_LOCK_STATUSES` and the guard's
`LOCK_CONFLICT_STATUSES`) achieves the release without weakening the guard.

**The concurrency caps in `docs/governance/CONCURRENCY_CONFIG.json` were not
raised.** `checkConcurrencyLimits` already counts only
`ACTIVE_LOCK_STATUSES`, so `merged` and `done` manifests consume no slot;
the measured starvation came from ghost lanes sitting in active statuses,
which the reconciler now clears. Adding a literal reserve would widen the
caps to work around a problem that no longer exists. Flagged for PM: if a
literal reserved control-plane allocation is still wanted, it should be its
own governance change rather than a side effect of this one.

**The ghost release does not assume the local manifest set is the true
active set.** It only ever transitions a manifest it can see from an active
status to `merged`, and only when GitHub independently confirms the merge. A
lane whose manifest exists solely on its own PR branch is invisible to a
`main` checkout and is correctly left alone — it is live, not a ghost.

### 9. Second fabrication site, and this lane's own adversarial self-review

**`lane-manifest.ts` `record-merge`.** `applyPrMergeToManifest` fabricated
`{ verdict: "pass", failures: [], runner: "manual", source:
"github_pr_merge_commit" }` purely from "GitHub reports this PR merged" —
no truth-check runs in this function at all. Fixed the same way as the
primary defect: the function now binds only `status`/`commit_sha`/`pr_url`/
`heartbeat_at`; `truth_check_history` passes through completely untouched,
including any pre-existing legacy entries (verified by
`scripts/ops/lane-manifest.test.ts`, updated tests: *"records merge SHA, PR
URL, heartbeat, and status -- but no truth_check_history entry"*, *"never
touches pre-existing truth_check_history, including a legacy fabricated
entry"*, *"starting from empty history stays empty"*).

**Five findings from adversarially self-reviewing this lane's own diff**,
each with a regression test:

1. `selectInferredMergedPr` accepted `issuePattern.test(title) ||
   issuePattern.test(branch)`. Since a conforming lane branch already embeds
   its issue ID by this repo's `BRANCH_PATTERN` convention, the branch arm
   made the title check vacuous — the real gate was `headRefName === branch`
   alone, which a stale/reused branch name could satisfy for an unrelated PR.
   Fixed to require a genuine title match. Test: *"a matching branch name is
   never accepted as a stand-in for a real title match"*.
2. `reconcile.ts`'s `resolveMergedPrForLane` had the identical gap in its
   own branch-inference fallback (used when a manifest has no `pr_url`);
   fixed to require the same title match, only when that fallback is the one
   in use (an explicit `pr_url` lookup needs no such check — its identity is
   already anchored by the manifest).
3. The inferred-PR repair path had no `origin/main` reachability check,
   unlike the sibling explicit `--pr` path (`isMergeShaReachableFromMain` in
   `validateTrustedPostMergeRepair`). Added as defense in depth. Test: *"repair
   refuses an inferred PR whose merge SHA is not reachable from origin/main"*.
4. `reconcile.ts`'s ghost rule was eligible for `reopened` manifests. A
   manifest only reaches `reopened` from a genuine detected regression on a
   previously-`done` lane (which already has a merged `pr_url`) — so every
   `reopened` lane would deterministically match the ghost rule, and this
   unattended, scheduled, `contents:write` job would silently overwrite that
   signal with a generic `merged` status. `GHOST_ELIGIBLE_STATUSES` now
   excludes `reopened` explicitly. Test: *"a reopened lane is never eligible
   for the ghost rule"* — asserts `resolveMergedPr` is not even called.
5. `applyRepairPacket`'s GitHub-authority-drift check only runs when the
   caller supplies `fetchMergeAuthority`, and the CLI's only real call site
   never did — making the check dead code in every actual `pnpm
   ops:lane-repair-packet apply` invocation. Wired a real `gh`-backed
   implementation into the CLI.
6. A failing repaired close persisted the merge binding using
   `repairedManifest.truth_check_history`, which is the STALE array captured
   *before* `runTruthCheck()` ran. The real failing entry `runTruthCheck` had
   written was correctly discarded by the transaction rollback — but writing
   the stale manifest back afterward then permanently lost that measured
   failure, contradicting this proof's own stated invariant ("records the
   measured failure; nothing records a pass"). Extracted as
   `manifestForFailedRepairClose` and unit-tested directly: *"a failed
   repaired close persists the measured failure, not the stale pre-run
   history"*, *"is a no-op when the receipt never executed"*.

Re-run after all six fixes:

```text
$ npx tsx --test scripts/ops/lane-close.test.ts scripts/ops/lane-close-repair-packet.test.ts \
  scripts/ops/reconcile.test.ts scripts/ops/lane-manifest.test.ts scripts/ops/truth-history-audit.test.ts
# tests 195  # pass 195  # fail 0

$ pnpm test
TOTAL tests 4081 pass 4081 fail 0

$ pnpm lint          # clean
$ pnpm type-check    # clean
```

### 10. Post-merge runtime-proof repair (governed follow-up PR)

PR #1339 merged as `1a533cbf0057ab2543813f25f16660c9e2189308`, but the
automated post-merge closeout correctly refused to close the lane: this
bundle's `static_proof` was fully populated (lint, type-check, 195/4081
tests) but had no `runtime_proof` section at all, so `ops:lane-close`'s
unconditional T1 gate failed C6/P7/P9/R1/R2 -- exactly as designed. This
lane's diff (`lane-close.ts`, `lane-close-repair-packet.ts`,
`lane-manifest.ts`, `reconcile.ts`, `truth-history-audit.ts`) touches no
database path, but that does not exempt it: **every** pull request in this
repo runs `ci.yml`'s `staging-db-proof` job, and PR #1339's own head
(`bda21ecac6c5ae4f17683cddf25bd90bf0ca0c84`) did execute `pnpm test:db`
against staging, producing a `ci-db-proof-receipt/v2` that was simply never
folded into this bundle. That omission is corrected here, following the
identical precedent set by UTV2-1631/PR #1335.

Command:

```text
$ pnpm ops:proof-generate UTV2-1613 --merge-sha 1a533cbf0057ab2543813f25f16660c9e2189308 --pr https://github.com/griff843/Unit-Talk-v2/pull/1339 --json
{"ok":true,"code":"proof_generated", ..., "rebound_paths":["docs/06_status/proof/UTV2-1613/verification.md","docs/06_status/proof/UTV2-1613/evidence.json"]}

$ pnpm ops:proof-repair apply --issue UTV2-1613 --merge-sha 1a533cbf0057ab2543813f25f16660c9e2189308 \
  --runtime-proof-file <harvested-from-CI-receipt>.json \
  --verifier-identity "github-actions/CI — run 30661777017, job 91259566906 (staging-db-proof, producer) and job 91260945152 (verify, independent receipt verifier)" \
  --manifest-created-by claude
{"ok":true,"code":"repaired", ...}
```

Nothing was re-executed locally -- there are no staging credentials on this
host, and `ci:assert-staging` correctly refuses outside CI. Every field under
`runtime_proof` and `verifier` was read back from:

- the `ci-db-proof-receipt/v2` artifact `utv2-1630-db-proof-receipt-30661777017-1`
  (`gh api repos/griff843/Unit-Talk-v2/actions/artifacts/8805580141/zip`),
  giving `tap: {tests:7, pass:7, fail:0}`, `exit_code: 0`,
  `observed_project_ref: xskgrzbteyqdufktjrjx` (staging, not the canonical
  production ref `zfzdnfwdarxucxtaojxm`), and the seven live
  `database-smoke.test.ts` case names with their real per-case
  `duration_ms`;
- the same job's raw log (`gh api repos/griff843/Unit-Talk-v2/actions/jobs/91259566906/logs`)
  for the `[seed-staging]` row-count lines (0 reset each for
  `distribution_receipts`/`distribution_outbox`/`system_runs`; 9/1/6/3/133
  synthetic rows upserted for `sports`/`cappers`/`market_families`/
  `selection_types`/`market_types`);
- the independent `verify` job's log (`91260945152`), which re-ran
  `scripts/ci/verify-db-proof-receipt.ts` and printed
  `Verdict: PASS` / `Reason: DB proof verified: run 30661777017 attempt 1 @
  33fa464cf270c8612f79deb3e2410143a5590d7a, target xskgrzbteyqdufktjrjx,
  pass=7 fail=0 skipped=0`.

`verifier.identity` names those two CI jobs, not the implementing agent --
`ops:proof-repair` structurally requires (P10/R3) a verifier identity
distinct from `manifest.created_by` (`claude`) for exactly this reason: proof
text cannot show which database a run reached, so the verifier of the
live-DB claim is the CI job that holds the credential plus the job that
independently re-derives the receipt binding, not the agent asserting it.

`sha_binding.merge_sha` was rebound via `ops:proof-generate --merge-sha`
(the pre-existing, narrowly-scoped mechanism `proof-repair.ts`'s own design
contract requires this repair to defer to) -- `proof-repair apply` never
writes that field itself, and refuses to proceed if it is absent or
mismatched.

## Governance

- No production write, deployment, restart, schema mutation, or row deletion.
- No direct-main push, no `--admin` merge, no branch-protection change.
- No fabricated or unmeasured proof: every number above is copied from a
  command run on this branch, or read back verbatim from a retained CI
  artifact/log and cited by run and job ID.
