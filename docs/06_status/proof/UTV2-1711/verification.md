# PROOF: UTV2-1711

MERGE_SHA: 3e70c304ffbbfe2ca20310f72380a94483242e0c

> Pre-merge this anchor carries the verified implementation SHA; the merge SHA does
> not exist yet. `post-merge-lane-close.yml` rebinds it via `ops:proof-generate --merge-sha`.

## ASSERTIONS:

- [x] One immutable implementation baseline per epoch; resume never overwrites it.
- [x] Attempt-local `attempt_start_sha` and epoch `implementation_baseline_sha` are separate fields, not confusable by signature.
- [x] Rework creates a new epoch bound to the exact rejected head and cannot inherit rejected phase validity.
- [x] A rejected epoch's source diff cannot satisfy a rework.
- [x] Corroboration measures cumulative diff from the epoch baseline, so a verification-only resume may legitimately succeed with zero attempt-local diff.
- [x] Git corroboration requires the epoch baseline to be an ancestor of `HEAD`; divergent history returns `EXECUTION_BASELINE_NOT_ANCESTOR`.
- [x] Missing or corrupt post-spawn state returns `EXECUTION_STATE_UNAVAILABLE`; evaluation is never skipped.
- [x] Sidecar recovery is identity/epoch/attempt/checksum bound; a mismatched sidecar fails closed.
- [x] Executor mutations carry their originating epoch, attempt, and minimum revision; delayed rejected work cannot validate a rework epoch.
- [x] Executor mutations require that originating attempt to remain open and `in_progress`; delayed work from a closed attempt cannot create phase validity for a later resume.
- [x] Attempt start, checkpoint mutation, and clear operations share one exclusive transition lock.
- [x] The production call site cannot supply a phase or baseline snapshot.
- [x] Proof-only completion remains fail-closed and out of scope.
- [x] Each load-bearing control is proven by mutation, not by a passing suite beside it.

## EVIDENCE:

### The unit of truth was wrong

The predecessor attempt reached its bounce limit because attempt-local truth cannot
express two legitimate realities at once: a resumed attempt verifying work committed
earlier in the same unit, and a rework that must not inherit the rejected attempt's
diff. Two independent findings proved the unit rather than the rules was at fault —
a missing post-spawn checkpoint fell through to `SUCCESS`, and a verification-only
resume falsely failed because the baseline had been overwritten with the current head.

### The epoch model

```
Epoch   epoch_id, mode: fresh|rework, implementation_baseline_sha (immutable),
        objective/findings identity, cumulative phase state
Attempt monotonic number, attempt_start_sha, resume phase, outcome
```

Fresh binds the baseline before spawn. Resume reuses `existing.epoch` unchanged.
Rework archives the rejected epoch into `prior_epochs` and creates a new one at the
rejected head with phase validity reset. Corroboration reads
`changedFilesSince(cwd, checkpoint.epoch.implementation_baseline_sha)` — cumulative,
not attempt-local — which is what makes a zero-diff verification resume valid without
making a zero-diff rework valid.

### Controls proven by making them fail

Nine load-bearing mutations, each killed by a production-path regression:

```
M1 resume overwrites the epoch baseline
   not ok 3  - verification-only resume succeeds from cumulative epoch diff without overwriting the baseline
   not ok 35 - fresh and resume attempts keep one immutable epoch baseline while attempt starts advance
   not ok 38 - FIXTURE: four consecutive timeout/resume attempts become one resumable history
   not ok 40 - pending actions and findings survive across attempts
   # tests 56   # pass 50   # fail 6

M2 rework reuses the rejected epoch
   not ok 4  - rework resets rejected truth: old source and proof-only edits fail, then a new source correction succeeds
   not ok 36 - rework creates a new epoch at the rejected head and cannot inherit rejected phase validity
   # tests 56   # pass 54   # fail 2

M3 missing execution state falls through
   not ok 5  - missing post-spawn primary and sidecar state returns EXECUTION_STATE_UNAVAILABLE
   # tests 56   # pass 55   # fail 1

M4 cumulative epoch diff replaced with attempt-local diff
   not ok 3  - verification-only resume succeeds from cumulative epoch diff without overwriting the baseline
   # tests 56   # pass 55   # fail 1

M5 production call site bypasses authoritative state identity
   not ok 24 - production call path evaluates mandatory post-spawn epoch state without caller-supplied phase or baseline
   # tests 56   # pass 55   # fail 1

M9 closed-attempt guard removed from authoritative state reads
   not ok 1 - a delayed phase completion cannot mutate a closed originating attempt or leak into its resume
   # tests 1   # pass 0   # fail 1

RESTORED
   # tests 56   # pass 56   # fail 0   # skipped 0
```

M4 is the load-bearing one for the model choice: reverting cumulative corroboration to
an attempt-local diff fails precisely the verification-only-resume regression, which is
the scenario the previous design could not express.

### Resumed-review corrections

Exact-head review found three additional transition-boundary defects, all corrected in
implementation SHA `d09b50700f9bb956cf48e568a1ad02ffc3b0d874`:

- `git merge-base --is-ancestor <epoch-baseline> HEAD` now precedes diff evaluation, so
  an older or unrelated checkout cannot manufacture corroborating source paths.
- `codex-exec` injects the started epoch/attempt/revision identity into the child
  environment. Heartbeat, phase, finding, pending-action, and finish mutations validate
  it against durable state; a delayed rejected executor is refused.
- A per-issue exclusive checkpoint-transition lock serializes attempt start, mutations,
  and clear. If resume wins, clear sees the active attempt; if clear wins, resume sees
  missing state. Newly written state cannot be deleted by a stale clear decision.

Production-path regressions cover divergent Git history, child identity transport,
delayed rejected-epoch completion, closed-attempt fencing, and clear/start lock contention.

### Closed-attempt correction

Follow-up exact-head review found that an identity could remain structurally valid
after its attempt closed. A delayed or backgrounded `phase-complete` could therefore
write phase validity into a failed attempt before the next resume, and that resume
would inherit the false completion. Authoritative identity reads now also require the
originating attempt record to have `ended_at === null` while the checkpoint remains
`in_progress`.

The production-path regression closes the attempt, submits its delayed phase write,
asserts the named `execution_checkpoint_unavailable` result, proves the checkpoint
revision and completed phases did not change, and then proves a resume inherits no
phase validity. Mutation M9 removes only the open-attempt predicate and fails that
regression at its first assertion.

### Commands executed (explicit references)

- `pnpm exec tsx --test 'scripts/ops/codex-exec.test.ts' 'scripts/ops/execution-checkpoint.test.ts'` — PASS, 61 tests, 61 pass, 0 fail, 0 skipped.
- `pnpm verify:static` — PASS, including lint, `pnpm type-check`, build, `pnpm test`, Smart Form verification, and command checks.
- `pnpm lint` — PASS, no output.
- `pnpm type-check` — PASS. This project-reference check does not directly compile `scripts/ops/**`; the focused `tsx --test` run compiles and executes the changed tooling files.
- `npx tsx scripts/ops/tier-classifier.ts --declared-tier T2` — derived T2, mechanical minimum T3, `escalated: false`.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS; 9 changed files, no rules matched, no R-level artifacts required.
- `pnpm test` — PASS inside `pnpm verify:static`; both changed suites remain required-reachable through `test:ops`.
- `pnpm verify` — static gate PASS; writable live-DB stage blocked/deferred by the staging identity guard.

Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (host=unparseable). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.

The local guard observed `host=127.0.0.1 ref=unidentified` and refused execution before
any writable DB test, preserving the required fail-closed posture.

## Verification

| Check | Result | Evidence |
|---|---|---|
| Focused suites | PASS | 61 tests, 61 pass, 0 fail, 0 skipped |
| `pnpm verify:static` | PASS | lint, type-check, build, full test, Smart Form, command checks |
| `pnpm verify` | BLOCKED/DEFERRED | static PASS; writable DB refused because staging identity was unresolved |
| Mutation M1–M9 | Each regression fails | **9 groups, 0 survivors** |
| Restored | PASS | 56 / 56 |
| Scope compliance | PASS | changed files ⊆ `file_scope_lock` |
| Test wiring | PASS | both suites already required-reachable via `test:ops` |

## Runtime Verification

- No runtime, domain, DB or delivery surface is touched. This lane changes executor
  execution-state modelling only. Git is the corroborating authority and is exercised
  through real repository fixtures in the production call path.

### Correction cycle: three findings from independent review

Independent exact-head review found two P1 false-success paths and one P2, all
within this issue's stated behaviour. All three were fixed inside this issue.

**Epoch baseline had to be an ancestor.** `git diff --name-only <baseline> HEAD`
exits zero and reports paths even when HEAD does not descend from the baseline, so
an executor that checked out an older or unrelated commit fabricated corroboration.
Corroboration now requires `git merge-base --is-ancestor` and fails closed
otherwise (M6).

**Phase completion had to be bound to the originating epoch.** A delayed
`phase-complete` from a still-alive rejected executor stamped its completion into
the *new* rework epoch, letting rejected work validate a fresh one. The caller now
presents the epoch/attempt identity it started under and a mismatch is refused (M7).

**Clear and attempt-start had to share one exclusive lock.** A resume beginning
between the open-attempt check and the removal loop could have its freshly written
primary and sidecar deleted. Both now take one exclusive mutation lock (M8).

The first two are the same shape as this system's recurring defect class: the
control was correct and its boundary was not — corroboration trusted a diff without
checking lineage, and epoch identity was enforced on read but not on write.

## Independent review

Codex implemented this lane. The orchestrator evaluated it independently and ran the
mutation battery; independent exact-head review is recorded on the PR.

## SHA Binding

Verified implementation SHA: `3e70c304ffbbfe2ca20310f72380a94483242e0c`
