# PROOF: UTV2-1777 — Verification
MERGE_SHA: 3bf891a901b1bc48a2d2a2829f3022991ec9f56c

Issue: UTV2-1777 — Persist the stranded implementation lane's merged state so its
stale scope lock is released, without claiming Done.
Tier: T1. Lane type: governance. Proof profile: static.

## Verification

### What was actually wrong

The predecessor implementation lane's PR merged successfully, but its post-merge
closeout hard gate failed on P10/R3. Because the closeout is transactional, it
correctly persisted nothing: the manifest stayed at `in_review` with
`commit_sha: null`.

`in_review` is a member of `ACTIVE_LOCK_STATUSES` (`scripts/ops/shared.ts:450`).
An active lane holds its `file_scope_lock` against every later `ops:lane-start`.
The already-authorized repair lane's primary scope is `scripts/ops/proof-schema.ts`
and its test — the two paths the predecessor still holds. So:

    the predecessor cannot leave `in_review` until the repair lands,
    and the repair cannot be admitted until the predecessor leaves `in_review`.

That is a closed cycle, and it was reproduced by execution, not inferred:

```
$ pnpm ops:lane-start UTV2-1776 --tier T1 --branch codex/utv2-1776-attestation-merge-slot \
    --lane-type governance --executor codex-cli --files scripts/ops/proof-schema.ts ...
{
  "ok": false,
  "code": "file_scope_conflict",
  "message": "Requested file scope overlaps with active lane UTV2-1729",
  "conflicting_issue_id": "UTV2-1729",
  "overlapping_files": ["scripts/ops/proof-schema.test.ts", "scripts/ops/proof-schema.ts"]
}
```

The sanctioned narrowing command cannot exit the cycle either. `ops:lane-manifest
scope-release` refuses on a merged PR by design (`scripts/ops/scope-release.ts:222-224`):

```ts
if (context.pr.state.toUpperCase() !== 'OPEN') {
  refuse('pr_not_open', `PR #${context.pr.number} is ${context.pr.state};
          only an open PR may narrow its lane scope`);
}
```

The PR is `MERGED`. That refusal is right in intent — a merged lane should not be
quietly re-scoped — but it means a lane whose closeout fails after merge can never
release scope again.

### The fix

`merged` is the truthful state and it is not a lock-holding one. Both facts were
checked in source rather than assumed:

```
$ sed -n '450,458p' scripts/ops/shared.ts
export const ACTIVE_LOCK_STATUSES = new Set<LaneManifestStatus>([
  'started', 'in_progress', 'in_review', 'blocked', 'parked', 'reopened',
]);                                        # 'merged' is absent

$ grep 'in_review:' scripts/ops/shared.ts
  in_review: ['merged', 'blocked', 'parked', 'reopened', 'in_review', ...NON_SUCCESS_TERMINALS],
```

So `in_review -> merged` is a listed transition, `merged` releases the scope lock,
and the record becomes *more* accurate rather than less: the PR really is merged,
GitHub really recorded that merge SHA, and the lane really is not Done.

This lane therefore records exactly that, and nothing else. It does not close the
predecessor, does not touch its proof, and does not move it in Linear.

### Why `blocked` would not have worked

`blocked` is also a member of `ACTIVE_LOCK_STATUSES`. Parking or blocking the
predecessor would have left the admission conflict byte-for-byte identical while
making the record less true. Recorded here because it is the obvious wrong answer
and the reason it is wrong is mechanical, not stylistic.

### The change is mechanical, not hand-authored

The single functional edit was produced by the canonical command, run inside this
lane's governed worktree:

```
$ pnpm ops:lane-manifest record-merge UTV2-1729 --pr 1436 --json
{
  "ok": true,
  "code": "merge_sha_recorded",
  "issue_id": "UTV2-1729",
  "status": "merged",
  "pr_url": "https://github.com/griff843/Unit-Talk-v2/pull/1436",
  "commit_sha": "95ec237f32eebd14c2a37cde477202fd553711cb",
  "heartbeat_at": "2026-08-29T20:06:15.475Z",
  "history_appended": false
}
```

`history_appended: false` is the load-bearing field. An earlier defect had this
command append a fabricated `verdict: "pass"` truth-check entry; that was repaired,
and this run confirms the repair holds on a real invocation. No truth-check receipt
is manufactured by this lane, and the predecessor's `truth_check_history` stays
empty — which is correct, because its truth-check has never passed.

Note the invocation form. `pnpm ops:lane-manifest -- record-merge ...` forwards the
`--` as a literal argument and exits 1 with usage; the separator must be omitted.

### Changed keys, compared mechanically rather than by eye

The manifest was copied before the command ran and diffed key-by-key afterwards:

```
CHANGED status:      "in_review" -> "merged"
CHANGED commit_sha:  null        -> "95ec237f32eebd14c2a37cde477202fd553711cb"
CHANGED heartbeat_at:"2026-08-22T01:15:42.326Z" -> "2026-08-29T20:06:15.475Z"

changed keys: ['commit_sha', 'heartbeat_at', 'status']
forbidden-field violations: NONE
```

The forbidden set checked was `file_scope_lock`, `expected_proof_paths`,
`model_routing`, `scope_release_history`, `truth_check_history`, `reopen_history`,
`closed_at`, `branch`, `executor`, `tier`, `lane_type`. `pr_url` was already the
correct PR and is byte-identical. `closed_at` remains `null`.

### What this lane deliberately does NOT claim

- It does not claim the predecessor is Done. It is not. Its closeout gate has never
  passed, its proof is still in its pre-merge shape, and it remains open in Linear.
- It does not claim the P10/R3 defect is fixed. That is the repair lane's job.
- It does not touch the predecessor's proof artifacts, sync file, or any shared
  tooling. The functional diff is one file.

### Checklist

- [x] GitHub PR is `MERGED` — read from the API, not from a manifest.
- [x] GitHub merge SHA is `95ec237f32eebd14c2a37cde477202fd553711cb`.
- [x] The manifest change was produced by canonical `record-merge`, not by hand.
- [x] `in_review -> merged` is a listed transition in `TRANSITIONS`.
- [x] No truth-check receipt fabricated (`history_appended: false`).
- [x] `closed_at` remains `null`.
- [x] Changed keys limited to `status`, `commit_sha`, `heartbeat_at`.

## Runtime Verification

This is a static-profile governance lane. It touches no DB surface, issues no
query, and changes no runtime behaviour. No live-DB claim is made.

### 1. Full static verification

```
$ pnpm verify:static
verify:static exit=0
```

Aggregated across every suite the run executed:

```
# tests 5237
# pass 5237
# fail 0
```

### 2. Full `pnpm verify` — partial, and why

```
$ pnpm verify
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL
  (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx.
  Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
```

`verify` is `verify:static && test:live-db`. Every static stage passed — reaching
`test:live-db` at all proves it, since the chain is `&&`. The live-DB leg refuses
locally because the staging target is only reachable from the `staging-ci` GitHub
environment; the required CI `verify` job produces and checks a run-scoped staging
receipt in-job. Recorded as PARTIAL rather than presented as a pass.

### 3. R-level

```
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 6
Rules matched: (none) — no R-level artifacts required for this diff
```

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Approved PR head: pending merge
Execution SHA: 3bf891a901b1bc48a2d2a2829f3022991ec9f56c

## Known gaps

- **No Codex invocation occurred.** The lane is registered `executor: codex-cli`,
  but the entire authorized implementation is one canonical command with no
  authored code, so it was run directly. The model-routing sidecar therefore
  declares the lane's registered routing and deliberately omits `codex_exit_code`
  and `codex_cli_version`, which would assert a run that did not happen. Disclosed
  rather than papered over; re-registering the lane as Claude-executed is a PM call.
- **This unblocks admission; it does not prove the repair correct.** After this
  lands, the repair lane's admission must be re-attempted and observed to succeed.
  If the predecessor still appears as a `file_scope_conflict`, the premise of this
  lane is wrong and that must be reported rather than overridden.
- **The predecessor is left in a state no automation will advance on its own.**
  `merged` is terminal-success for lock purposes but its closeout still fails. It
  is reachable only by an explicit sanctioned closeout replay after the repair
  lands. That is intended, but it does mean the record will sit visibly incomplete
  in the interim, and nothing will nag about it.
- **`scope-release` remains unusable post-merge.** This lane routes around that
  rather than fixing it. Any future lane whose closeout fails after merge will hit
  the same cycle and need the same bridge. Widening `scope-release` was considered
  and explicitly rejected: those paths were genuinely modified by the merged PR,
  so releasing them post-merge would change what the safety mechanism means.
- **The root control checkout carries untracked shadow copies** of the
  predecessor's manifest and sync file which disagree with `main` (they read
  `started`). They are not repository truth, they blocked `git pull`, and one early
  read in this session came from the shadow before the discrepancy was caught. They
  are preserved outside the repository, unmodified, pending separate classification.
