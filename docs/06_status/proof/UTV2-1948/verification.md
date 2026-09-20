# PROOF: UTV2-1948

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-19T23:26:18.000Z
Issue: UTV2-1948
Tier: T2
Lane type: delivery-ui
Branch: claude/utv2-1948-cc-health-anon-fallback
PR URL: N/A
Head SHA: 630aa9d5cd5d4f0f18066ae58b04f8bfe2f34c70
result: pass

## ASSERTIONS:

- [x] `getPipelineHealthSnapshot()` no longer discards a successfully fetched snapshot when the anon connection cannot be resolved.
- [x] `createPipelineLiveConfig` receives `null` and returns `null`, which is the behaviour it was already written for.
- [x] A test proves the snapshot survives an unavailable anon connection and that `liveConfig` is `null` rather than the call throwing.
- [x] A mutation control proves the test fails if the graceful handling is removed.
- [x] A precondition drill proves the fixture genuinely reproduces the production failure through the real code path, so the guard is not handling a failure that never occurs.
- [x] No secret was added, no migration was written, no containment setting was touched, no delivery behaviour was changed.
- [ ] **Deployed-browser proof: NOT CLAIMED.** See "Deployed-browser proof" below. Dispatching a production deployment is reserved action 8 (`docs/mission/intent.md`), so this criterion cannot be satisfied from inside this lane and is deliberately left unchecked rather than asserted.

## EVIDENCE:

```
$ pnpm type-check
> pnpm exec tsc -b tsconfig.json
(no diagnostics; exit 0)

$ pnpm test
# tests 6614
# pass 6614
# fail 0
exit=0
(grep -c "not ok" over the full run log: 0)

$ pnpm --filter @unit-talk/command-center test
1..609
# tests 609
# pass 609
# fail 0

$ npx tsx --test apps/command-center/src/lib/data/pipeline-health.test.ts
ok 1 - PRECONDITION: an unguarded anon resolve really does throw when the anon key is absent
ok 2 - resolveOptionalAnonConnection degrades to nulls instead of throwing
ok 3 - resolveOptionalAnonConnection still returns real credentials when anon is configured
ok 4 - a snapshot survives an unavailable anon connection with its real reads intact
# tests 4
# pass 4
# fail 0

$ npx tsx --test scripts/ci/required-db-smoke.test.ts
# tests 12
# pass 12
# fail 0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 6
Rules matched: operator-ui
```

## Verification
- [x] `pnpm type-check`: pass — `tsc -b tsconfig.json`, no diagnostics
- [x] `pnpm test`: pass — 6614 tests, 0 failures, exit 0
- [ ] `pnpm verify`: not run locally. `ci:assert-staging` cannot exit 0 outside CI, so branch `verify` is measured by CI on the PR head rather than claimed here.
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS — `operator-ui` matched, whose only requirement is `qa-experience`; no R2-R5 artifact is triggered.

## Mutation control

The repair is a `try`/`catch` around the optional anon resolution. Removing it and
re-running the same unmodified test file:

```
--- MUTANT (try/catch removed) ---
ok 1 - PRECONDITION: an unguarded anon resolve really does throw when the anon key is absent
not ok 2 - resolveOptionalAnonConnection degrades to nulls instead of throwing
ok 3 - resolveOptionalAnonConnection still returns real credentials when anon is configured
not ok 4 - a snapshot survives an unavailable anon connection with its real reads intact
# pass 2
# fail 2

--- RESTORED ---
# tests 4
# pass 4
# fail 0
```

Test 1 passing under the mutant is correct, not a gap: it asserts the *unguarded*
resolution throws, which is exactly what the mutant restores.

## Runtime Verification

**The defect was measured in production before it was repaired.** Measured 2026-09-19
against the deployed release `92a7e5d32` in container `unit-talk-command-center-1`,
through the authenticated operator path:

| Measurement | Result |
|---|---|
| `SUPABASE_URL` in the running container | PRESENT (length 40; value never printed) |
| `SUPABASE_SERVICE_ROLE_KEY` in the running container | PRESENT (length 219; value never printed) |
| `SUPABASE_ANON_KEY` in the running container | **MISSING** |
| `/` Overview, authenticated browser | `GLOBAL HEALTH unavailable`, `API HEALTH Down` |
| `/exceptions`, authenticated browser | `PARTIAL DATA — System Health pipeline health: SUPABASE_URL and SUPABASE_ANON_KEY are required for Supabase anon access` |
| `/picks`, same session | 8 governed picks rendered — the service-role reads were working throughout |

The last row is the point: the privileged reads succeeded on every page while health
reported itself unavailable. That is the false negative this lane removes.

### Deployed-browser proof — explicitly not claimed

The issue's acceptance names a deployed-browser confirmation that global health renders a
real state. That requires this repair to be *running*, and dispatching a production
deployment is **reserved action 8**. It is therefore not asserted here, and the
corresponding assertion box above is left unchecked.

What this bundle establishes is the boundary it can establish: the repair, its regression
coverage, its mutation control, and the measured production precondition. The
after-state is confirmable only after a deploy, and belongs to that step.

## UI verification evidence (delivery-ui lane artifacts)

`screenshot-desktop.png` (1440x900, full page) and `screenshot-mobile.png` (390x844)
were captured through the authenticated operator path against the **deployed** Command
Center at release `92a7e5d32`, at 2x device scale.

**Read them as before-state defect evidence, not as proof the repair renders.** They show
exactly what this lane removes, at both viewports:

| Element | What the screenshots show |
|---|---|
| Sidebar `GLOBAL HEALTH` | `down` |
| Overview `API HEALTH` tile | `Down` |
| `WORKER STATE` tile | `Blocked` |
| `PENDING OUTBOX AGE` | `73739m — Needs attention` |

The after-state — the same two viewports showing a real health state and no
pipeline-health `PARTIAL DATA` banner — requires this repair to be **running**, and
dispatching a production deployment is reserved action 8. It is therefore not in this
bundle and is not claimed anywhere in it. That acceptance belongs to the deploy
checkpoint.

### Lane reclassification (PM finding, exact head `ddac75b7`)

This lane was opened with `lane_type: runtime`, which was wrong: `apps/command-center/**`
is admitted by `delivery-ui`, and `runtime`'s allowlist does not contain it. The cause was
an incorrect `--lane-type claude` at lane-start — `claude` is a legacy *executor* alias, so
the canonical type fell through to `runtime`. The correct form is
`--lane-type delivery-ui --executor claude`.

Corrected per `LANE_MANIFEST_SPEC.md` §14, which treats a mis-typed lane as a manifest
correction rather than a lane teardown. Measured both ways locally:

```
$ npx tsx scripts/lane-check.ts --lane delivery-ui --base origin/main --head HEAD
lane:check PASS lane=delivery-ui files=7

$ npx tsx scripts/lane-check.ts --lane runtime --base origin/main --head HEAD
lane:check FAIL lane=runtime
- outside_allowed_paths: apps/command-center/src/lib/data/pipeline-health.test.ts ...
- outside_allowed_paths: apps/command-center/src/lib/data/pipeline-health.ts ...
```

`file_scope_lock` was **not** widened — every path it already held is inside
`delivery-ui`'s allowlist (`apps/command-center/**`, `.ops/sync/**`,
`docs/06_status/lanes/**`, `docs/06_status/proof/**`). `expected_proof_paths` gained the
two screenshot artifacts that `.lane/lanes/delivery-ui.yml` requires.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Approved PR head: pending merge
Execution SHA: 8f0e8f53826de67b60412a223b05d2391c207df9
