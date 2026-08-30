# PROOF: UTV2-1757 — Verification

**Issue:** UTV2-1757
**Tier:** T2
**Lane type:** governance
**Proof profile:** static
**Executor:** codex (lane registration) — see Known gaps
**Branch:** `codex/utv2-1757-supersede-tombstone`
**Base:** `c92e922f88083122dfd6c073954a6f84d7d0ff55`
MERGE_SHA: 325ee096c91a70130d3b15f5185a613ebcecd5f1

> The MERGE_SHA line above carries the branch anchor commit — the last non-proof
> commit on this branch. A file cannot contain its own SHA; post-merge rebinding
> replaces it with the real merge SHA. It is a real commit, not a placeholder.

---

## Definition of Done

- [x] Root historical manifest is a truthful terminal `superseded` tombstone
- [x] Parked historical manifest is a truthful terminal `superseded` tombstone
- [x] Neither record participates in `ACTIVE_LOCK_STATUSES`
- [x] Neither record consumes dispatch capacity (`ops:execution-state` 5 active -> 4, slots 5/10 -> 4/10)
- [x] The 54-path self `FILE_OVERLAP` disappears (`ops:merge-risk` block 1 -> 0)
- [x] Deleted-Linear orphan is no longer dispatch-blocking (`dispatch_blocking_failures: 0`; reclassified to advisory `ORCH-HISTORICAL-DECAY`)
- [x] Scheduled `ops:reconcile` no longer rewrites either record (dry-run planned mutations 4 -> 0, zero entries for the record)
- [x] No `record_merge_on_manifest` repair proposed or needed; PR #1448 recorded as governance evidence only, not bound as `commit_sha` or `pr_url`
- [x] Stale per-issue sync file removed after its orchestration authority was tested and found negative
- [x] Branch and PR statements are truthful, verified against `git ls-remote` and the GitHub API rather than restated
- [x] No truth-check pass, Done state, or synthetic merge SHA fabricated
- [x] Full relevant verification green
- [x] Independent review verified BOTH manifest copies separately, including a byte-exact `truth_check_history` comparison

---

## ASSERTIONS:

1. Both on-disk copies of the historical superseded lane record — the root
   manifest and the parked manifest — now carry the terminal status
   `superseded`. Neither is a member of `ACTIVE_LOCK_STATUSES`.
2. Neither copy consumes a dispatch slot, and neither holds its 54-path
   `file_scope_lock` against any lane.
3. The self `FILE_OVERLAP` block in `ops:merge-risk` — the only `block` in the
   repository and the condition that aborted dispatch Phase 0 — is gone.
4. The scheduled `ops:reconcile` no longer selects either copy, so it stops
   appending a stranded-heartbeat failure receipt to each of them every six
   hours.
5. Every historical fact on both records is preserved byte-identically:
   `closed_at`, the 54-path `file_scope_lock`, all existing `ops:reconcile`
   failure receipts, the original branch, commit and PR, and `superseded_by`.
6. The `superseded.reason` text is corrected. Its prior claim that the lane
   branch had been deleted was false. The branch is not deleted to make the old
   text true.
7. No Done state, no merge receipt, no synthetic merge SHA and no passing
   truth-check receipt is written for the historical record.
8. The deleted Linear identifier is not recreated. The tombstone records that it
   is deleted and names UTV2-1757 as the successor record, explicitly stating
   that UTV2-1757 is not the original implementation issue.
9. PR #1448 is recorded as governance evidence only. It is not bound as
   `commit_sha` or `pr_url`, and `record-merge` was not run against it.

---

## EVIDENCE:

### 1. Why the record was still active

`ACTIVE_LOCK_STATUSES` (`scripts/ops/shared.ts`) is
`{started, in_progress, in_review, blocked, parked, reopened}`. `blocked` is a
member. A terminal, never-merged lane whose Linear identifier no longer exists
was therefore counted as an active lane by every consumer that derives capacity
and file locks from that set, and it reserved all 54 paths in its own
`file_scope_lock` — against itself, because the root and parked copies share an
`issue_id` and each is read as a separate lane.

`superseded` is a non-success terminal status and is reachable from any status.
The transition was applied to the root record with the canonical command, which
accepted it:

```
$ pnpm exec tsx scripts/ops/lane-manifest.ts update UTV2-1512 --status superseded --json
```

The canonical command has no parked-copy code path — `readManifest` /
`writeManifest` resolve root-only through `issueToManifestPath` — so the parked
copy was written directly. Both files were then normalised by one script so the
two copies carry identical corrected text.

### 2. Negative control — the same tools on `main`, unchanged

Run from the control checkout at `c92e922f`, where both copies are still `blocked`:

```
$ pnpm ops:merge-risk
total_active_lanes 5
summary {"hard_fail": 0, "block": 1, "warning": 8}
FILE_OVERLAP  block  ['UTV2-1512', 'UTV2-1512']
  Shared file_scope_lock paths: .ops/sync/UTV2-1482.yml,
  apps/command-center/src/app/actions/execution.ts, ... (54 paths)

$ pnpm ops:execution-state
active_lanes: UTV2-1512 blocked, UTV2-1736 in_review, UTV2-1744 in_review,
              UTV2-1745 in_review, UTV2-1757 started
dispatch_slots.total: used 5 / max 10

$ pnpm ops:reconcile
  manifests: 716 total, 5 active
  planned_mutations: 4
  [DRY-RUN WOULD MUTATE] UTV2-1512: heartbeat_at 1245.5h old -> status -> blocked, truth_check_history appended
  [DRY-RUN WOULD MUTATE] UTV2-1512: heartbeat_at 1245.5h old -> status -> blocked, truth_check_history appended
```

The identifier appears twice because the reconciler mutates the root copy and
the parked copy separately, every six hours.

### 3. Positive observation — the same tools on this branch

```
$ pnpm ops:merge-risk
total_active_lanes 1
summary {"hard_fail": 0, "block": 0, "warning": 4}
  (the 4 warnings are PR_NO_ACTIVE_LANE for chore/harness-model-depin,
   UTV2-1736, UTV2-1744, UTV2-1745 — pre-existing, unrelated)

$ pnpm ops:execution-state
active_lanes: UTV2-1736 in_review, UTV2-1744 in_review, UTV2-1745 in_review,
              UTV2-1757 started
blocked_lanes: []
dispatch_slots.total: used 4 / max 10

$ pnpm ops:reconcile
  manifests: 710 total, 1 active
  planned_mutations: 0
  (no UTV2-1512 entry of any verdict)

$ pnpm ops:substrate-guard
  ok: true — lease_dir pass, merge_lock pass, active_lane_worktrees pass,
  board_hard_fail pass; hard_fail 0

$ pnpm ops:orchestration-reconcile --current --json
  dispatch_blocking_failures: 0
  UTV2-1512 -> ORCH-HISTORICAL-DECAY, requirement advisory, classification warning
    "Linear entity UTV2-1512 is deleted; referenced only by historical artifacts"
    lane_manifest: "no manifest"
  repair_plan: no UTV2-1512 entry
```

The identifier is now classified exactly like the other 621 deleted historical
identifiers in the repository: advisory decay, not a dispatch-blocking failure
and not a repair target.

The reconciler exit code remains `3` (INFRA) from three transient Linear lookup
timeouts on UTV2-1282, UTV2-1300 and UTV2-1303. Those are unrelated to this lane
and are not claimed as fixed.

### 4. Historical facts, verified against GitHub rather than restated

```
$ git ls-remote origin refs/heads/claude/utv2-1512-command-center-workbench
d57d1023bffcf1f815c77c6b9e488e9ad43a762c  refs/heads/claude/utv2-1512-command-center-workbench

$ gh pr view 1173 --json state,mergeCommit,mergedAt,headRefName
{"state":"CLOSED","mergeCommit":null,"mergedAt":null,
 "headRefName":"claude/utv2-1512-command-center-workbench"}

$ gh pr view 1190 --json state,mergeCommit,mergedAt
{"state":"MERGED","mergeCommit":{"oid":"b0a9002be3dfae89ee1abb49ed17c15f2addd741"},
 "mergedAt":"2026-07-13T19:10:40Z"}

$ gh pr view 1448 --json state,mergeCommit,mergedAt
{"state":"MERGED","mergeCommit":{"oid":"3399b271fc13cd39dc03e12f38a73fb1a46e0679"},
 "mergedAt":"2026-08-26T20:01:19Z"}
```

The branch exists. The prior `superseded.reason` asserted it had been deleted.
That assertion is corrected in place, and the correction says so explicitly, so
a reader of the record is not left wondering which version was right.

### 5. Why an earlier correction did not hold, and why this one covers both copies

PR #1448 already moved the root record to `superseded` on 2026-08-26. It touched
four files:

```
$ git show --stat 3399b271
 .ops/sync/UTV2-1512.yml                        |   4 +-
 docs/06_status/lanes/UTV2-1512.json            |   4 +-
 docs/06_status/proof/UTV2-1512/diff-summary.md |  45 +
 docs/06_status/proof/UTV2-1512/verification.md | 100 +
```

The parked copy is absent from that list. It was never corrected, and its last
substantive change before the reconciler began rewriting it was in July 2026.

The next scheduled reconcile run reverted the root record:

```
$ git show a67a6a59 -- docs/06_status/lanes/UTV2-1512.json
-  "status": "superseded",
+  "status": "blocked",
```

That reversion is the defect UTV2-1756 fixed: `writeManifest` always resolved to
the root path, so a read of the still-`blocked` parked copy overwrote the root
record. With that fix on `main`, each copy is now written to its own path — which
is why the negative control above shows the reconciler planning two separate
mutations rather than one. It is also why correcting only one copy would not
hold: the uncorrected copy would keep being selected, and would keep re-asserting
an active lane for a terminal identifier. Both copies are corrected here.

### 6. `.ops/sync/UTV2-1512.yml`

Tested for orchestration authority before removal. No consumer enumerates the
directory to derive active-lane or capacity state:

- `scripts/ops/substrate-guard.ts`, `scripts/ops/reconcile.ts`,
  `scripts/ops/execution-state.ts`, `scripts/ops/merge-risk.ts` — zero references.
- `scripts/ops/sync-check.mjs` resolves exactly one path, from the current
  branch's issue ID.
- `scripts/ops/lane-start.ts`, `scripts/ci/file-scope-guard.ts`,
  `scripts/ops/proof-schema.ts` — per-issue paths for the lane being processed.
- `.github/workflows/housekeeping-fast-ci.yml` iterates the directory but only
  emits warnings about YAML well-formedness.

So its presence was **not** keeping orchestration authority alive, and its
removal is not what clears any of the conditions above. It is removed because it
is stale per-issue coordination state for a terminal record, and because removing
it is the canonical terminal action: `scripts/ops/lane-close.ts` deletes exactly
`.ops/sync/<issue>.yml` when a lane reaches its terminal state. This leaves the
substrate uniform — no terminal lane carrying an approval-shaped artifact. No
replacement sync state is fabricated. The authority test is reported as negative
here rather than omitted, so the removal is not credited with an effect it did
not have.

---

## Verification

### What this lane deliberately does NOT claim

- It does not claim the historical lane is Done. Both records are terminal
  `superseded`, a non-success terminal status.
- It does not write a merge SHA, a `pr_url`, or a passing truth-check receipt on
  either historical record. `commit_sha` and `pr_url` are unchanged.
- It does not bind PR #1448 as the implementation merge for the historical
  record. `record_merge_on_manifest` and `ops:lane-manifest record-merge` were
  not run against #1448 or against the historical identifier at all.
- It does not recreate the deleted Linear issue.
- It does not fix the reconciler's read-auth defect, the closeout replay race, or
  any other tracked substrate defect.
- It does not claim UTV2-1757 is the original implementation issue. The tombstone
  states the opposite in the record itself.

### Alternatives rejected

- **Delete the historical branch** so the old "branch deleted" text becomes true.
  Rejected: it destroys a preserved historical ref to make a false statement
  retroactively accurate. The text is corrected instead.
- **Bind PR #1448 as the implementation merge.** Rejected: #1448 ratified the
  disposition; it is not the implementation. Binding it would manufacture a merge
  identity for work that was never merged.
- **Correct only the root copy**, as PR #1448 did. Rejected: §5 shows why that
  does not hold.
- **Accept the canonical command's heartbeat bump.** The command sets
  `heartbeat_at` to now. On a record whose entire purpose is to preserve when the
  lane actually stopped, a 2026-08-30 heartbeat would be a new false statement.
  The historical value is restored, and the command's transition acceptance is
  used only as proof that `blocked -> superseded` is legal.

---

## Runtime Verification

### 1. Full static verification

```
$ pnpm verify:static
```

exit code 0

Aggregated across every TAP block the run emitted (the counts below are a sum
over all suites, not a single suite's summary):

```
# tests 5263
# pass 5263
# fail 0
# skipped 0
```

Stage-by-stage, all exit 0:

```
ci:db-client-boundary   OK: 4 direct driver construction sites, none reachable from `pnpm test`
ops:sync-check          OK (per-issue): codex/utv2-1757-supersede-tombstone <-> .ops/sync/UTV2-1757.yml
ops:system-alignment    verdict=PASS fail=0 warn=0
ops:automation-coverage verdict=PASS fail=0 warn=1 classified=15
env:check               Environment files passed validation.
lint                    exit 0
type-check              exit 0
build                   exit 0
test                    exit 0
smart-form verify       exit 0
verify:commands         exit 0
```

The single `automation-coverage` warning is the pre-existing
`WIRING_GLOB_SHADOWED` finding on `apps/qa-agent/src/**/*.test.ts`, present on
`main` and unrelated to this lane.


### 2. Type-check and full test suite, run standalone

Run separately from `verify:static` so each carries its own measured receipt
rather than being asserted from the composite run.

```
$ pnpm type-check
exit code 0

$ pnpm test
exit code 0

# tests 5149
# pass 5149
# fail 0
# skipped 0
```

The count differs from the `pnpm verify:static` total above because
`verify:static` additionally runs the `@unit-talk/smart-form` package suite,
which `pnpm test` does not.

### 3. R-level

```
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 6
Rules matched: (none) — no R-level artifacts required for this diff
```

### 4. Synchronization integrity

```
$ pnpm ops:sync-check
[sync-check] OK (per-issue): branch "codex/utv2-1757-supersede-tombstone" <-> .ops/sync/UTV2-1757.yml

$ pnpm ops:system-alignment-check
[system-alignment] verdict=PASS fail=0 warn=0
```

### 5. Live-DB

Not applicable. This lane's proof profile is `static`: it touches no DB surface,
issues no query, and changes no runtime behaviour. No live-DB claim is made.

---

## Merge SHA Binding

`sha_binding.merge_sha` in `evidence.json` is `null` pre-merge and is set by
post-merge rebinding. `verified_source_sha` is
`cbe7069295f435652c3fa68c0243fd4dd7d1ae5a`, the last non-proof commit on this
branch, which carries the entire functional change.

---

## Known gaps

- **No Codex invocation occurred.** The lane is registered `executor: codex` with
  model profile `codex-sol-high`, but the authorized change is a bounded
  mechanical state correction with no authored code, so it was performed
  directly. The model-routing sidecar declares the lane's registered routing and
  deliberately omits `codex_exit_code` and `codex_cli_version`, which would
  assert a run that did not happen. Disclosed rather than papered over.
- **The two historical copies remain duplicated.** This lane makes both truthful
  and terminal; it does not deduplicate them or change the rule that a parked
  copy and a root copy share an `issue_id` and are read as two lanes. That
  duplication is why the self-overlap existed in the first place, and it is still
  the shape of the substrate for every other parked record.
- **The reconciler's stranded rule still does not converge** for any record it
  does select: it preserves `heartbeat_at`, so it re-fires every six hours and
  appends another identical receipt. This lane removes two records from that
  rule's selection; it does not fix the rule.
- **`ops:orchestration-reconcile` still exits 3.** Three transient Linear lookup
  timeouts, unrelated to this lane.

---

## Sign-off

This bundle is evidence, not certification. The done-gate is `ops:truth-check`,
and merge authority is the merge gate's. Nothing here is self-certified Done and
no approval artifact is self-applied.
