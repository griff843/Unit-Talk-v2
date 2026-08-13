# PROOF: UTV2-1698

MERGE_SHA: 68ee1ff9139abdb0945d6d44698f229b6f5c1ae0

> Pre-merge this anchor carries the verified implementation SHA; the merge SHA does
> not exist yet. `post-merge-lane-close.yml` rebinds it via `ops:proof-generate --merge-sha`.

## ASSERTIONS:

- [x] A rework that carries findings and changes zero source files cannot report success.
- [x] A run that terminates before the implementation boundary cannot report success, regardless of carried findings.
- [x] The two rules are independent: removing either fails only its own regressions.
- [x] The guard does not degrade into "always fail" — a genuine run reaching implement, verify or closeout still succeeds.
- [x] Source counting excludes `docs/` and `.ops/`, so a proof-only or manifest-only commit cannot satisfy implementation feedback.
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

### The two rules

```ts
// Rule 1 — rework must change source
if (input.carriedFindings > 0 && input.sourceFilesChanged === 0) {
  return { ok: false, code: 'REWORK_NO_SOURCE_CHANGE', exit_code: 1, ... };
}

// Rule 2 — a run must reach the implementation boundary
if (input.phase !== undefined) {
  const reached = EXECUTION_PHASES.indexOf(input.phase);
  if (reached >= 0 && reached < IMPLEMENTATION_BOUNDARY_INDEX) {
    return { ok: false, code: 'INCOMPLETE_PHASE_PROGRESSION', exit_code: 1, ... };
  }
}
```

`countSourceFilesChanged` excludes `docs/` and `.ops/`: a proof-only or manifest-only commit is not implementation, which is exactly what both false-success runs produced.

### Controls proven by making them fail

Each rule was removed independently and the suite re-run.

```
MUTATION 1 — phase-progression rule removed
not ok 25 - a run that terminates before the implementation boundary is not a completed execution
# tests 27   # pass 26   # fail 1

MUTATION 2 — rework rule removed
not ok 22 - a rework with carried findings and no source diff exits non-success instead of reporting SUCCESS
not ok 27 - the rework guard still fires independently of phase
# tests 27   # pass 25   # fail 2

RESTORED
# tests 27   # pass 27   # fail 0
```

No overlap between the two failure sets. That is the evidence they are genuinely independent guards rather than one rule wearing two names — Shape B would have survived a fix for Shape A alone.

Full suite across both changed modules: **52 tests, 52 pass, 0 fail.**

### The assertion that stops the fix becoming "always fail"

```
test('a run that reached implementation or beyond is allowed to report success')
```

Covers `implement`, `verify` and `closeout` with zero findings and a real diff. Without it, a guard could pass its own regressions by refusing everything — which would trade a false-success defect for a false-failure one.

### Commands executed (explicit references)

- `pnpm exec tsx --test scripts/ops/codex-exec.test.ts scripts/ops/execution-checkpoint.test.ts` — PASS, 52 tests, 52 pass, 0 fail.
- `pnpm type-check` — PASS, no errors in the changed modules.
- `pnpm test` — full suite deferred to PR CI, which is authoritative for this lane.
- `pnpm verify` — deferred to PR CI.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — R-level compliance evaluated for this lane.

## Verification

| Check | Result | Evidence |
|---|---|---|
| Focused suites | PASS | 52 tests, 52 pass, 0 fail |
| `pnpm type-check` | PASS | no errors in `codex-exec.ts` or `execution-checkpoint.ts` |
| Mutation: rule 1 removed | Regression fails | 25 pass, 2 fail |
| Mutation: rule 2 removed | Regression fails | 26 pass, 1 fail |
| Restored | PASS | 27/27 |
| `pnpm verify` | Deferred to PR CI | authoritative for this lane |

## Runtime Verification

- No runtime, domain, DB or delivery surface is touched. This lane changes executor dispatch control flow only.

## Independent review

Rule 1 and its tests were implemented by Codex. Rule 2, its tests and the not-always-fail assertion were added by the orchestrator after observing Shape B, which rule 1 structurally cannot catch.

The orchestrator therefore wrote part of the change and must not be its sole validator. Independent review is required before merge and is recorded on the PR.

## SHA Binding

Head SHA: 68ee1ff9139abdb0945d6d44698f229b6f5c1ae0
Merge SHA: 68ee1ff9139abdb0945d6d44698f229b6f5c1ae0
