# PROOF: UTV2-1819

MERGE_SHA: 07e0bcf0457d2134c5135f5b1987eada9a2de71d

Lane: claude / `claude/utv2-1819-lane-maximizer-page-size`
Tier: T1 (Tier C path — `scripts/ops/lane-maximizer.ts`)
Proof Artifact: docs/06_status/proof/UTV2-1819/verification.md

## Verification

ASSERTIONS:

- [x] **AC1 — bare invocation works against the live Linear API.** `pnpm ops:lane-maximizer` with no
      flags exits 0 and returns a candidate report (114 candidates). Before this change it exited 1
      with `candidate_discovery_failed`.
- [x] **AC2 — the page size is provably under Linear's complexity budget**, with margin below the
      measured 75 boundary. Proven by mutation M1.
- [x] **AC3 — pagination still walks the entire population.** The page size is a transport detail and
      never caps discovery; the pre-existing pagination regressions pass unchanged.
- [x] **AC4 — a regression fails if the constant is raised or the node selection widens**, instead of
      the production factory failing. Proven by mutation M2.
- [x] **AC5 — no ranking, admission or business-policy change.** The diff is confined to
      `scripts/ops/lane-maximizer.ts` and `scripts/ops/lane-maximizer.test.ts`.
- [x] **AC6/AC7 — whole-board capacity is stated in nodes, not implied by the page size.** A board
      of exactly `LINEAR_CANDIDATE_MAX_NODES` (10000) is fully discoverable; one node beyond it
      fails closed. Proven by mutations M3 and M4.
- [x] **AC8 — changing the page size alone cannot change the supported node ceiling.** The loop
      bound is derived from the ceiling, at every page size tested.

## Root cause

`LINEAR_CANDIDATE_PAGE_SIZE` was `100`, passed as `first:` on the `LaneCandidates` query. The
selection contains two nested connections (`labels { nodes }`, `relations { nodes }`), which Linear
prices per node. Measured against the live API with the real team id:

```json
{"message":"Query too complex","extensions":{"code":"INPUT_ERROR","statusCode":400,
 "userPresentableMessage":"The query is too complex. Complexity: 11601.000000000002. Maximum allowed complexity: 10000."}}
```

Measured boundary, same query, same team, varying only `first:`:

| `first:` | result |
|---|---|
| 100 | HTTP 400 — complexity 11601 / 10000 |
| 75 | OK |
| 60 | OK |
| 50 | OK |
| 40 | OK |
| 25 | OK |

The ceiling always existed. Before UTV2-1699, `--linear-limit` defaulted to 10 and was clamped to
`Math.min(limit, 50)`, so `first:` never exceeded 50. UTV2-1699 correctly removed that cap — it was
silently truncating the candidate population, which was the bug being fixed — and the page size then
reached its declared constant of 100 for the first time. UTV2-1699's regressions did not catch it
because the fake transport does not model Linear's complexity budget.

## Second defect, found in PM review: capacity was an accident of the transport

The first revision of this lane changed `LINEAR_CANDIDATE_PAGE_SIZE` from 100 to 50 and left the
pagination guard as `page > LINEAR_CANDIDATE_MAX_PAGES` with `MAX_PAGES = 100`. The supported
population ceiling was therefore the PRODUCT of two unrelated constants -- and halving the page size
silently halved it from 10000 nodes to 5000. No constant anywhere stated that limit, so a board of
6000 issues would have started failing discovery with no line of code admitting why.

That is the same class of defect as the outage this lane was opened to fix: a real limit that exists
only as a side effect and is therefore invisible until it fires.

**Repair.** The ceiling is now named in the unit it governs:

```ts
export const LINEAR_CANDIDATE_MAX_NODES = 10_000;

export function linearCandidateMaxPages(pageSize = LINEAR_CANDIDATE_PAGE_SIZE): number {
  return Math.ceil(LINEAR_CANDIDATE_MAX_NODES / pageSize) + 1;
}
```

The walk now fails closed on `nodes.length > LINEAR_CANDIDATE_MAX_NODES` (checked after each page
lands, so a board of exactly the ceiling is fully discoverable and only the first node beyond it
refuses). The page bound is derived from the node ceiling and is deliberately one page looser than
the ceiling strictly requires: it is not the capacity guard, it exists solely so a server returning
empty pages while still reporting `hasNextPage` terminates instead of looping forever. The loop is
bounded at every page size; it is not unbounded pagination.

Pre-change supported capacity (10000 nodes) is preserved exactly. The node ceiling is skipped when
an operator passes an explicit `--linear-limit`, because that is a deliberate smaller sample rather
than a claim about the whole board.

## Fix

`LINEAR_CANDIDATE_PAGE_SIZE` 100 → **50** (~5801 projected complexity, ~58% of budget). Three new
exported constants make the reasoning explicit and testable: `LINEAR_CANDIDATE_COMPLEXITY_BUDGET`,
`LINEAR_CANDIDATE_MEASURED_COMPLEXITY_PER_NODE`, `LINEAR_CANDIDATE_NESTED_CONNECTIONS`. The query
was extracted to an exported `LINEAR_CANDIDATE_QUERY` so the regression inspects the real query text
rather than a copy that could drift from it.

## Receipt — AC1, live Linear API, bare invocation

```text
$ pnpm ops:lane-maximizer
BARE INVOCATION OK — candidates discovered: 114
dispatch_limits: {"max_claude": 4, "max_codex": 6, "active_claude": 1, "active_codex": 0, "claude_available": true, "codex_available": true}
recommended: 0
exit=0
```

Note: the `--linear-limit 50` workaround used to read the board before this fix returned only **43**
of the **114** real candidates, because the flag caps the population as well as the page size. The
bare, fixed invocation is the first complete read of the board.

## Receipt — full suite at the anchor

```text
$ pnpm exec tsx --test scripts/ops/lane-maximizer.test.ts
1..81
# tests 81
# suites 0
# pass 81
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

75 pre-existing regressions, unchanged + 6 new (AC2, AC3, AC4 for the complexity budget; AC6, AC7, AC8 for whole-board capacity) = 81.

## Mutation proof

Each mutation was applied to the working tree at the anchor, the targeted specs run, and the file
restored from a byte-exact backup; the 81/81 baseline was reconfirmed after each.

### M1 — restore the shipped defect (`LINEAR_CANDIDATE_PAGE_SIZE = 100`)

```text
not ok 1 - UTV2-1819 AC2: the candidate page size stays inside Linear query-complexity budget
ok 2 - UTV2-1819 AC4: the measured per-node cost still matches the query it was measured against
ok 3 - UTV2-1819 AC3: the bounded page size reaches the wire and never caps discovery
# tests 3
# pass 2
# fail 1
```

Caught by AC2, the spec that owns the constant's value.

**Stated limit, not a claim of coverage:** AC3 *passes* under M1 and cannot catch it. AC3 asserts
that the wire limit equals `LINEAR_CANDIDATE_PAGE_SIZE`, so when the constant moves the expectation
moves with it. AC3's job is to prove the constant reaches the transport at all and that a smaller
page does not cap discovery — not to police its value. AC2 is the only guard on the value, and M1
proves it fires.

### M2 — widen the node selection with a third nested connection

```text
ok 1 - UTV2-1819 AC2: the candidate page size stays inside Linear query-complexity budget
not ok 2 - UTV2-1819 AC4: the measured per-node cost still matches the query it was measured against
ok 3 - UTV2-1819 AC3: the bounded page size reaches the wire and never caps discovery
# tests 3
# pass 2
# fail 1
```

Caught by AC4. This is the important one: adding a connection silently re-prices every node and
would reintroduce the outage at a page size that is otherwise in budget. AC2 correctly does not
fire, because the constant itself is still fine — only the measurement behind it went stale.

### M3 — restore the page-count guard (`linearCandidateMaxPages` returns a constant 100)

This is the shipped defect the PM review caught: capacity = pages x page size.

```text
ok 78 - UTV2-1819 AC3: the bounded page size reaches the wire and never caps discovery
not ok 79 - UTV2-1819 AC6: a board at the supported maximum is fully discoverable
not ok 80 - UTV2-1819 AC7: a board one node over the supported maximum fails closed
not ok 81 - UTV2-1819 AC8: page size does not define the supported node ceiling
# tests 81
# pass 78
# fail 3
```

All three capacity regressions fire. AC6 fails because a 10000-node board is truncated at 5000 by a
page guard the page size silently halved; AC7 fails because the refusal that does fire names pages,
not the node ceiling; AC8 fails because capacity is once again a function of the page size.

### M4 — delete the node-ceiling refusal (fail open on an over-capacity board)

```text
ok 79 - UTV2-1819 AC6: a board at the supported maximum is fully discoverable
not ok 80 - UTV2-1819 AC7: a board one node over the supported maximum fails closed
ok 81 - UTV2-1819 AC8: page size does not define the supported node ceiling
# tests 81
# pass 80
# fail 1
```

Caught by AC7 alone, which is correct: with the refusal deleted an over-capacity board is returned
truncated and silent. AC6 and AC8 do not fire because neither the ceiling constant nor the derived
page bound has moved -- only the enforcement is gone. This is the fail-open the guard exists to
prevent, and exactly one test names it.

### Baseline after restore

```text
# tests 81
# pass 81
# fail 0
```

`git status --porcelain scripts/ops/lane-maximizer.ts` reported the file modified only while a
mutation was applied, and clean against the committed anchor afterwards.

## EVIDENCE:

Two distinct populations of evidence, kept distinct on purpose. The workstation run REFUSED at the
live-DB step and is reported as a refusal; it is not a pass and is not counted as one. The
authoritative T1 verification is the hosted run at this exact anchor, bound below by run and job id.

### A. Workstation run -- `pnpm verify`, exit 1, REFUSED (not a pass)

```text
$ pnpm verify
# tests 5538
# pass 5538
# fail 0
# skipped 0
exit=1
```

Zero `not ok` lines across the whole run (`grep -cE '^not ok'` = 0). The non-zero exit comes from
the final `test:live-db` step and nothing else:

```text
> tsx scripts/ci/assert-staging-target.ts
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub
environment with CI_SUPABASE_* credentials.
```

`env:check`, `lint`, `pnpm type-check`, `build`, the entire `pnpm test` tree, `verify:static` and
`verify:commands` are exit 0 in this run. **That does not make `pnpm verify` a PASS here.** The
command exited 1, the guard refused, and this bundle records it as `REFUSED_AT_LIVE_DB`. A
workstation cannot produce the writable-staging receipt, by design.

### B. Hosted verification at this exact anchor -- the authoritative T1 receipts

Anchor: `07e0bcf0457d2134c5135f5b1987eada9a2de71d`.

| Check | Conclusion | Run | Job |
|---|---|---|---|
| `verify` (required) | **success** | `33557203041` | `100023164118` |
| `Writable DB proof (staging only)` | **success** | `33557203041` | `100020943245` |
| `P0 Protocol` (required) | **success** | `33557202924` | `100020834546` |
| `T1 Proof Gate` | **success** | `33557203052` | `100021090130` |

The staging job is where the live-DB proof this lane cannot run locally actually executed. Its steps
at this anchor, all `success`:

```text
 6 | Assert staging credentials present          | success
 7 | Materialize staging-only environment        | success
 8 | Record repository migration head            | success
 9 | Seed synthetic staging fixtures             | success
10 | Run writable DB proof against staging       | success
11 | Run the T1 live proof suites against staging| success
13 | Upload proof receipt (same-run artifact)    | success
```

Step 11 is the T1 live proof suite execution. It ran against the staging project
(`xskgrzbteyqdufktjrjx`), which is the target the workstation guard refused to substitute for.


### `pnpm type-check`

```text
$ pnpm type-check
> pnpm exec tsc -b tsconfig.json
```

Exit 0, no diagnostics.

### `pnpm test`

The full `pnpm test` tree runs inside `pnpm verify` above: 5538 tests, 5538 pass, 0 fail, 0 skipped.
The lane's own suite in isolation:

```text
$ pnpm exec tsx --test scripts/ops/lane-maximizer.test.ts
1..81
# tests 81
# pass 81
# fail 0
```

### `scripts/ci/r-level-check.ts`

```text
$ pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1819
Verdict: PASS
Changed files: 8
Rules matched: (none) — no R-level artifacts required for this diff
```

### `pnpm ops:sync-check`

```text
[sync-check] OK (per-issue): branch "claude/utv2-1819-lane-maximizer-page-size" <-> .ops/sync/UTV2-1819.yml
```

## Scope boundary

No ranking, admission, tier or business-policy logic is touched. `git diff` is confined to
`scripts/ops/lane-maximizer.ts` and `scripts/ops/lane-maximizer.test.ts`.

## Known limitations

- The per-node complexity figure (116.01) is a single live measurement taken 2026-09-01. If Linear
  re-prices its schema the constant becomes stale; AC2's 75%-of-budget margin absorbs modest drift,
  and AC4 catches the selection-side cause, but neither can detect a server-side re-pricing. Only a
  live call can, and AC1 is that call — run manually, not in CI.
- AC3 cannot catch M1, as stated above. AC6 and AC8 likewise cannot catch M4: deleting the
  enforcement moves neither the ceiling constant nor the derived page bound, so only AC7 fires.
- The node ceiling of 10000 is a POLICY limit, not a measured one. It preserves the capacity that
  existed before this lane; nothing here establishes that a board of 10000 is the largest Linear
  would serve, only that a larger one refuses instead of truncating silently.
- The capacity regressions run against a synthetic in-process transport. They prove the walk's own
  arithmetic and refusal behaviour; they do not exercise Linear's real cursor semantics at that
  scale, and no test in this bundle does.
