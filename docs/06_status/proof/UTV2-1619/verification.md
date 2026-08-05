# PROOF: UTV2-1619 — capability 13: lifecycle capacity and resource release

MERGE_SHA: d2f371be10b9f82ba489e40139bc96f4c896e905

ASSERTIONS:
- [x] Truthful terminal states exist: `failed`, `superseded`, `cancelled`, plus `parked`.
- [x] No non-success terminal transitions directly into `done`; correction requires `reopened`.
- [x] Capacity is a matrix — total, executor and type populations are declared separately.
- [x] `in_review`, `blocked` and `parked` release executor capacity.
- [x] `parked` still occupies a lane slot and a type slot, so parking cannot defeat the caps.
- [x] Every terminal state releases all three capacity kinds.
- [x] Leases held by ended lanes are detected, with completion distinguished from failure.
- [x] Detection reports rather than mutates; an unknown lane state is never assumed terminal.
- [x] `ACTIVE_LOCK_STATUSES` keeps its meaning for out-of-scope consumers.
- [x] No production, runtime, migration, workflow, or delivery path is touched.

EVIDENCE:

## Verification

Executed 2026-08-05 in `.out/worktrees/claude__utv2-1619-lifecycle-resource-release`,
branch `claude/utv2-1619-lifecycle-resource-release`, based on `c499719f`.

### `pnpm type-check`

```
> pnpm exec tsc -b tsconfig.json
TC=0
```

Clean project-wide. This is the load-bearing result for the enum change: `ACTIVE_LOCK_STATUSES`
has three consumers outside this lane's scope (`reconcile.ts`, `orchestration-reconciler.ts`,
and the `file-scope-guard.ts` mirror). Its meaning was left intact and the new terminal states
were simply excluded from it, so those consumers release capacity for the new states without
being modified.

### `pnpm lint`

```
> eslint . --cache --cache-location .cache/eslint/
LINT=0
```

### `pnpm test`

```
blocks reporting a nonzero '# fail': 0
aggregate pass=4526 fail=0
TEST_EXIT=0
```

4515 baseline plus the 11 tests added here. No new test file was created — the tests extend
`concurrency-rules.test.ts` and `lease-registry.test.ts`, both already wired into `test:ops`,
so no `package.json` change was needed. That mattered: `package.json` is inside UTV2-1570's
`file_scope_lock`, and this lane will not override another lane's declared scope.

```
[automation-coverage] verdict=PASS fail=0
[executable-wiring] verdict=PASS required_roots=verify
```

### R-level check (`scripts/ci/r-level-check.ts`)

```
Verdict: PASS
Rules matched: (none) — no R-level artifacts required for this diff
```

### `pnpm verify`

`pnpm verify` was not run on this workstation; its static constituents (`type-check`, `lint`,
`test`) were run individually and are recorded above. CI runs `pnpm verify` on this PR's head
and that run is authoritative.

### Scope

```
 M scripts/ops/concurrency-rules.test.ts
 M scripts/ops/concurrency-rules.ts
 M scripts/ops/lease-registry.test.ts
 M scripts/ops/lease-registry.ts
 M scripts/ops/shared.ts
```

Five files, all inside the lane's declared `file_scope_lock`. `pnpm test:db` was not run:
governance tooling with no database access, production parked. No live-DB proof is claimed
and none is required at T2.

## What this fixes, measured

### Executor capacity counted lane existence, not executor attention

Before this change one set answered every capacity question, so a lane waiting on a human
consumed an executor slot identically to one being actively worked. On 2026-08-04 three of
the sixteen active lanes were waiting solely on a PM verdict, each holding a Claude slot
nobody was using.

`CAP-1` is the regression fixture: four lanes in `in_review` against a Claude cap of 4 must
not exhaust it. `CAP-2` asserts the opposite direction — `in_progress` does consume an
executor slot — so the fix cannot be satisfied by simply counting less.

### Parking freed nothing

`parked` releases executor capacity while retaining the lane's identity, scope lock and
history. `CAP-3` asserts both halves: no executor slot, but still a lane slot. The second
half is the important one — without it, "park it" becomes the way to defeat the caps that
capability 9 just made real.

### There was no truthful way to end a failed lane

The enum offered only `merged` and `done` as non-consuming terminals, so a lane that failed
could release its resources only by having a completion written over it. `failed`,
`superseded` and `cancelled` are now reachable from every in-flight state. `CAP-4` asserts
all five terminals release all three capacity kinds.

### A closed lane kept its lease for seventeen hours

UTV2-1634 truth-closed at `2026-08-04T20:03:44Z` — manifest on `main` reads `status: done`,
`commit_sha: 5b0c20b3`. Its lease was still `status: "active"` the next day, holding
`scripts/ops/shared.ts` and `scripts/ops/concurrency-rules.ts` — the exact files this lane
needed. Release was bound to TTL expiry, not to the lane's recorded transition; left alone
the lease would have expired at 19:18 by clock, with the lane's `done` state playing no part.

`ORPH-1` uses that exact case as its fixture. `ORPH-2` covers all five terminals and asserts
`lane_completed` distinguishes `done`/`merged` from `failed`/`superseded`/`cancelled`, so a
report can never imply a failed lane succeeded.

Two deliberate refusals, both asserted:

* `ORPH-3` — no live state is ever reported, including `parked`, which is not terminal.
* `ORPH-4` — an **unknown** lane state is skipped rather than treated as terminal. Reclaiming
  on absence would destroy a live lane's lease whenever a manifest read failed.

## Scope of this increment

This delivers the lifecycle states, the capacity matrix, and lease detection. Still open in
capability 13, and not claimed here: automatic lease release on terminal transition, worktree
and branch cleanup, file lock release, residue cleanup, and shadow artifact reconciliation.
Detection is the prerequisite for those and lands first deliberately — a sweep that mutates
before its classification is trustworthy is how real lane state gets destroyed.
