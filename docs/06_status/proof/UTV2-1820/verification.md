# PROOF: UTV2-1820

MERGE_SHA: 565b578eaa8280e01ae164f3dc474fab2c629cd6

Lane: claude / `claude/utv2-1820-blocks-relation-direction`
Tier: T2 (Tier C path — `scripts/ops/lane-maximizer.ts`)
Proof Artifact: docs/06_status/proof/UTV2-1820/verification.md

## Verification

ASSERTIONS:

- [x] **AC1 — outgoing `blocks` relations are no longer counted as prerequisites.** Only the inverse
      edge can produce `BLOCKED_DEP`. Proven by mutation N1.
- [x] **AC2 — the direction was confirmed against the live Linear schema, not inferred from the type
      string.** Both ends of one real edge were read directly; receipts below.
- [x] **AC3 — a regression that fails on the shipped behaviour, both halves.** A candidate whose only
      relation is an outgoing `blocks` to an incomplete issue is admitted (N1 breaks it); a candidate
      with a real incoming incomplete prerequisite is still refused (N2 breaks it).
- [x] **AC4 — fail-closed preserved.** An absent or unreadable relation set blocks under a sentinel
      that no completion check can satisfy. Proven by mutations N2 and N3.
- [x] **No ranking, tier-policy, acceptance-parser or other admission change.** The diff is confined
      to `scripts/ops/lane-maximizer.ts` and `scripts/ops/lane-maximizer.test.ts`.

## Root cause

```ts
export function isBlockingLinearRelationType(type: string): boolean {
  return type === 'blocks' || type === 'blocked_by';
}
```

applied to `relations { nodes { type relatedIssue { identifier } } }` — the connection where the
candidate is the **source** of the relation.

## AC2 — live Linear evidence for the direction

Both ends of one real edge, read from `api.linear.app` on 2026-09-01:

```json
"UTV2-1771": {
  "relations":        { "nodes": [ { "type": "blocks", "relatedIssue": { "identifier": "UTV2-1370" } } ] },
  "inverseRelations": { "nodes": [ { "type": "related", "issue": { "identifier": "UTV2-1820" } } ] }
},
"UTV2-1370": {
  "inverseRelations": { "nodes": [ { "type": "blocks", "issue": { "identifier": "UTV2-1771" } },
                                   { "type": "blocks", "issue": { "identifier": "UTV2-1736" } } ] }
}
```

The **same** edge appears on both ends carrying `type: "blocks"`. The type string therefore does not
encode direction at all — the connection does:

| Connection | `type: "blocks"` means | Prerequisite? |
|---|---|---|
| `relations` (issue is source) | this issue blocks the related one | **no** — the related issue is downstream |
| `inverseRelations` (issue is target) | the named issue blocks this one | **yes** |

`blocked_by` was never observed on the wire in this team; the vocabulary returned is `blocks` and
`related`. It is still honoured on both edges — on the inverse edge it unambiguously names a
prerequisite, and on the outgoing edge it would mean "this issue is blocked by the related one",
which is also a prerequisite. Accepting it costs nothing; refusing it would fail open.

## Fix

`inverseRelations { nodes { type issue { identifier } } }` added to the real query;
`isBlockingLinearRelationType` replaced by two named predicates,
`isPrerequisiteInverseRelation` and `isPrerequisiteOutgoingRelation`, so the direction is stated
rather than implied by which call site happens to use it.

Fail-closed handling is explicit: a missing `inverseRelations` connection, or a relation whose
`issue` is null, yields `LINEAR_UNREADABLE_RELATIONS_SENTINEL` as a prerequisite. It is not a real
identifier, so no completion check can ever resolve it and the candidate stays `BLOCKED_DEP`.
Silence from the server is not evidence that an issue is unblocked.

### The query got more expensive, and the page size had to move with it

Adding a third nested connection re-prices every node. Re-measured against the **real**
`LINEAR_CANDIDATE_QUERY` text on 2026-09-01, varying only `first:`:

| `first:` | two connections (shipped) | three connections (this change) |
|---|---|---|
| 100 | **400** — complexity 11601 / 10000 | **400** — complexity 22601 / 10000 |
| 75 | OK | **400** — 16951 |
| 60 | OK | **400** — 13561 |
| 50 | OK | **400** — 11301 |
| 40 | OK | OK |
| 30 | OK | OK |

So ~226.01 per node, up from ~116.01. **The page size of 50 that was correct for the previous
selection is not correct for this one** — it would be rejected outright, reproducing the UTV2-1819
outage. `LINEAR_CANDIDATE_PAGE_SIZE` therefore moves 50 → **30** (~6780, ~68% of budget),
`LINEAR_CANDIDATE_MEASURED_COMPLEXITY_PER_NODE` 116.01 → **226.01**, and
`LINEAR_CANDIDATE_NESTED_CONNECTIONS` 2 → **3**.

The whole-board node ceiling (`LINEAR_CANDIDATE_MAX_NODES = 10000`) is unchanged; the page bound is
derived from it, so capacity does not move when the page size does. That property has its own
regression (UTV2-1819 AC8) and it still passes.

UTV2-1819's AC4 guard is what forced this: mutation N4 shows that removing `inverseRelations` from
the query while leaving the constants alone fails that test. The guard did exactly the job it was
built for.

## Receipt — live board, before and after

```text
$ pnpm ops:lane-maximizer --json
candidates_total: 107
blocked solely on BLOCKED_DEP: 4  [UTV2-1677, UTV2-1806, UTV2-1807, UTV2-1808]
```

Before this change the same query returned **10**:
`UTV2-1407, UTV2-1425, UTV2-1429, UTV2-1677, UTV2-1771, UTV2-1773, UTV2-1805, UTV2-1806, UTV2-1807, UTV2-1808`.

Each of the six freed candidates was verified against live Linear to have **no** incoming blocker,
and each of the four still refused to have a real, incomplete one:

```text
UTV2-1425   incoming_blockers=[]                              outgoing=[blocks UTV2-1508, blocks UTV2-1430]
UTV2-1771   incoming_blockers=[]                              outgoing=[blocks UTV2-1370]
UTV2-1773   incoming_blockers=[]                              outgoing=[blocks UTV2-1775, blocks UTV2-1774]
UTV2-1806   incoming_blockers=[blocks UTV2-1805 (backlog)]    outgoing=[blocks UTV2-1808]
UTV2-1807   incoming_blockers=[blocks UTV2-1805 (backlog)]    outgoing=[]
UTV2-1808   incoming_blockers=[blocks UTV2-1806 (backlog)]    outgoing=[]
UTV2-1677   incoming_blockers=[blocks UTV2-1606 (started)]    outgoing=[]
```

This is the half that matters most: the fix does not simply unblock everything. The four genuine
dependencies still refuse.

## Mutation proof

Each mutation was applied at the anchor, the suite run, and the file restored from a byte-exact
backup; 88/88 was reconfirmed after each.

### N1 — restore the shipped inversion (outgoing `blocks` counts as a prerequisite)

```text
not ok 11 - generic Linear related links are not treated as blocking dependencies
not ok 82 - UTV2-1820 AC1: an outgoing "blocks" relation is not a prerequisite
# tests 88
# pass 86
# fail 2
```

### N2 — stop reading the inverse edge (fail open on real prerequisites)

```text
not ok 83 - UTV2-1820 AC3: a real incoming prerequisite still blocks
not ok 84 - UTV2-1820: both edges at once — only the incoming one counts
not ok 85 - UTV2-1820 AC4: an absent relation set blocks rather than silently admitting
not ok 86 - UTV2-1820 AC4: a prerequisite with no identifier blocks rather than vanishing
# tests 88
# pass 84
# fail 4
```

This is the AC3 "must still refuse" half. Note AC1 correctly does **not** fire: dropping the inverse
edge makes the tool block less, not more, so only the refusal tests can catch it.

### N3 — treat an absent relation set as an empty one (the exact fail-open AC4 names)

```text
not ok 85 - UTV2-1820 AC4: an absent relation set blocks rather than silently admitting
# tests 88
# pass 87
# fail 1
```

Exactly one test owns this property, and it fires.

### N4 — drop `inverseRelations` from the shipped query only

```text
not ok 77 - UTV2-1819 AC4: the measured per-node cost still matches the query it was measured against
not ok 88 - UTV2-1820: the shipped query requests the inverse edge
# tests 88
# pass 86
# fail 2
```

Both the new query assertion and UTV2-1819's complexity guard fire. Without the second one, a query
edited back to two connections would leave the constants claiming 226.01 and the page size at 30 —
wrong, but silently so.

### Baseline after every restore

```text
# tests 88
# pass 88
# fail 0
```

## EVIDENCE:

### `pnpm verify`

```text
$ pnpm verify
# tests 5545
# pass 5545
# fail 0
# skipped 0
exit=1
```

Zero `not ok` lines across the whole run. **The command exited 1 and is recorded as a refusal, not a
pass.** `env:check`, `lint`, `pnpm type-check`, `build`, the entire `pnpm test` tree, `verify:static`
and `verify:commands` are exit 0 within it; the non-zero exit is the final `test:live-db` step, where
`assert-staging-target` refuses a workstation target (`host=127.0.0.1`, expected
`xskgrzbteyqdufktjrjx`) by design. Hosted CI at this anchor is the authoritative receipt.

### `pnpm type-check`

Exit 0, no diagnostics.

### `pnpm test` — lane suite in isolation

```text
$ pnpm exec tsx --test scripts/ops/lane-maximizer.test.ts
# tests 88
# pass 88
# fail 0
```

81 pre-existing (all still passing, including UTV2-1819's capacity and complexity regressions) + 7
new = 88.

### R-level check — `scripts/ci/r-level-check.ts`

```text
$ pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1820
Verdict: PASS
Changed files: 8
Rules matched: (none) — no R-level artifacts required for this diff
```

Exit 0. No R-level rule in `docs/05_operations/r1-r5-rules.json` matches this diff, so no rule's
`required[]` artifacts are triggered. That is an evaluated verdict, not a skipped check: the run
enumerated the changed files and matched them against every rule.

## Scope boundary

`git diff` is confined to `scripts/ops/lane-maximizer.ts` and `scripts/ops/lane-maximizer.test.ts`.
No ranking, tier policy, acceptance parser, or other admission criterion is touched.

## Known limitations

- **The page size drop is a real throughput cost.** At 30 nodes per page a full 107-candidate board
  takes 4 round trips instead of 3, and the derived page bound rises to 334. Bounded, but the
  whole-board read is now measurably slower. The alternative — keeping 50 — does not work at all.
- **226.01 per node is a single live measurement from 2026-09-01**, with the same staleness exposure
  UTV2-1819 recorded: a server-side re-pricing by Linear invalidates it and no offline test can
  detect that.
- **`blocked_by` is accepted on both edges but was never observed on either.** That branch is
  therefore reasoned-about, not measured. It is deliberately the fail-closed direction: accepting it
  can only add prerequisites, never remove them.
- **The regressions use the in-process fake transport.** They prove the mapping and the refusal, not
  Linear's real cursor semantics; the live receipt above is the only end-to-end evidence here.
- **The unreadable-relations sentinel is a string identifier.** If an issue were ever literally named
  `UNREADABLE-RELATIONS` the two would collide. No such identifier exists in the `UTV2` scheme,
  which is `UTV2-\d+`.
