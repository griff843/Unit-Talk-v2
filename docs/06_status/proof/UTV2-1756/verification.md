# PROOF: UTV2-1756 — Verification
MERGE_SHA: 05308d6d39d4ba45a0aea2b3414b1982d2e26b29

Issue: UTV2-1756 — Scheduled reconciler overwrites root lane manifests with
parked-copy content, reverting merged governance decisions every 6 hours.
Tier: T1. Lane type: governance. Proof profile: static.

## Verification

### What was actually wrong

Three separate, individually reasonable pieces combined into one unattended
write to protected `main`.

`readAllManifestPaths` recurses, so `docs/06_status/lanes/` and its `parked/`
subdirectory are returned as peers. Two records carry `issue_id: "UTV2-1512"`:
the root one, ratified `superseded` by PR #1448, and the parked one, still
`blocked` with a seven-week-old heartbeat.

`selectReconcilableManifests` correctly excluded the terminal root and selected
the active parked copy. **UTV2-1619's fail-closed allowlist worked exactly as
designed and is not the bypass** — the terminal manifest was never a candidate.

The bypass was on the write side. `reconcile.ts` carried its own private
`manifestPath(issueId)`, a second copy of `shared.ts`'s `issueToManifestPath`,
and wrote through raw `fs.writeFileSync`. Both functions are pure functions of
the issue ID with no knowledge of the file a record was read from, so the
parked record's whole content was written to the root file — and, writing
raw, without `validateManifest` or `assertStatusTransition` ever running.

Result, in `a67a6a59` (github-actions[bot], direct push to protected `main`,
2026-08-27T05:16:34Z): `"status": "superseded"` → `"blocked"`, `heartbeat_at`
rolled back seven weeks, 58 lines of `truth_check_history` deleted.
`1 file changed, 4 insertions(+), 58 deletions(-)`. On `cron: '0 */6 * * *'`,
four times a day, indefinitely.

This is the duplicated-authority failure class: two definitions of one
invariant — here, "where does this manifest live" — held in two places, drifting
until one of them is wrong.

### The fix

Two independent defences, because either alone leaves a hole.

**1. Path fidelity.** `readAllManifestEntries` pairs every manifest with the
file it was read from. `selectReconcilableManifestEntries` preserves that
pairing through selection, delegating its policy to the existing
`selectReconcilableManifests` rather than restating it — reintroducing a second
copy of the selection rule inside a fix for duplicated authority would be
self-defeating. `reconcileManifest` writes to the entry's real path. The
duplicate `manifestPath(issueId)` in `reconcile.ts` is deleted outright.

**2. A fail-closed guard on the writers that route through
`writeManifestAtPath`.** Before overwriting an existing file,
`writeManifestAtPath` gives the record already on disk a vote: it refuses a
write whose `issue_id` disagrees with the on-disk record, and refuses any move
out of a *settled* status that `TRANSITIONS` does not permit. `superseded →
blocked` is not a permitted transition, so the exact `a67a6a59` write is refused
there.

The truthful scope of that guard is narrower than a universal one, and is
stated here rather than left to be discovered: it binds every writer that
routes through `writeManifestAtPath`, which now includes the reconciler, but it
is **not** a universal chokepoint. Two writers still reach a manifest file
without passing through it — `writeBoundManifest` in
`scripts/ops/lane-link-pr.ts:81-88` under `allowMissingPreflightToken`, and
`scripts/ops/migrate-lane-types.ts:106`. Both predate this lane and are outside
its frozen scope, and neither carries the path fidelity defect, so neither can
reproduce `a67a6a59`; but neither is guarded. A terminal manifest is therefore
**not** un-rewritable by any writer whatsoever. What this lane establishes is
the narrower result it actually proves: the UTV2-1756 reconciler incident path
is closed — by path fidelity on the read/write pairing, and by the guard on the
chokepoint the reconciler now uses. See the unguarded-writer disclosure in
Known Gaps below, which this paragraph deliberately agrees with.

Path fidelity alone would not have protected the root from a future caller that
resolves the wrong path. The guard alone would not have got the parked copy
written to the right file. Both are asserted separately below.

### Two deliberate narrowings, and why each is honest rather than convenient

**The transition arm is scoped to settled statuses, not to every status.**
Enforcing the full `TRANSITIONS` table at the write chokepoint was implemented
first and broke four pre-existing tests: `ops:lane-link-pr` moves every lane
`started → in_review` on PR binding, and `started`'s row in `TRANSITIONS` does
not list `in_review`. That gap in the table is real and predates this lane. It
deserves its own issue. Closing it by having a write guard start refusing PR
binding for every lane would be smuggling a lifecycle change in under a clobber
fix, so the guard was narrowed to the settled statuses the Definition of Done
actually names. The narrowing is covered by its own regression, so it cannot
silently widen or shrink later.

**`ops:reconcile` opts out of outgoing schema validation, and only that.**
Routing the reconciler through the chokepoint newly subjected it to
`validateManifest`, which it had never run. Measured against the real files:

```text
docs/06_status/lanes/UTV2-1512.json         errors=1  (preflight_token file does not exist)
docs/06_status/lanes/parked/UTV2-1512.json  errors=1  (preflight_token file does not exist)
docs/06_status/lanes/UTV2-1157-codex.json   throws    (worktree_path is null)
```

Validating there would make the reconciler refuse to release locks on exactly
the legacy lanes reconciliation exists to unstick — converting a clobber bug
into a stuck-board bug. The clobber guard runs on that path regardless;
`validate: false` is a statement about the outgoing record's shape, never
permission to write over a different record. `writeManifestAtPath` validating by
default is itself asserted, so the opt-out cannot spread by drift.

### Checklist

ASSERTIONS:

- [x] A manifest read from a subdirectory is written back to that subdirectory.
- [x] The ratified root manifest is byte-identical after a reconcile sweep.
- [x] A terminal root manifest refuses a rollback write under a duplicate
      `issue_id` arrangement — proven by execution against a fixture holding
      both copies, not by inspection.
- [x] Every settled status (`merged`, `done`, `failed`, `superseded`,
      `cancelled`) vetoes a rollback to an active status.
- [x] A write whose `issue_id` disagrees with the on-disk record is refused,
      including at an aliased filename where validation has nothing to say.
- [x] The guard abstains for an absent, unparseable, or legacy-status target,
      so a corrupt manifest stays repairable.
- [x] An in-flight record is not transition-gated: `started → in_review` still
      writes, so PR binding is unaffected.
- [x] `writeManifestAtPath` validates the outgoing manifest by default.
- [x] A refused write writes nothing at all, and is not counted as a mutation.
- [x] `readAllManifests` returns exactly what it returned before.
- [x] `selectReconcilableManifestEntries` and `selectReconcilableManifests`
      apply one policy, not two.
- [x] `classifyLaneCapacity` is unchanged and still location-independent.
- [x] Mutation control: disabling the guard, removing path fidelity, and
      dropping the source path in selection each make specific named
      regressions fail.

## Runtime Verification

EVIDENCE:

### 1. End-to-end mutation triple — `scripts/ops/reconcile.test.ts`

The fixture is the real arrangement on `main`: two manifests carrying
`issue_id: "UTV2-1512"`, one at the root (`superseded`) and one under `parked/`
(`blocked`, heartbeat stale beyond the 24h threshold). Selection is asserted to
pick exactly the parked copy.

| Arm | Path fidelity | Guard | Observed |
|---|---|---|---|
| A | on | on | parked copy written (`blocked`, +1 history entry); **root byte-identical** |
| B | removed | on | `refused: true`, `action_taken` starts `REFUSED`, refusal names `cannot transition to "blocked"`; **root byte-identical, parked byte-identical** |
| C | removed | removed (raw injected writer) | **root clobbered** — `status` → `blocked`, `heartbeat_at` rolled backwards: the `a67a6a59` regression reproduced |

Arm C is the inversion control. If it ever stops clobbering, arms A and B prove
nothing, because the fixture rather than the fix would be doing the work.

```text
pnpm exec tsx --test scripts/ops/reconcile.test.ts
# tests 26
# pass 26
# fail 0
```

### 2. Guard and read-layer regressions — `scripts/ops/shared.test.ts`

```text
pnpm exec tsx --test scripts/ops/shared.test.ts
# tests 85
# pass 85
# fail 0
```

72 pre-existing tests, unmodified, plus 13 new ones covering the read layer,
both guard arms, all five settled statuses, the three abstention cases, the
in-flight narrowing, validation-on-by-default, and `classifyLaneCapacity`'s
location independence.

### 3. Mutation control — run against the REAL source, not only a harness

Each mutation was applied to the committed implementation, the suites re-run,
and the source restored.

```text
MUTATION 1: assertManifestWriteIsSafe -> no-op
not ok 24  - UTV2-1756 ARM B: with path fidelity removed, the guard still refuses to rewrite the terminal root
not ok 103 - UTV2-1756 GUARD: a superseded manifest refuses a write back to blocked (the a67a6a59 condition)
not ok 106 - UTV2-1756 GUARD: refuses a write whose issue_id differs from the record already at that path
not ok 111 - UTV2-1756 GUARD: every settled status vetoes a rollback to an active status
# tests 111
# pass 107
# fail 4

MUTATION 2: reconcileManifest ignores options.manifestPath
not ok 23 - UTV2-1756 ARM A
not ok 24 - UTV2-1756 ARM B
not ok 25 - UTV2-1756 ARM C
# tests 26
# pass 23
# fail 3

MUTATION 3: selectReconcilableManifestEntries re-derives path from issue ID
not ok 23 - UTV2-1756 ARM A
not ok 24 - UTV2-1756 ARM B
not ok 25 - UTV2-1756 ARM C
not ok 26 - UTV2-1756: selectReconcilableManifestEntries applies the same policy as selectReconcilableManifests
# tests 26
# pass 22
# fail 4

BASELINE RESTORED
# tests 111
# pass 111
# fail 0
```

**Mutations 2 and 3 reproduced the defect against the live repository.** With
path fidelity removed, `issueToManifestPath` resolved to the real
`docs/06_status/lanes/UTV2-1512.json` in the lane worktree, and the test
fixture's content was written over it:
`1 file changed, 17 insertions(+), 125 deletions(-)` — `lane_type` overwritten
from `delivery-ui` to `codex-cli`, `commit_sha` and `pr_url` nulled, the entire
`file_scope_lock` replaced. That file was restored from `HEAD` and the working
tree verified clean before the proof bundle was written. It is reported here
because it is the blast radius measured rather than asserted: the corruption is
whole-object, not merely the `status` field.

### 4. Full suite

```text
pnpm verify
env:check         exit 0
lint              exit 0
type-check        exit 0
build             exit 0
pnpm test         5088 assertions across all suites, 0 failing (exit 0)
```

`pnpm type-check` and `pnpm test` both exit 0. `test:live-db` refuses locally by
design:

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL
```

That is an environment gate, not a code failure, and is unobtainable outside the
`staging-ci` GitHub environment. Required CI `verify` runs it with those
credentials and produces the run-scoped receipt. This lane's proof profile is
`static`: it touches no DB surface, issues no query, and changes no runtime
behaviour. No live-DB claim is made here.

### 5. R-level

```text
pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 7
Rules matched: (none) — no R-level artifacts required for this diff
```

## PM review round 2 — two findings, both fixed

PM withheld T1 approval at head `95757016` on two actionable findings. Both are
fixed here, both are mutation-tested, and neither was cosmetic.

### Finding 1 — the existing-done restart path was broken

`ops:lane-start` replaces a `done` manifest with a fresh `started` one when an
issue is worked a second time. `done -> started` is not in `TRANSITIONS`, and
`done` is write-protected, so the guard as shipped at `95757016` **refused that
write**.

That is worse than a refused write. Reading `scripts/ops/lane-start.ts`, the
ordering on the new-lane path is:

| Line | Step |
| -- | -- |
| 1392 | `createBranchAndWorktree(branch, worktreePath)` |
| 1395 | `prepareLaneWithIsolatedPnpm(...)` |
| 1396 | `reserveLease({...})` |
| 1413 | throw if an existing manifest is in any non-`done` status |
| ~1458 | `writeManifest(manifest)` <- the guard fires here |

There is no `try`/`catch` and no rollback on that path. A refusal at the write
would therefore have stranded a branch, a worktree, and a lease on **every**
restart of a completed issue.

Fixed by permitting exactly `done -> started` in the guard, scoped to match the
kernel's own rule: lane-start hard-errors on an existing manifest in any other
status, so `done` is the only settled record it ever replaces and `started` the
only status it replaces one with. The exception is unreachable by
`ops:reconcile`, which only ever writes `blocked`, `merged`, or `done`, and only
for manifests in `ACTIVE_LOCK_STATUSES` — which excludes `done`.

### Finding 2 — reconcile swallowed operational write failures

`applyManifestWrite` caught **every** error and recorded it as a refusal. A full
disk, a read-only mount, or a bug in the writer would have been reported as a
manifest-policy refusal, and the scheduled `ops:reconcile --apply` run would
have exited 0 having written nothing.

Fixed by giving the guard its own error type, `ManifestWritePolicyError`, thrown
by `assertManifestWriteIsSafe` and by nothing else. `applyManifestWrite` catches
only that; everything else propagates, escapes `main()`'s bare loop, and exits
nonzero.

### Residue on a rejected start — reported, not fixed

PM also asked for proof that a rejected start leaves no worktree, lease, branch,
or manifest residue. Two halves, answered separately and honestly:

* **Manifest residue: none.** A refused write leaves the target byte-identical.
  Asserted directly in `UTV2-1756 RESTART: the exception is exactly
  done->started and nothing wider`, which compares file bytes before and after
  every refusal.
* **Worktree, branch, and lease residue: yes, and pre-existing.** The table
  above shows all three are created before lane-start's non-`done` check at
  line 1413, on a path with no rollback. So a start rejected for an existing
  non-`done` manifest already stranded them before this lane existed. This lane
  does not introduce that path and — with finding 1 fixed — no longer adds a
  new way to reach it. Repairing it means giving lane-start's new-lane path a
  rollback, which is a change to `scripts/ops/lane-start.ts`: outside this
  lane's frozen `file_scope_lock`, and recorded as a known gap rather than
  silently expanded into.

### Mutation results for both fixes

| Mutation | Expected | Observed |
| -- | -- | -- |
| Remove the `done -> started` exception | restart test fails | `not ok 87 ... RESTART: a done manifest accepts the sanctioned replacement` |
| Widen it to any settled `-> started` | bounds test fails | `not ok 88 ... RESTART: the exception is exactly done->started and nothing wider` |
| Restore the catch-all in `applyManifestWrite` | both write-failure tests fail | `not ok 27 ... policy refusal is recorded, an operational failure propagates` and `not ok 28 ... a real OS write failure exits nonzero` |
| None (control) | all pass | `# pass 88 # fail 0` (shared), `# pass 28 # fail 0` (reconcile) |

### A harness defect found and corrected mid-proof

The first version of the command-level write-failure test put a *directory*
where the manifest file belonged, expecting EISDIR. It passed — and kept
passing under the catch-all mutation, which is how it was caught.
`readAllManifestPaths` recurses into directories, so a directory named
`UTV2-1512.json` simply vanishes from the candidate set and the subprocess died
during fixture lookup instead. The nonzero exit was real and meaningless.

Rebuilt to aim the write at a path whose parent is a regular file (ENOTDIR),
which fails the write while leaving the read intact, and reordered so the
control arm runs first and asserts a clean exit — so a harness that cannot
import, cannot find its fixture, or cannot run at all fails the test instead of
manufacturing a pass. Not a chmod, because CI may run as root.

## Deliberate behaviour change — record-merge onto a settled lane

Surfaced by independent adversarial review of PR #1457, confirmed in source,
and locked in a test rather than left incidental.

`applyPrMergeToManifest` (`scripts/ops/lane-manifest.ts:348-355`) forces
`status: 'merged'` from **any** starting status except `done`, and
`recordMergeCommand` (`:296`) hands that result straight to `writeManifest`.
`TRANSITIONS` admits only `reopened` or a self-loop out of `failed`,
`superseded`, and `cancelled`. So with this lane's guard in place,
`ops:lane-manifest record-merge` against a lane that already settled as
not-merged now throws where it previously wrote silently.

That is the intended reading of the truth model, not a regression: a merge SHA
must not be stamped onto a lane whose settled record says it never merged. It
is also the same judgement the PM applied by hand in rejecting
`record_merge_on_manifest` for UTV2-1512, whose PR #1173 closed unmerged.

The sanctioned repair shapes are unaffected — `in_review -> merged` and the
`merged -> merged` idempotent re-record both still write. Asserted by
`UTV2-1756 GUARD: record-merge cannot stamp merged onto a lane that settled as
not-merged` in `scripts/ops/shared.test.ts`, which covers all three refusals,
byte-survival of the on-disk record, and both sanctioned shapes.

The earlier claim in `diff-summary.md` that behaviour was unchanged for
single-manifest lanes was too broad and has been corrected.

## Known gaps

- **`started → in_review` is missing from `TRANSITIONS`.** Discovered by this
  lane when the un-narrowed guard broke `ops:lane-link-pr`. The table and the
  lifecycle `ops:lane-link-pr` actually performs disagree. Not fixed here — it
  is a lifecycle-policy change, not a clobber fix — and recorded as a separate
  unstaffed issue.
- **The identity arm cannot separate same-`issue_id` aliases.**
  `docs/06_status/lanes/UTV2-1157.json` and
  `docs/06_status/lanes/UTV2-1157-codex.json` are distinct lanes that both
  declare `UTV2-1157`, so the identity arm has nothing to compare and only path
  fidelity and the transition arm apply to that pair. Path fidelity is the
  primary defence; the guard is the backstop.
- **The duplicate manifests themselves are untouched.** Both UTV2-1512 records
  still read `status: "blocked"` on `main`; restoring them to a truthful
  terminal state is UTV2-1757, deliberately out of this lane's frozen scope.
  This lane stops the recurrence; it does not repair the damage already done.
- **The chokepoint is not universal, and the guard's doc comment no longer
  claims it is.** Two writers still reach a manifest file without passing
  through `writeManifestAtPath`: `writeBoundManifest` in
  `scripts/ops/lane-link-pr.ts:81-88` when `allowMissingPreflightToken` is set
  (raw `writeJsonFile` after a filtered `validateManifest`), and
  `scripts/ops/migrate-lane-types.ts:106` (raw `fs.writeFileSync`). Both
  predate this lane and are outside its frozen scope. Neither has the path
  fidelity defect — each writes back to the file it resolved for its own
  issue — so neither can reproduce `a67a6a59`; but neither is guarded.
  Recorded as follow-up work.
- **`ops:lane-start`'s new-lane path has no rollback.** Branch, worktree, and
  lease are created before its existing-manifest status check, so a start
  rejected for an existing non-`done` manifest strands all three. Pre-existing,
  unrelated to the clobber fix, and repairable only inside
  `scripts/ops/lane-start.ts`, which is outside this lane's frozen scope.
- **The restart proof is unit-level, not a real `ops:lane-start` invocation.**
  The guard's behaviour on `done -> started` is proven directly against
  `writeManifestAtPath`, and the lane-start ordering above is established by
  reading the source. Driving the real command end-to-end needs a preflight
  token, a real branch and worktree, and a lease, and `scripts/ops/lane-start.test.ts`
  is outside this lane's frozen `file_scope_lock`. Naming this rather than
  implying a coverage level the tests do not have.
- **`writeJsonFile` is not atomic.** Plain `fs.writeFileSync`, no
  temp-file-and-rename as `scripts/ops/proof-rebind.ts` uses for its own
  writes. A crash mid-write can still truncate a settled manifest. Pre-existing
  and untouched here; noted because this is exactly the file class the lane
  sets out to protect.
- **`ops:reconcile` no longer schema-validates its writes** — as it never did.
  The opt-out is explicit and documented rather than incidental, but a
  reconciler-authored write can still land a record that would fail
  `validateManifest`. Making legacy manifests schema-clean is a separate,
  larger piece of work.
