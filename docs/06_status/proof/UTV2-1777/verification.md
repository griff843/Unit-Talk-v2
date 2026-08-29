# PROOF: UTV2-1777 — Verification

MERGE_SHA: 37da0de239ee528783221b3201c6329bb63f98f6

> Pre-merge the merge anchor is intentionally empty; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-08-29T22:05:00Z
Issue: UTV2-1777
Tier: T1
Lane type: governance
Proof profile: static
Branch: codex/utv2-1777-merged-state-bridge
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1458
Head SHA: 37da0de239ee528783221b3201c6329bb63f98f6
result: pass

## ASSERTIONS:

- [x] The predecessor PR is `MERGED` and its merge SHA was read from the GitHub API, not from any manifest.
- [x] The predecessor manifest change was produced by canonical `ops:lane-manifest record-merge`, never hand-edited.
- [x] `blocked -> merged` here is `record-merge` recovery semantics, not a claim about the ordinary `TRANSITIONS` table, which does not list it.
- [x] `TRANSITIONS` is unchanged. No production source code was changed to make this narrative true.
- [x] The scheduled reconciler's failed receipt is inherited from current `main` and preserved byte-for-byte; this lane authors no `truth_check_history` change.
- [x] No passing truth-check receipt was fabricated (`history_appended: false`).
- [x] `closed_at` remains `null` and the lane is not certified Done.
- [x] Changed keys against the synchronized base are exactly `status`, `commit_sha`, `heartbeat_at`; every other protected field is byte-identical.
- [x] The functional diff concerning the predecessor is exactly one file.
- [x] `merged` is absent from `ACTIVE_LOCK_STATUSES`, so this record releases the stale scope lock.

## EVIDENCE:

Authoritative merge facts, read from GitHub:

```
$ gh pr view 1436 --json number,state,mergeCommit,mergedAt,headRefOid
{"n":1436,"state":"MERGED","mergedAt":"2026-08-29T18:29:56Z",
 "head":"55b583fd57e34ab2047bdf4cc948cca9b617eb83",
 "mergeSha":"95ec237f32eebd14c2a37cde477202fd553711cb"}

$ git cat-file -t 95ec237f32eebd14c2a37cde477202fd553711cb
commit
$ git merge-base --is-ancestor 95ec237f32eebd14c2a37cde477202fd553711cb origin/main
ANCESTOR OF origin/main: yes
```

The canonical command, run against the synchronized base:

```
$ pnpm ops:lane-manifest record-merge UTV2-1729 --pr 1436 --json
{
  "ok": true,
  "code": "merge_sha_recorded",
  "issue_id": "UTV2-1729",
  "status": "merged",
  "pr_url": "https://github.com/griff843/Unit-Talk-v2/pull/1436",
  "commit_sha": "95ec237f32eebd14c2a37cde477202fd553711cb",
  "heartbeat_at": "2026-08-29T21:55:45.892Z",
  "history_appended": false
}
```

Mechanical before/after against the exact synchronized base blob:

```
base blob sha : ac10cb76519c9f64ae48c1ec026fe2972578003f
main blob sha : ac10cb76519c9f64ae48c1ec026fe2972578003f   (identical)

changed keys: ['commit_sha', 'heartbeat_at', 'status']
   commit_sha   :: null        -> "95ec237f32eebd14c2a37cde477202fd553711cb"
   heartbeat_at :: "2026-08-22T01:15:42.326Z" -> "2026-08-29T21:55:45.892Z"
   status       :: "blocked"   -> "merged"

forbidden-field violations: NONE
truth_check_history identical to base: True | entries: 1
pr_url identical: True  https://github.com/griff843/Unit-Talk-v2/pull/1436
closed_at: None
```

## Verification

### The sequence that produced this state

1. The predecessor lane's PR #1436 merged at `95ec237f32eebd14c2a37cde477202fd553711cb`,
   2026-08-29T18:29:56Z.
2. Its post-merge closeout failed on P10/R3. That closeout is transactional, so it
   correctly persisted nothing: the manifest stayed `in_review` with `commit_sha: null`
   — a lock-holding, non-terminal state for a lane that had actually merged.
3. At 2026-08-29T20:03:21Z the scheduled reconciler pushed `af2fa19e` to `main`. It
   checks `ghost_merged` first, and a ghost would have been recorded correctly — but
   `resolveMergedPrForLane` shells out to `gh`, and the workflow step supplies no
   token, so every query returns `null` by design and the ghost rule is silently
   inert. The lane fell through to the heartbeat rule and was filed as `stranded`.
4. `main` therefore moved the manifest to `blocked` and appended a real failed
   reconcile receipt.
5. This lane inherits that history unchanged and applies canonical `record-merge`,
   which reconciles GitHub's authoritative merge fact into the stale active manifest.
6. `merged` releases the stale scope lock. It does **not** certify the lane Done.

The read-auth defect is tracked separately and is not fixed here. Once this record
lands, the predecessor leaves `ACTIVE_LOCK_STATUSES` and therefore leaves the
reconciler's candidate population entirely, so it can no longer race this manifest.

### Why `blocked -> merged` is legitimate here, stated precisely

`TRANSITIONS.blocked` does not list `merged`, and this bundle makes no claim that it
does:

```
$ pnpm exec tsx -e "assertStatusTransition(...)"
in_review -> merged : ALLOWED
blocked   -> merged : REFUSED — Illegal manifest status transition: blocked -> merged
```

`record-merge` is a separate authoritative reconciliation operation, not an ordinary
lifecycle step. It queries the real PR, requires it to actually be merged, reads
GitHub's merge SHA, refuses a conflicting existing `commit_sha`, records `merged`,
and stops there — no `done`, no passing receipt. Mechanically it reaches the write
through `writeManifestAtPath`, whose guard votes on transitions only when the on-disk
status is settled (`scripts/ops/shared.ts:1982`); `blocked` is not settled, so the
guard abstains rather than being overridden.

The two writers genuinely disagree about this pair, and that disagreement is recorded
as a known gap rather than resolved by editing `TRANSITIONS` — changing the lifecycle
table to make a narrative true would be the wrong direction of fix.

### What this lane deliberately does NOT claim

- It does not claim the predecessor is Done. Its closeout gate has never passed, its
  proof is still in its pre-merge shape, and Linear reads `Ready to Close`.
- It does not claim the P10/R3 defect is fixed. That is the successor lane's work.
- It does not claim the reconciler is fixed. That is tracked separately, unstaffed.
- It touches no predecessor proof artifact, no `.ops/sync` file, and no shared tooling.

### Alternatives rejected

- **`blocked` / `parked` as the bridge** — both are members of `ACTIVE_LOCK_STATUSES`,
  so neither releases the lock. `main` has since demonstrated this directly: the
  reconciler set `blocked` and the successor lane's admission conflict was unchanged.
- **Widening `scope-release`** — it refuses on a non-`OPEN` PR by design
  (`scripts/ops/scope-release.ts:222-224`). Those paths were genuinely modified by the
  merged PR, so releasing them post-merge would change what the mechanism means.
- **Reopening the predecessor as a multi-PR lane** — its implementation is merged;
  reopening would misrepresent it as in flight.

## Runtime Verification

Static-profile governance lane. It touches no DB surface, issues no query, and changes
no runtime behaviour. No live-DB claim is made.

### 1. Full static verification

```
$ pnpm verify:static
verify:static exit=0

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
Changed files: 8
Rules matched: (none) — no R-level artifacts required for this diff
```

### 4. Synchronization integrity

The branch was rebased onto current `main` through the sanctioned explicit verb, with
exactly one expected conflict and no others:

```
$ pnpm ops:merge-wrapper git-rebase-main --issue UTV2-1777 \
    --branch codex/utv2-1777-merged-state-bridge
CONFLICT (content): Merge conflict in docs/06_status/lanes/UTV2-1729.json

$ git diff --name-only --diff-filter=U
docs/06_status/lanes/UTV2-1729.json
```

The conflict was resolved by establishing `main`'s blob verbatim as the starting
state — verified by hash, not by inspection — and re-running the canonical command on
top of it. No hybrid JSON was hand-synthesized.

All six of this lane's protected artifacts survived the rewrite: the lane manifest,
the sync file, and the four proof files are each present in the rebased tree.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1458
Approved PR head: pending merge
Execution SHA: 37da0de239ee528783221b3201c6329bb63f98f6

## Known gaps

- **No Codex invocation occurred.** The lane is registered `executor: codex-cli`, but
  the entire authorized implementation is one canonical command with no authored code,
  so it was run directly. The model-routing sidecar declares the lane's registered
  routing and deliberately omits `codex_exit_code` and `codex_cli_version`, which would
  assert a run that did not happen. Disclosed rather than papered over; re-registering
  the lane as Claude-executed is a PM call.
- **The two sanctioned writers disagree on `blocked -> merged`.** `assertStatusTransition`
  refuses it; `record-merge` performs it, because the write guard abstains on
  non-settled on-disk statuses. Recorded, not resolved. Any future caller reasoning
  about lifecycle legality from `TRANSITIONS` alone will get a different answer than
  the one the tooling actually enforces.
- **The reconciler's read-auth defect is unfixed and systemic.** It affects every
  merged-but-unclosed lane, not just this one: the ghost rule is inert, so each is
  filed as `stranded` and driven to `blocked`. It also does not converge — the rule
  preserves `heartbeat_at`, so it re-fires every six hours and appends another
  identical receipt. `docs/06_status/lanes/UTV2-1512.json` already carries eleven,
  three of them from today. Tracked separately and deliberately not staffed here.
- **This unblocks admission; it does not prove the successor repair correct.** After
  this lands, the successor lane's `ops:lane-start` must be re-attempted and observed
  to succeed. If the predecessor still appears as a `file_scope_conflict`, this lane's
  premise is wrong and that must be reported rather than overridden.
- **The predecessor is left in a state no automation will advance on its own.**
  `merged` releases the lock but its closeout still fails, so it is reachable only by
  an explicit sanctioned closeout replay after the successor lands. Intended, but the
  record sits visibly incomplete in the interim and nothing will nag about it.
- **`scope-release` remains unusable post-merge.** This lane routes around that rather
  than fixing it, so any future lane whose closeout fails after merge hits the same
  cycle and needs the same bridge.
- **The root control checkout carries untracked shadow copies** of the predecessor's
  manifest and sync file which disagree with `main`. They are not repository truth,
  they blocked `git pull --ff-only`, and one early read in this session came from the
  shadow before the discrepancy was caught. They are preserved unmodified outside the
  repository pending separate classification; this lane neither restores nor deletes
  them.
