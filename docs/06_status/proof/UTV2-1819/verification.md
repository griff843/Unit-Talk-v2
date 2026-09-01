# PROOF: UTV2-1819

MERGE_SHA: 194df996f09cc90d0600100939c619eba2990a5a

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
1..78
# tests 78
# suites 0
# pass 78
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

75 pre-existing (all UTV2-1699 regressions, unchanged) + 3 new = 78.

## Mutation proof

Each mutation was applied to the working tree at the anchor, the targeted specs run, and the file
restored from a byte-exact backup; the 78/78 baseline was reconfirmed after each.

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

### Baseline after restore

```text
# tests 78
# pass 78
# fail 0
```

`git status --porcelain scripts/ops/lane-maximizer.ts` reported the file modified only while a
mutation was applied, and clean against the committed anchor afterwards.

## EVIDENCE:

Commands executed against the proof anchor, in the lane worktree.

### `pnpm verify`

```text
$ pnpm verify
...
# tests 5535
# pass 5535
# fail 0
# skipped 0
```

Zero `not ok` lines across the whole run (`grep -cE '^not ok'` = 0). `pnpm verify` exits 1 at the
final `test:live-db` step only:

```text
> tsx scripts/ci/assert-staging-target.ts
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub
environment with CI_SUPABASE_* credentials.
```

`env:check`, `lint`, `pnpm type-check`, `build`, the entire `pnpm test` tree, `verify:static` and
`verify:commands` are all exit 0. This lane touches no schema, migration, DB client or query; the
writable staging receipt is produced inside required CI `verify`, which is the authority for it.

### `pnpm type-check`

```text
$ pnpm type-check
> pnpm exec tsc -b tsconfig.json
```

Exit 0, no diagnostics.

### `pnpm test`

The full `pnpm test` tree runs inside `pnpm verify` above: 5535 tests, 5535 pass, 0 fail, 0 skipped.
The lane's own suite in isolation:

```text
$ pnpm exec tsx --test scripts/ops/lane-maximizer.test.ts
1..78
# tests 78
# pass 78
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
- AC3 cannot catch M1, as stated above.
