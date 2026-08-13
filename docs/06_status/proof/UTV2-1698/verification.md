# PROOF: UTV2-1698

MERGE_SHA: 971d18226c73ae234537330f2a21c5e0577810f7

> Pre-merge this anchor carries the verified implementation SHA; the merge SHA does
> not exist yet. `post-merge-lane-close.yml` rebinds it via `ops:proof-generate --merge-sha`.

## ASSERTIONS:

- [x] A rework that carries findings and changes zero source files cannot report success.
- [x] A run that terminates before the implementation boundary cannot report success, regardless of carried findings.
- [x] The two rules are independent: removing either fails only its own regressions.
- [x] The guard does not degrade into "always fail" — a genuine run reaching implement, verify or closeout still succeeds.
- [x] Source counting excludes `docs/` and `.ops/`, so a proof-only or manifest-only commit cannot satisfy implementation feedback.
- [x] Each control is proven by mutation, not by a passing suite beside it.
- [x] A legitimately proof-only lane stays valid after review rejection when it changed its declared deliverable.
- [x] `file_scope_lock` is read from authoritative base state, so an executor cannot rewrite its own scope to exempt itself.
- [x] Missing, malformed or unreadable authoritative scope fails closed to source-required.
- [x] The production call site itself is asserted, not only the function it should call.

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

### Bounce 1: two more holes, both in what the guard trusted

Independent review rejected the previous head on two P2 findings, and the PM
then required two further protections before a corrected head. All four are in
the same family as defects 1-3: the guard was correct, and something it trusted
was not.

**Dry-run purity.** `--dry-run` invalidated checkpoint phases before returning,
so asking the system what it *would* do changed what it *had* done. The fix
guards invalidation on `!dryRun` in place -- moving the call after the dry-run
return instead would have made a real rework plan from un-invalidated state, and
the regression at test 23 catches exactly that. The condition lives in
`shouldInvalidateForRework()` rather than inline in `main()`, because a test can
only re-implement an inlined condition, which proves nothing once the production
condition is removed (Mutation E).

**Proof-only lanes were structurally unable to be reworked.** Rule 1 required a
source diff from every rework. A lane whose entire declared deliverable is
documentation -- a proof bundle, a spec -- cannot produce one. Rejecting such a
lane's proof and receiving a corrected proof is the work completing, not the
work being skipped, and it is not `NO_CHANGE_REQUIRED` either: work occurred and
a declared deliverable changed. Rule 1 and Rule 3 are now scope-aware. Both
still fail closed when the authoritative scope requires source and only proof or
metadata moved (Mutations F, H).

**The scope trust boundary.** Making the rules scope-aware immediately created a
larger hole than it closed. `file_scope_lock` was read from the working-tree
manifest -- which sits on the executor's own branch. An executor could rewrite
its own manifest to docs-only, change nothing but its proof, and be classified
proof-only. That is the self-attestation defect of defect 3, one level up: the
subject of the check supplying the input to the check.

Scope is now read with `git show <base>:docs/06_status/lanes/<ID>.json`.
The base ref is not writable from the lane, and the pre-merge scope guard
already reads the same file from the same place. The regression asserts the
asymmetry directly: with a trusted scope requiring source and the branch
manifest tampered to docs-only, classification stays source-required, and the
same test confirms the tampered scope *would* have flipped it -- which is the
evidence the read location is load-bearing rather than incidental.

Missing, malformed and unreadable authoritative scope all fail closed to
source-required. This is the common case, not an edge: a new lane's manifest
does not exist on `main` yet. `docs/06_status/lanes/UTV2-1698.json` is not on
`origin/main`, so **this lane classifies itself as source-required** and is held
to the stricter rule by its own change.

Classification is conservative by construction. Every entry must be explicitly
inside `docs/` or `.ops/`. Mixed scope fails, because `every` requires all
entries to qualify. Bare and leading globs, parent traversal, absolute paths,
repository roots, `scripts/**`, `.github/**`, configuration and package files
all remain source or control-plane required. No executor-supplied boolean
exists, and no branch-manifest mutation reaches the verdict.

**The call site, not just the function.** `readAuthoritativeFileScope()` can be
perfect and still be bypassed by one line in `main()`. That is precisely how
defect 1 shipped, and the regression written for it passed with the wiring
reverted. Test 40 therefore asserts the production wiring itself -- that
`deliverableIsNonSource` is derived from `authoritativeScope`, gated on a
successful read, and that `manifest.file_scope_lock` does not reach the truth
evaluation at all. Mutation K rewires the call site to the branch manifest and
fails only that test.

### Controls proven by making them fail

Three mutations, each failing only what it should.

```
MUTATION A -- Rule 2, completed-phases rule removed
not ok 25 - a run that terminates before the implementation boundary is not a completed execution
# tests 65   # pass 64   # fail 1

MUTATION B -- Rule 1, rework rule removed
not ok 22 - a rework with carried findings and no source diff exits non-success instead of reporting SUCCESS
not ok 28 - the rework guard still fires independently of phase
not ok 34 - a rework on a source-required lane that changed only proof still fails
not ok 36 - a proof-only lane reworked after rejection that changed nothing still fails
# tests 65   # pass 61   # fail 4

MUTATION C -- gate on checkpoint.phase instead of completed_phases
not ok 25 - a run that terminates before the implementation boundary is not a completed execution
# tests 65   # pass 64   # fail 1

MUTATION D -- Rule 3, self-attestation cross-check removed
not ok 26 - a self-reported implement phase with zero source changes is not a completed execution
not ok 32 - an implementation-required lane that changed only docs/.ops still fails
not ok 33 - a proof-only lane that changed nothing in its declared scope still fails
# tests 65   # pass 62   # fail 3

MUTATION E -- dry-run purity removed (invalidate regardless of dryRun)
not ok 29 - a rework dry run leaves the checkpoint and its .bak sidecar byte-identical
# tests 65   # pass 64   # fail 1

MUTATION F -- Rule 3 declared-deliverable scope ignored
not ok 31 - an explicitly proof-only lane completes when it changed its declared deliverable
not ok 35 - a proof-only lane reworked after rejection completes when its declared deliverable changed
# tests 65   # pass 63   # fail 2

MUTATION G -- source counting includes docs/ and .ops/
not ok 24 - source-diff counting excludes proof and operational metadata but includes implementation files
# tests 65   # pass 64   # fail 1

MUTATION H -- proof-only rework support removed
not ok 35 - a proof-only lane reworked after rejection completes when its declared deliverable changed
# tests 65   # pass 64   # fail 1

MUTATION I -- authoritative scope read from the branch working tree, not base
not ok 37 - authoritative scope is read from base, so a tampered branch manifest cannot grant proof-only
# tests 65   # pass 64   # fail 1

MUTATION J -- permissive fallback on missing authoritative scope
not ok 38 - missing, malformed or unreadable authoritative scope fails closed
# tests 65   # pass 64   # fail 1

MUTATION K -- production call site wired to the branch manifest
not ok 40 - the production call path derives scope from authoritative state, never from the branch manifest
# tests 65   # pass 64   # fail 1

RESTORED (codex-exec.test.ts + execution-checkpoint.test.ts)
# tests 65   # pass 65   # fail 0   # skipped 0
```

Eleven mutation groups, no survivors. Mutations A and B have disjoint failure sets, which is the evidence they are independent guards rather than one rule wearing two names. Mutation C proves the completed-phases semantics specifically, and would not have been caught by A or B.

### The assertion that stops this becoming "always fail"

```
test('a run that reached implementation or beyond is allowed to report success')
```

Seeds real checkpoints completing `implement`, `implement+verify`, and the full five, and asserts each is allowed. Without it a guard could pass its own regressions by refusing everything -- trading a false-success defect for a false-failure one, which is exactly what defect 1 would have done in production.

### Fail-closed disposition, per PM decision

A legitimate no-op run -- a lane that correctly concludes nothing needs implementing -- is **not** exempted here. Per PM decision recorded on this issue, `INCOMPLETE_PHASE_PROGRESSION` stays fail-closed. A future legitimate no-op requires a distinct `NO_CHANGE_REQUIRED` disposition with independent confirmation, and must never masquerade as `SUCCESS`/`completed`. That capability is deliberately not built here.

### Commands executed (explicit references)

- `pnpm exec tsx --test scripts/ops/codex-exec.test.ts scripts/ops/execution-checkpoint.test.ts` — PASS, 65 tests, 65 pass, 0 fail, 0 skipped.
- `pnpm exec eslint scripts/ops/codex-exec.ts scripts/ops/codex-exec.test.ts` — PASS, no output.
- `pnpm type-check` — runs, but does NOT compile `scripts/ops/**`: `tsconfig.json` references only `packages/*` and `apps/*`. The earlier claim that it passed "with no errors in the changed modules" was technically true and substantively empty, because the command never reads these files. Corrected here after review. Tracked separately under its own ticket; deliberately not fixed in this lane.
- `pnpm test` — full suite deferred to PR CI, which is authoritative for this lane.
- `pnpm verify` — deferred to PR CI.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — R-level compliance evaluated for this lane.

## Verification

| Check | Result | Evidence |
|---|---|---|
| Focused suites | PASS | 65 tests, 65 pass, 0 fail, 0 skipped |
| `pnpm exec eslint` on changed files | PASS | no output |
| `pnpm type-check` | Does not cover these files | `tsconfig.json` references only `packages/*` and `apps/*` — tracked under UTV2-1706 |
| Mutation A: Rule 2 completed-phases removed | Regression fails | `not ok 25` — 64 pass, 1 fail |
| Mutation B: Rule 1 rework removed | Regression fails | `not ok 22`, `28`, `34`, `36` — 61 pass, 4 fail |
| Mutation C: gate on `checkpoint.phase` | Regression fails | `not ok 25` — 64 pass, 1 fail |
| Mutation D: Rule 3 self-attestation cross-check removed | Regression fails | `not ok 26`, `32`, `33` — 62 pass, 3 fail |
| Mutation E: dry-run purity removed | Regression fails | `not ok 29` — 64 pass, 1 fail |
| Mutation F: Rule 3 declared-deliverable scope ignored | Regression fails | `not ok 31`, `35` — 63 pass, 2 fail |
| Mutation G: source counting includes `docs/`, `.ops/` | Regression fails | `not ok 24` — 64 pass, 1 fail |
| Mutation H: proof-only rework support removed | Regression fails | `not ok 35` — 64 pass, 1 fail |
| Mutation I: scope read from branch working tree | Regression fails | `not ok 37` — 64 pass, 1 fail |
| Mutation J: permissive fallback on missing scope | Regression fails | `not ok 38` — 64 pass, 1 fail |
| Mutation K: call site wired to branch manifest | Regression fails | `not ok 40` — 64 pass, 1 fail |
| Mutation survivors | None | 11 groups, every group killed by its own regression |
| Restored | PASS | 65 tests, 65 pass, 0 fail |

## Runtime Verification

- No runtime, domain, DB or delivery surface is touched. This lane changes executor dispatch control flow only.

## Independent review

Rule 1 and its tests were implemented by Codex. Rule 2, its tests and the not-always-fail assertion were added by the orchestrator after observing Shape B, which rule 1 structurally cannot catch.

The orchestrator therefore wrote part of the change and must not be its sole validator. Independent review is required before merge and is recorded on the PR.

## SHA Binding

Verified implementation SHA: `971d18226c73ae234537330f2a21c5e0577810f7` — the commit containing every rule, seam and regression this document describes. All counts above were produced by running against this tree.

The branch head is one commit further: this document. The head adds documentation only and changes no executable path. Anchoring to `971d1822` is deliberate — a proof cannot contain its own hash, and the previous bundle's defect was anchoring to a commit that did **not** contain the code it described. `post-merge-lane-close.yml` rebinds both files to the merge SHA via `ops:proof-generate --merge-sha`.

## Proof-accuracy corrections made after final review

Final independent review at `8b97f49c` confirmed the code correct on every functional check and rejected the bundle on evidence accuracy. All findings were authoring errors in this document, not defects in the change:

- The restored total was recorded as **52/52**. It is **53/53**. `diff-summary.md` had it right and this file did not; the two disagreed with each other.
- Mutation B was recorded as failing **`not ok 27`**. It fails **`not ok 28`**. Test 27 is *"a run that reached implementation or beyond is allowed to report success"* and stays green under that mutation — it must, since removing the rework rule should not affect it. The numbering shifted when the self-attestation regression was inserted as test 26, and the earlier figure was never re-derived.
- Mutation D was missing from the verification table entirely, although the prose described the defect it covers at length.
- **The SHA anchor pointed to `68ee1ff9`, a commit that contains only Rule 1.** This document describes all three rules. The anchor named a commit predating two of the three fixes it claims as evidence.

All four numbers above were re-derived by running each mutation again at `8b97f49c` rather than reconciled against the previous text.

The last of these is the one worth carrying forward. This repo's own invariant is that proof must tie to the merge SHA and stale proof is invalid — and `Proof Auditor Gate` **passed** at this SHA. That gate validates structural presence: required headings, a 40-hex token, literal command strings. It does not check that the SHA it finds actually contains the code the document describes, nor that the recorded counts match a real run. A proof bundle can therefore satisfy every automated proof gate while pointing at the wrong commit and reporting numbers from an earlier one. That gap was found by a human-directed reviewer, not by any gate.


## Bounce 1 disposition

Independent review returned CHANGES_REQUIRED with two P2 findings; the PM then
required two further protections before a corrected head was produced. Both
findings and both protections are implemented, each with a regression and each
proven by a mutation that fails only its own regression:

| Item | Source | Disposition | Proven by |
|---|---|---|---|
| Dry run mutates checkpoint state | Review P2 | Fixed — guarded in place, seam extracted so the production condition is reachable from a test | Mutation E |
| Rework rule ignores declared deliverable scope | Review P2 | Fixed — Rules 1 and 3 are scope-aware | Mutations F, H |
| Proof-only rework must stay valid | PM checkpoint | Implemented — proof-only lane completes when its declared deliverable changed; still fails when scope requires source | Mutations F, H |
| Scope must come from executor-independent state | PM checkpoint | Implemented — read from base ref; fails closed on missing, malformed or unreadable; conservative classification | Mutations I, J, K |

The suite grew 53 → 65 tests and the mutation battery 4 → 11 groups. Every
count in this document was re-derived by running at `971d1822`, not carried
forward from the previous text.
