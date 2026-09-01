# PROOF: UTV2-1699 — diff summary

MERGE_SHA: 6c67131294141c4f4be1acd6f16f94b8c6614a76

`lane-maximizer discovery repair: bare invocation returns an empty board; discovery failure fails open`

Two source files changed. No runtime, domain, DB, delivery, workflow-authority or
concurrency-config file is touched, and no business ranking policy is changed.

| File | Insertions / deletions | What changed |
|---|---|---|
| `scripts/ops/lane-maximizer.ts` | +296 / −74 | Candidate-source selection, Linear pagination, fail-closed CLI |
| `scripts/ops/lane-maximizer.test.ts` | +404 / −1 | 11 new regressions for the four repaired controls plus the ranking-invariance golden |

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

Eleven new regressions, each naming the control it proves and the mutation that must
break it. All 67 tests in the file pass; the 56 pre-existing tests are unmodified.

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
