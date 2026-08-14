# PROOF: UTV2-1711

MERGE_SHA: 4b74008920a3bc52b22f14507d60ba0232d5d439

> Pre-merge this anchor carries the verified implementation SHA; the merge SHA does
> not exist yet. `post-merge-lane-close.yml` rebinds it via `ops:proof-generate --merge-sha`.

## ASSERTIONS:

- [x] One immutable implementation baseline per epoch; resume never overwrites it.
- [x] Attempt-local `attempt_start_sha` and epoch `implementation_baseline_sha` are separate fields, not confusable by signature.
- [x] Rework creates a new epoch bound to the exact rejected head and cannot inherit rejected phase validity.
- [x] A rejected epoch's source diff cannot satisfy a rework.
- [x] Corroboration measures cumulative diff from the epoch baseline, so a verification-only resume may legitimately succeed with zero attempt-local diff.
- [x] Missing or corrupt post-spawn state returns `EXECUTION_STATE_UNAVAILABLE`; evaluation is never skipped.
- [x] Sidecar recovery is identity/epoch/attempt/checksum bound; a mismatched sidecar fails closed.
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

Five load-bearing mutations, each killed by a production-path regression:

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

RESTORED
   # tests 56   # pass 56   # fail 0   # skipped 0
```

M4 is the load-bearing one for the model choice: reverting cumulative corroboration to
an attempt-local diff fails precisely the verification-only-resume regression, which is
the scenario the previous design could not express.

### Commands executed (explicit references)

- `pnpm exec tsx --test scripts/ops/codex-exec.test.ts scripts/ops/execution-checkpoint.test.ts` — PASS, 56 tests, 56 pass, 0 fail, 0 skipped.
- `pnpm exec eslint scripts/ops/codex-exec.ts scripts/ops/execution-checkpoint.ts scripts/ops/codex-exec.test.ts scripts/ops/execution-checkpoint.test.ts` — PASS, no output.
- `npx tsx scripts/ops/tier-classifier.ts --declared-tier T2` — derived T2, mechanical minimum T3, `escalated: false`.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — R-level compliance evaluated for this lane.
- `pnpm type-check` — does NOT compile `scripts/ops/**`; tracked separately, deliberately not fixed here.
- `pnpm verify` — deferred to PR CI, which is authoritative for this lane.

## Verification

| Check | Result | Evidence |
|---|---|---|
| Focused suites | PASS | 56 tests, 56 pass, 0 fail, 0 skipped |
| `pnpm exec eslint` | PASS | no output |
| Mutation M1–M5 | Each regression fails | 5 groups, **0 survivors** |
| Restored | PASS | 56 / 56 |
| Scope compliance | PASS | changed files ⊆ `file_scope_lock` |
| Test wiring | PASS | both suites already required-reachable via `test:ops` |

## Runtime Verification

- No runtime, domain, DB or delivery surface is touched. This lane changes executor
  execution-state modelling only. Git is the corroborating authority and is exercised
  through real repository fixtures in the production call path.

## Independent review

Codex implemented this lane. The orchestrator evaluated it independently and ran the
mutation battery; independent exact-head review is recorded on the PR.

## SHA Binding

Verified implementation SHA: `4b74008920a3bc52b22f14507d60ba0232d5d439`
