# PROOF: UTV2-1698

MERGE_SHA: ae41936657472e31da0d795c551cb5d493047c30

> Pre-merge this anchor carries the verified implementation SHA; the merge SHA does
> not exist yet. `post-merge-lane-close.yml` rebinds it via `ops:proof-generate --merge-sha`.

## ASSERTIONS:

- [x] A rework that carries findings and changes zero source files cannot report success.
- [x] A run that terminates before the implementation boundary cannot report success, regardless of carried findings.
- [x] A self-reported completed `implement` phase with zero source changes cannot report success.
- [x] Progression derives from authoritative `completed_phases`, never from `checkpoint.phase`.
- [x] `evaluateExecutionTruth` reads checkpoint state itself; no caller can supply a stale phase.
- [x] `--rework --dry-run` leaves the primary checkpoint and its `.bak` sidecar byte-identical.
- [x] A real rework invalidates `implement` and later phases before resume planning.
- [x] A real source implementation with a real source diff still succeeds — the guards do not degrade into always-fail.
- [x] Source counting excludes `docs/` and `.ops/`, so a proof-only or manifest-only commit cannot satisfy an implementation claim.
- [x] Production call-path coverage is load-bearing: the call site is asserted, not only the function.
- [x] **No proof-only or scope-aware success path exists in this lane.** It fails closed pending UTV2-1710.
- [x] Each control is proven by mutation, not by a passing suite beside it.

## EVIDENCE:

### The defect, observed four times

`codex-exec` returned `"ok": true, "code": "SUCCESS"` on four runs that produced no implementation. Two shapes, and the second is not covered by a fix for the first.

**Shape A — rework after rejection.** Two consecutive re-dispatches of a rejected lane:

```
"attempt": 2, "resumed": true,
"skipped_phases": ["orient","plan","implement","verify","closeout"],
"carried_findings": 2, "outcome": "completed"

git diff <reviewed-head>..HEAD -- scripts/ops/lease-registry.ts
(empty)
```

The rejection was recorded, acknowledged, and structurally discarded. Independent review's verdict became decorative.

**Shape B — fresh lane, no findings.** A different lane, clean checkpoint:

```
"attempt": 1, "resumed": false,
"skipped_phases": [], "phase": "plan",
"carried_findings": 0, "outcome": "completed"

source files changed: 0
```

Shape B passes any guard that keys on carried findings, because a fresh lane carries none. It stopped after deciding what to do and reported success.

### The two rules, after independent review corrected both

```ts
// Rule 1 -- a rework must change source
if (input.carriedFindings > 0 && input.sourceFilesChanged === 0) {
  return { ok: false, code: 'REWORK_NO_SOURCE_CHANGE', exit_code: 1, ... };
}

// Rule 2 -- the run must have COMPLETED the implementation phase
const checkpoint = input.issueId ? readCheckpoint(input.issueId, input.checkpointDir) : null;
if (checkpoint) {
  const completed = new Set(checkpoint.completed_phases.map((entry) => entry.phase));
  if (!completed.has('implement')) {
    return { ok: false, code: 'INCOMPLETE_PHASE_PROGRESSION', exit_code: 1, ... };
  }
}
```

`countSourceFilesChanged` excludes `docs/` and `.ops/`: a proof-only or manifest-only commit is not implementation, which is exactly what both false-success runs produced.

### Two defects in the orchestrator's own addition, found by review

Rule 2 was written by the orchestrator after observing Shape B. It shipped two defects, both caught before merge. Recording them because the second was invisible to the obvious fix for the first.

**Defect 1 -- the rule was fed a pre-spawn snapshot.** `evaluateExecutionTruth` originally accepted `phase`, and `main()` passed `executionSummary.phase`, built at `beginAttempt` *before* `spawnSync`. `beginAttempt` sets `phase = resume.resume_from_phase`, which on a fresh lane is unconditionally `orient`. Independent review reproduced it end to end against the module's own functions:

```
phase captured BEFORE spawn: orient
phase on disk AFTER spawn:   closeout
evaluateExecutionTruth(wired value) -> INCOMPLETE_PHASE_PROGRESSION
```

**Every first-attempt fresh-lane dispatch would have failed regardless of what Codex did** -- a false failure on the default path, which is strictly worse than the false success this lane exists to remove.

The first attempt at a fix was a test asserting the correct value passes and the stale value fails. **That test did not guard anything**: reverting the call site to the stale snapshot still passed the whole suite, because the rule was right and only the caller was wrong. A test cannot fix a wrong call site.

The durable fix removes the parameter. `evaluateExecutionTruth` now takes `issueId` and reads the checkpoint itself, so **a stale phase is unrepresentable rather than merely tested against.** No caller can supply one; the production call site passes `issueId` only.

**Defect 2 -- `checkpoint.phase` does not mean what the rule assumed.** Writing the fix surfaced that `recordPhaseComplete` sets `phase: nextPhaseAfter(completed)` (`execution-checkpoint.ts:509-526`). The field is *the next phase to work on*, not the phase the run ended in. A lane that completed `plan` and stopped therefore carries `phase: 'implement'` and would have **passed** the rule while implementing nothing.

The rule now gates on `completed_phases` containing `implement`. Mutation C below proves the distinction: reverting to the phase-pointer form fails the regression.

### Third defect: a self-reported phase is not evidence

Independent re-review of the corrected head confirmed the first two fixes and then demonstrated a third hole. `completed_phases` is written by the executor itself, via `ops:exec-checkpoint phase-complete` -- the very command the resume brief tells Codex to run. The reviewer constructed a fresh lane that called `phase-complete --phase implement` while changing no source, and it returned:

```
{"ok":true,"code":"SUCCESS","exit_code":0,"message":"execution changed source as required"}
```

with `sourceFilesChanged === 0`. The success message was literally false on that path.

The rework rule cannot catch it: a fresh lane carries no findings. The phase rule cannot catch it: the phase was genuinely marked complete. **Self-attestation satisfied a guard built to detect self-attestation** -- the same defect one level up.

The fix corroborates the claim against the one signal the executor cannot fabricate by asserting it: claiming the implementation phase now requires a real diff. `IMPLEMENTATION_CLAIMED_WITHOUT_CHANGE`.

### Bounce 1: dry-run purity, and an exception that should never have been attempted

Independent review rejected the previous head on two P2 findings.

**Dry-run purity — fixed and retained.** `--dry-run` invalidated checkpoint
phases before returning, so asking the system what it *would* do changed what it
*had* done. The condition is guarded in place rather than moved after the
dry-run return: moving it would have made a real rework plan from un-invalidated
state. It lives in `shouldInvalidateForRework()` rather than inline, because a
test can only re-implement an inlined condition, which proves nothing once the
production condition is removed (Mutation E).

**Proof-only completion — attempted, then removed entirely.** The second finding
was that a lane whose declared deliverable is documentation can never produce a
source diff, so an honest proof-only lane could never pass. The attempted remedy
made Rules 1 and 3 scope-aware, reading `file_scope_lock` from the base ref.

That remedy was wrong, and the record of why is the most useful thing in this
document.

### Bounce 2: the exception opened two more false-success paths

Review of the scope-aware head found two defects, and the PM removed the feature
from this lane.

**Runner-generated evidence satisfied the check.** `declaredDeliverableChanged`
was counted *after* `writeModelRoutingEvidence()` rewrote its timestamped
sidecar and `commitAndPushEvidence()` committed it. For any lane whose scope
included its own proof directory, the runner's own mandatory artifact made the
count positive — so a fresh run, or a rework that merely marked `implement`
complete, returned SUCCESS having changed nothing the reviewer asked for. **The
guard was measuring its own harness.**

**Prefix matching credited out-of-scope siblings.** `countDeclaredDeliverableChanged`
used `file.startsWith(entry)`, so an exact lock of `docs/result.md` also credited
`docs/result.md.bak`, and stripping the glob from `dir/*` credited nested
descendants that the repository's canonical scope matcher excludes. A lane could
change only an out-of-scope sibling and still be credited with delivering.

**And the exception was unreachable for the lanes it claimed to serve.** It
required a trusted manifest on the base ref. An ordinary brand-new lane has
none — `ops:lane-start` does not establish that state. The positive regressions
manufactured a base manifest that real lane-start never creates, so the tests
proved a path production could not reach, while the two defects above were
reachable on every lane whose scope included its proof directory.

Three attempts, three different false-success paths, each one entering through
the same door: **a special case that decides when changing nothing is
acceptable.** This lane exists to prevent false success, so it now has no such
door. A proof-only lane fails closed here until UTV2-1710 provides
lifecycle-owned deliverable authority. Failing an honest proof-only lane is
recoverable and visible; admitting one more false-success path is neither.

Removed in full: `readAuthoritativeFileScope`, `laneDeliverableIsNonSource`,
`countDeclaredDeliverableChanged`, the `deliverableIsNonSource` and
`declaredDeliverableChanged` inputs, both proof-only exceptions, the synthetic
base-manifest tests, and the four mutations that only proved the removed
feature. Mutation H proves the removal is enforced rather than incidental: an
unused optional input is an invitation to rewire it, and both defects above
entered through those inputs.

### Controls proven by making them fail

Three mutations, each failing only what it should.

```
MUTATION A -- Rule 2, completed-phases rule removed
not ok 25 - a run that terminates before the implementation boundary is not a completed execution
# tests 56   # pass 55   # fail 1

MUTATION B -- Rule 1, rework rule removed
not ok 22 - a rework with carried findings and no source diff exits non-success instead of reporting SUCCESS
not ok 28 - the rework guard still fires independently of phase
# tests 56   # pass 54   # fail 2

MUTATION C -- gate on checkpoint.phase instead of completed_phases
not ok 25 - a run that terminates before the implementation boundary is not a completed execution
# tests 56   # pass 55   # fail 1

MUTATION D -- Rule 3, self-attestation cross-check removed
not ok 26 - a self-reported implement phase with zero source changes is not a completed execution
# tests 56   # pass 55   # fail 1

MUTATION E -- dry-run purity removed (invalidate regardless of dryRun)
not ok 29 - a rework dry run leaves the checkpoint and its .bak sidecar byte-identical
# tests 56   # pass 55   # fail 1

MUTATION F -- source counting includes docs/ and .ops/
not ok 24 - source-diff counting excludes proof and operational metadata but includes implementation files
# tests 56   # pass 55   # fail 1

MUTATION G -- production call site stops passing issueId
not ok 30 - the production call path passes issueId and a source-file count, and cannot supply a phase
# tests 56   # pass 55   # fail 1

MUTATION H -- proof-only exemption reintroduced
not ok 31 - evaluateExecutionTruth exposes no scope or deliverable inputs
# tests 56   # pass 55   # fail 1

RESTORED (codex-exec.test.ts + execution-checkpoint.test.ts)
# tests 56   # pass 56   # fail 0   # skipped 0
```

Eight mutation groups, no survivors. Mutations A and B have disjoint failure sets, which is the evidence they are independent guards rather than one rule wearing two names. Mutation C proves the completed-phases semantics specifically, and would not have been caught by A or B.

### The assertion that stops this becoming "always fail"

```
test('a run that reached implementation or beyond is allowed to report success')
```

Seeds real checkpoints completing `implement`, `implement+verify`, and the full five, and asserts each is allowed. Without it a guard could pass its own regressions by refusing everything -- trading a false-success defect for a false-failure one, which is exactly what defect 1 would have done in production.

### Fail-closed disposition, per PM decision

A legitimate no-op run -- a lane that correctly concludes nothing needs implementing -- is **not** exempted here. Per PM decision recorded on this issue, `INCOMPLETE_PHASE_PROGRESSION` stays fail-closed. A future legitimate no-op requires a distinct `NO_CHANGE_REQUIRED` disposition with independent confirmation, and must never masquerade as `SUCCESS`/`completed`. That capability is deliberately not built here.

### Commands executed (explicit references)

- `pnpm exec tsx --test scripts/ops/codex-exec.test.ts scripts/ops/execution-checkpoint.test.ts` — PASS, 56 tests, 56 pass, 0 fail, 0 skipped.
- `pnpm exec eslint scripts/ops/codex-exec.ts scripts/ops/codex-exec.test.ts` — PASS, no output.
- `pnpm type-check` — runs, but does NOT compile `scripts/ops/**`: `tsconfig.json` references only `packages/*` and `apps/*`. The earlier claim that it passed "with no errors in the changed modules" was technically true and substantively empty, because the command never reads these files. Corrected here after review. Tracked separately under its own ticket; deliberately not fixed in this lane.
- `pnpm test` — full suite deferred to PR CI, which is authoritative for this lane.
- `pnpm verify` — deferred to PR CI.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — R-level compliance evaluated for this lane.

## Verification

| Check | Result | Evidence |
|---|---|---|
| Focused suites | PASS | 56 tests, 56 pass, 0 fail, 0 skipped |
| `pnpm exec eslint` on changed files | PASS | no output |
| `pnpm type-check` | Does not cover these files | `tsconfig.json` references only `packages/*` and `apps/*` — tracked under UTV2-1706 |
| Mutation A: Rule 2 completed-phases removed | Regression fails | `not ok 25` — 55 pass, 1 fail |
| Mutation B: Rule 1 rework removed | Regression fails | `not ok 22`, `28` — 54 pass, 2 fail |
| Mutation C: gate on `checkpoint.phase` | Regression fails | `not ok 25` — 55 pass, 1 fail |
| Mutation D: Rule 3 self-attestation cross-check removed | Regression fails | `not ok 26` — 55 pass, 1 fail |
| Mutation E: dry-run purity removed | Regression fails | `not ok 29` — 55 pass, 1 fail |
| Mutation F: source counting includes `docs/`, `.ops/` | Regression fails | `not ok 24` — 55 pass, 1 fail |
| Mutation G: call site stops passing `issueId` | Regression fails | `not ok 30` — 55 pass, 1 fail |
| Mutation H: proof-only exemption reintroduced | Regression fails | `not ok 31` — 55 pass, 1 fail |
| Mutation survivors | None | 8 groups, every group killed by its own regression |
| Restored | PASS | 56 tests, 56 pass, 0 fail |

## Runtime Verification

- No runtime, domain, DB or delivery surface is touched. This lane changes executor dispatch control flow only.

## Independent review

Rule 1 and its tests were implemented by Codex. Rule 2, its tests and the not-always-fail assertion were added by the orchestrator after observing Shape B, which rule 1 structurally cannot catch.

The orchestrator therefore wrote part of the change and must not be its sole validator. Independent review is required before merge and is recorded on the PR.

## SHA Binding

Verified implementation SHA: `ae41936657472e31da0d795c551cb5d493047c30` — the commit containing every rule and regression this document describes. All counts above were produced by running against this tree.

The branch head is one commit further: this document. The head adds documentation only and changes no executable path. Anchoring to `ae419366` is deliberate — a proof cannot contain its own hash, and an earlier bundle's defect was anchoring to a commit that did **not** contain the code it described. `post-merge-lane-close.yml` rebinds both files to the merge SHA via `ops:proof-generate --merge-sha`.

## Proof-accuracy corrections made after final review

Final independent review at `8b97f49c` confirmed the code correct on every functional check and rejected the bundle on evidence accuracy. All findings were authoring errors in this document, not defects in the change:

- The restored total was recorded as **52/52**. It is **53/53**. `diff-summary.md` had it right and this file did not; the two disagreed with each other.
- Mutation B was recorded as failing **`not ok 27`**. It fails **`not ok 28`**. Test 27 is *"a run that reached implementation or beyond is allowed to report success"* and stays green under that mutation — it must, since removing the rework rule should not affect it. The numbering shifted when the self-attestation regression was inserted as test 26, and the earlier figure was never re-derived.
- Mutation D was missing from the verification table entirely, although the prose described the defect it covers at length.
- **The SHA anchor pointed to `68ee1ff9`, a commit that contains only Rule 1.** This document describes all three rules. The anchor named a commit predating two of the three fixes it claims as evidence.

All four numbers above were re-derived by running each mutation again at `8b97f49c` rather than reconciled against the previous text.

The last of these is the one worth carrying forward. This repo's own invariant is that proof must tie to the merge SHA and stale proof is invalid — and `Proof Auditor Gate` **passed** at this SHA. That gate validates structural presence: required headings, a 40-hex token, literal command strings. It does not check that the SHA it finds actually contains the code the document describes, nor that the recorded counts match a real run. A proof bundle can therefore satisfy every automated proof gate while pointing at the wrong commit and reporting numbers from an earlier one. That gap was found by a human-directed reviewer, not by any gate.


## Bounce 1 disposition

| Item | Source | Disposition | Proven by |
|---|---|---|---|
| Dry run mutates checkpoint state | Review P2 | Fixed — guarded in place, seam extracted so the production condition is reachable from a test | Mutation E |
| Rework rule ignores declared deliverable scope | Review P2 | **Superseded at bounce 2.** The scope-aware remedy introduced two further false-success paths and was removed; the underlying need is now UTV2-1710 | Mutations F, H |
| Proof-only rework validity | PM checkpoint | **Withdrawn by PM scope decision at bounce 2.** Not supported in this lane; proof-only lanes fail closed | — |
| Scope read from executor-independent state | PM checkpoint | **Withdrawn with the feature it served.** `readAuthoritativeFileScope` no longer exists | — |

Nothing in the bounce-1 scope-aware work survives except the dry-run fix. The
suite went 53 → 65 → **56** tests and the mutation battery 4 → 11 → **8** groups
as the exception was added and then removed. Every count in this document was
re-derived by running at `ae419366`, not carried forward from any previous text.

## Bounce 2 disposition

| Item | Source | Disposition |
|---|---|---|
| Runner-generated evidence satisfies `declaredDeliverableChanged` | Review P2, exact head | Removed with the feature — the count no longer exists |
| Prefix matching credits out-of-scope siblings and descendants | Review P2, exact head | Removed with the feature — the matcher no longer exists |
| Proof-only completion support | PM scope decision | Removed from this lane; reassigned to UTV2-1710 |
| Strict source enforcement | PM scope decision | Restored; proof-only lanes fail closed here |

Both P2 findings are resolved by deletion rather than repair, which is the
disposition the PM directed and the correct one: each previous repair of this
exception introduced a new false-success path.

### A review-state failure in the previous packet

The previous packet reported **zero unresolved threads**. That was false. The
exact-head review completed at 18:05:24Z with the two P2 findings above; the
thread state quoted in the packet had been queried at 17:59Z, before that review
existed, and was never re-read before the packet was assembled at 18:25:24Z.

This is the same defect class the lane exists to close — evidence captured
before the fact it attests to, then reported as current — reproduced in the
lane's own reporting. Thread state is now queried immediately before assembling
the packet, after all exact-head reviews have completed, and reported as three
distinct counts (total, unresolved, unresolved and non-outdated) rather than one.
