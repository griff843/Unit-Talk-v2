# PROOF: UTV2-1699 — diff summary

MERGE_SHA: f0d21d23d6839195d2b3c03f914f51cd12339d61

`lane-maximizer discovery repair: bare invocation returns an empty board; discovery failure fails open`

Two source files changed. No runtime, domain, DB, delivery, workflow-authority or
concurrency-config file is touched, and no business ranking policy is changed.

| File | Insertions / deletions | What changed |
|---|---|---|
| `scripts/ops/lane-maximizer.ts` | +501 / −70 | Candidate-source selection, Linear pagination, canonical capacity classification, fail-closed CLI |
| `scripts/ops/lane-maximizer.test.ts` | +774 / −1 | 18 new regressions for the repaired controls plus the ranking-invariance golden |

## `scripts/ops/lane-maximizer.ts`

### 1. Defect 0 — a bare invocation never queried any candidate source

`runCli()` previously did:

```ts
if (hasFlag(argv, '--from-linear'))      candidates = await fetchLinearCandidates(argv);
else if (hasFlag(argv, '--from-queue'))  candidates = parseQueueCandidates(...);
else                                     candidates = parseCandidatesArg(argv);  // no flag => []
```

All three dispatch skills invoke the tool bare, so control always reached
`parseCandidatesArg(argv)`, which parses an empty argv (via a blocking read of fd 0)
into zero candidates.

Source selection is now an explicit, exported, separately testable function:

```ts
export function resolveCandidateSource(argv: string[]): CandidateSource {
  if (hasFlag(argv, '--from-queue')) return 'queue';
  if (hasFlag(argv, '--candidates') || hasFlag(argv, '--from-stdin')) return 'explicit';
  return 'linear';
}
```

A bare argv now resolves to `linear` — the canonical candidate source.
`--from-linear` still works and is now redundant. A caller that genuinely wants to
supply the population itself must say so with `--candidates` or `--from-stdin`;
this also removes the pre-existing hazard where a bare invocation on a TTY blocked
forever reading stdin.

### 2. Defect 3 — the eligible population was truncated to 10 by recency

`fetchLinearCandidates()` requested a single `first: $limit` page ordered by
`updatedAt`, defaulting to 10 and hard-capped at 50, against a board of ~115
issues in candidate states.

The query is now a cursor walk (`after: $cursor`, `pageInfo { hasNextPage endCursor }`)
at `LINEAR_CANDIDATE_PAGE_SIZE = 100` per page, continuing until Linear reports no
next page. `--linear-limit` is retained but demoted to an OPTIONAL ceiling for an
operator who deliberately wants a smaller sample; unset — the canonical dispatch
invocation — means the whole eligible population, and the 50 clamp is gone.

Two fail-closed guards on the walk itself: `LINEAR_CANDIDATE_MAX_PAGES = 100` and a
refusal when Linear reports `hasNextPage: true` with a null cursor. Neither returns
the pages collected so far — a truncated population is exactly the fail-open this
lane removes.

The function is now exported and takes an injection seam
(`LinearCandidateFetchDeps { query, token }`) so pagination and transport failure
are provable offline.

### 3. Defects 1 and 8 — every discovery failure became "empty board, exit 0"

The wrapping `catch` in `runCli()` set `candidates = []`, `activeLanes = []`, wrote
the error to stderr, emitted a normal-shaped report on stdout and set
`process.exitCode = 0`. The `activeLanes = []` half meant every downstream capacity
and file-conflict check saw zero active lanes.

`runCli()` is replaced by an exported, testable `runMaximizerCli(argv, deps)`
returning `{ exitCode, stdout, candidate_source, report?, error? }`, with the two
failure conditions handled separately and fail-closed:

| Condition | Code | Exit |
|---|---|---|
| Candidate source unreadable | `candidate_discovery_failed` | 1 |
| Active-lane set unknown | `active_lane_discovery_failed` | 1 |

They carry different messages and different remediations (Linear token/network vs
`gh` auth and unreadable manifests) and are never collapsed. The failure payload on
stdout is a `MaximizerErrorEnvelope` — `{ ok: false, error: true, code, message,
remediation, candidate_source }` — which deliberately has no `recommended` /
`blocked` / `risky` / `deferred` / `dispatch_limits` keys at all, so a machine
consumer reading `.recommended` gets `undefined` rather than an empty array it would
misread as "no work available" (requirement 7).

A genuinely empty candidate population still produces a real report and exit 0
(requirement 6), which is what keeps the repair from degenerating into "always fail".

### 4. Defect 2 — active lanes were read from local manifest files only

`readActiveLanes()` read `LANE_DIR` and filtered by `ACTIVE_LOCK_STATUSES`, never
consulting open-PR-head manifests. Measured on `main` 2026-09-01: zero
active-status manifests locally while three lanes were live, each with its manifest
on its own PR head.

It is replaced by `resolveActiveLanesCanonically()`, which delegates to
`resolveActiveLaneManifests()` in `scripts/ops/shared.ts` — the same canonical
resolver `ops:lane-start` and `ops:execution-state` use. That resolver unions the
local manifest population with every open PR's manifest read at that PR's own head
ref, and throws `ActiveLaneDiscoveryError` rather than returning a smaller board
when any part of the enumeration cannot be completed. A partial manifest read is
therefore a failure, not a smaller board (requirement 8) — the previous local read
silently dropped unparseable manifests.

`readLaneManifests()` is retained only for `readDoneIssueIds()`.

### 5. Type alignment (mechanical)

`LaneManifest.executor` is now optional and `status` / `tier` use the canonical
`LaneManifestStatus` / `LaneTier` unions from `shared.ts`, so the resolver's output
is assignable to `evaluateCandidates()` verbatim. This also makes the `parked`
status — which is inside `ACTIVE_LOCK_STATUSES` — representable here for the first
time; it previously was not.

### Explicitly NOT changed

`scoreCandidate()`, `rankCandidates()`, `evaluateCandidates()`, `classifyViolation()`,
`REASON_MESSAGES`, `checkConcurrencyLimits()` usage, the wave-projection loop, the
singleton / forbidden-combination / type-cap / verification-target / delivery-UI /
file-scope-overlap gates, and `docs/governance/CONCURRENCY_CONFIG.json`. Tier /
priority weighting, support-lane caps and production-first ordering belong to
UTV2-1769. Ranking invariance is proven byte-identical against the pre-change
implementation in `verification.md`.

## `scripts/ops/lane-maximizer.test.ts`

Eighteen new regressions, each naming the control it proves and the mutation that must
break it. All 75 tests in the file pass; the 57 pre-existing tests are unmodified
(57 + 18 = 75).

- **AC1** — `resolveCandidateSource([]) === 'linear'`, and a bare `runMaximizerCli([])`
  with an eligible candidate present returns a non-empty board. The source-selection
  assertion is deliberately first: under the pre-repair fallthrough
  `parseCandidatesArg()` blocks on fd 0, so a regression that only observed the
  resulting empty board would hang rather than fail.
- **AC2** — a three-page fake Linear transport; candidates on pages 2 and 3 must be
  discovered. Plus: `hasNextPage: true` with a null cursor fails closed.
- **AC3** — an injected transport failure (and separately an auth failure on the team
  resolve) exits 1 with `candidate_discovery_failed`, and the stdout payload carries
  no report-shaped keys.
- **AC4** — an injected open-PR enumeration failure exits 1 with
  `active_lane_discovery_failed`; asserted to be a different code AND a different
  remediation from AC3's. Plus: an unreadable local manifest is the same fail-closed
  class, not a smaller board.
- **AC5** — a genuinely empty candidate population exits 0 with a real report
  carrying `dispatch_limits`.
- **AC6** — a manifest present ONLY on an open PR head (local population deliberately
  empty) counts against `active_codex`, and a candidate overlapping its file scope is
  blocked on `OVERLAP`.
- **AC8** — a literal golden of `rank` / `ranking_score` / `ranking_reasons` for a
  fixed three-candidate set.

## Round 2 — PM verdict repairs (CHANGES REQUIRED on PR #1476)

### F1 (blocker) — canonical capacity classification of the widened population

`activeLanes` is the `ACTIVE_LOCK_STATUSES` population: the set that holds a
file-scope lock. It is deliberately wider than the set that consumes an executor
slot (`EXECUTOR_CAPACITY_STATUSES`) or a lane slot (`TOTAL_CAPACITY_STATUSES`).
Round 1 widened the input from "local manifest directory" to "local ∪ open-PR
head" without applying that classification, so a dormant mis-count became live:
parked / in-review / blocked lanes would have been reported as executor
occupancy, and a *parked* migration lane would have manufactured a `migration`
singleton and a `["migration","runtime"]` forbidden pair in the forecast.

`recommended` / `blocked` were never wrong — they route through
`checkConcurrencyLimits()`, which already classifies correctly. The damage was in
`dispatch_limits`, `lane_saturation_forecast` and `safe_class_recommendations`,
which is precisely what the dispatch skills read as authority.

Three filters were added, all delegating to `classifyLaneCapacity` from
`shared.ts` — the same function `ops:execution-state` uses. No parallel policy is
defined in this file:

```ts
function executorCapacityLanes(activeLanes: LaneManifest[]): LaneManifest[] {
  return activeLanes.filter((lane) => classifyLaneCapacity(lane.status).countsAgainst.executor);
}
function totalCapacityLanes(activeLanes: LaneManifest[]): LaneManifest[] { /* .countsAgainst.total */ }
function visibleUncountedLanes(activeLanes: LaneManifest[]): LaneManifest[] { /* counts against nothing */ }
```

- `activeClaude` / `activeCodex` (and therefore `dispatch_limits`,
  `available_slots` and `safe_class_recommendations`, which are derived from
  them) now count `executorCapacityLanes(activeLanes)`.
- The singleton and forbidden-combination forecasts now read
  `activeLaneTypes(totalCapacityLanes(activeLanes))` — the same `active`
  population `checkConcurrencyLimits()` evaluates those two rules against.
- `projectedActive` is deliberately still seeded from the FULL `activeLanes`, so
  a parked lane keeps enforcing `OVERLAP` on its file scope. Not consuming
  capacity is not the same as not existing.
- `lane_saturation_forecast` gained `visible_uncounted_lanes` (parked lanes,
  named explicitly) and `capacity_classification` (which rule produced each
  number), so a consumer can never read "absent from the counts" as "absent from
  the board".

### Defect 2 — the AC2 pagination proof was vacuous

`fakeLinearDeps` served page N on the Nth call from an internal counter and never
asserted on the cursors it recorded, so deleting `after: $cursor` or the
`cursor = connection.pageInfo.endCursor` advancement left AC2 green. The fake is
now cursor-driven: page 1 is served only for cursor `null`, page N only for the
exact `endCursor` page N−1 returned, and any other cursor is a hard transport
error. AC2 additionally asserts the literal cursor sequence
(`[null, 'cursor-1', 'cursor-2']`), one query per page, and that each query text
carries `after: $cursor`, `pageInfo { hasNextPage endCursor }` and
`orderBy: createdAt`.

### Defect 3 — malformed discovered state exited 1 with empty stdout

A PR-head manifest that parses as JSON but has no array `file_scope_lock` made
the overlap scan throw a `TypeError` inside `evaluateCandidates`, which ran
outside every `try`. `void runCli()` turned that into an unhandled rejection:
non-zero exit and an EMPTY stdout, which a consumer parsing stdout cannot
distinguish from a crash-free empty board — the exact failure class this lane
exists to remove.

- `assertUsableActiveLanes()` enforces the structural contract at the discovery
  boundary (usable `issue_id`, usable `status`, array `file_scope_lock`), so the
  failure lands in the existing `active_lane_discovery_failed` envelope and names
  the offending lane.
- `evaluateCandidates` is wrapped, emitting a new `evaluation_failed` envelope
  for anything that still throws (including a throw from `readDoneIssueIds`).
- `runCli()` has a backstop `try` and `void runCli().catch(...)`. Every exit path
  now emits an envelope or a report; none emits nothing.

### Defect 4 — test-count arithmetic

Corrected throughout: 57 pre-existing + 18 new = 75.

### Defect 5 — mutable pagination ordering

The walk ordered by `updatedAt`. Linear cursors are keyset cursors over the order
field, so an issue edited mid-walk can move behind an already-consumed cursor and
be skipped — an incomplete read presented as a complete answer, one layer below
the defect this lane repairs. The walk now orders by `createdAt`, which is
immutable for the life of an issue: no issue can change its position, and an
issue created mid-walk sorts after every consumed cursor, so it is seen later or
missed by one cycle but can never displace an existing candidate. This is a
one-token change to the query plus an assertion; no architectural change was
required, so no scope widening was needed.
