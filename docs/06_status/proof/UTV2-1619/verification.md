# PROOF: UTV2-1619 — governance bootstrap authorization and identity (capabilities 18, 19)

MERGE_SHA: 9722ef7120fcb98f7287a7d5ab03fbbe65813fa2

ASSERTIONS:
- [x] An authorization admits exactly the issue it names and refuses every other issue.
- [x] An authorization admits only a `governance` lane, checked in both directions.
- [x] An expired authorization is refused; boundary and unparseable expiries fail closed.
- [x] A missing or malformed authorization file authorizes nothing.
- [x] More than one unexpired authorization refuses every lane rather than selecting one.
- [x] Only capacity violations are suppressed; structural violations remain blocking.
- [x] The grant is read from `origin/main`, never the working tree, so a branch cannot
      grant itself admission.
- [x] An authorized admission is recorded in `lane-start` output with the suppressed violations.
- [x] A bootstrap governance identity supplies Merge Gate's tier only when no lane manifest
      resolves one, and can never override, weaken, or shadow a real manifest.
- [x] An invalid or invented tier invalidates the authorization file rather than defaulting.
- [x] Merge Gate reports a bootstrap admission distinctly and never passes it silently, and
      names whether the identity came from base (canonical) or the PR head (bootstrap
      transition).
- [x] Base is consulted before head; head is read only when base has nothing, only for the
      single initial bootstrap issue, and only when every changed file is inside a strict
      allowlist containing no application or runtime path.
- [x] Failure to enumerate the PR diff refuses head-read rather than allowing it.
- [x] A bootstrap admission writes a durable, committed receipt recording the grant verbatim,
      the exact commit it was read from, the suppressed violations, and the board.
- [x] No production, runtime, migration, or delivery path is touched. The only workflow
      change is Merge Gate's tier resolution.

EVIDENCE:

## Verification

Executed on 2026-08-05 in worktree
`.out/worktrees/claude__utv2-1619-bootstrap-auth`, branch
`claude/utv2-1619-governance-bootstrap-authorization`, based on `9722ef71`.

### `pnpm type-check`

```
> @unit-talk/v2@0.1.0 type-check
> pnpm exec tsc -b tsconfig.json

TC_EXIT=0
```

No diagnostics; `tsc -b` exited 0 across all project references.

### `pnpm lint`

```
> @unit-talk/v2@0.1.0 lint
> eslint . --cache --cache-location .cache/eslint/

LINT_EXIT=0
```

### `pnpm test`

```
blocks reporting a nonzero '# fail': 0
aggregate pass=4502 fail=0
TEST_EXIT=0
```

The 4502 aggregate is 4473 baseline plus the 29 tests added here (22 for the
authorization mechanism, 7 guarding the phase-1 head-read exception).

**Correction — the first run of this suite did not execute the new tests.** They
were initially written without being wired into any test command, so `pnpm test`
passed while never running them, and running them directly with `tsx --test` was
a separate execution. Reporting the two together would have implied a single
inclusive result that did not exist.

CI's `executable-wiring` guard caught this on the first attempt:

```
[FAIL] WIRING_TEST_UNWIRED_NEW scripts/ops/bootstrap-authorization.test.ts
  - test file is not reachable from any package script or workflow command
    and is not in the reviewed wiring baseline
```

Fixed by wiring the file into `test:ops`. The guard then passed, and the counts
moved by exactly the expected amount:

```
[automation-coverage] verdict=PASS fail=0
[executable-wiring] verdict=PASS required_roots=verify
[executable-wiring] tests total=466 required-reachable=311 unwired=119 (baselined=119 new=0)
```

`required-reachable` 310 -> 311, `unwired` 120 -> 119, `new=0`. At that moment the
suite aggregate moved 4473 -> 4490, a delta of exactly 17 — the count of the tests
that existed then — which is the direct evidence that `pnpm test` executes them
rather than merely tolerating their existence. Capability 19 later added 5 more
tests, taking the count to 22, and the constrained head fallback added 7 more,
taking the aggregate to 4502; the same delta identity holds (4473 + 29 = 4502).

The new unit suite, as executed inside the full run:

```
1..22
# tests 22
# suites 0
# pass 22
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Coverage is deliberately weighted toward refusal rather than admission — a grant
that admits too much is the failure mode that matters here. BA-3 through BA-14
are all refusals: wrong issue, wrong lane type in either direction, expired,
boundary-expired, unparseable expiry, missing file, malformed JSON, entry missing
a required field, two active grants, and an empty grant list. BA-18 and BA-19 add
tier refusals: a missing tier, and invented tiers (`T4`, `TX`, `high`, `2`, empty)
each invalidate the file rather than defaulting to one.

### Workflow validation

`merge-gate.yml` carries the only workflow change. Both its YAML and its embedded
`github-script` body were validated before push:

```
YAML OK, jobs: ['gate', 'wfr-validators']
gate script#1: OK        (node --check on the extracted script body)
```

This matters more than usual: Merge Gate is a required check for every PR in the
repository, so a syntax error here would block the whole repo, not just this lane.

### R-level check (`scripts/ci/r-level-check.ts`)

```
Verdict: PASS
Rules matched: (none) — no R-level artifacts required for this diff
RLEVEL_EXIT=0
```

### `pnpm verify`

`pnpm verify` was not run on this workstation; its constituent static steps
(`type-check`, `lint`, `test`) were run individually and are recorded above. CI
runs `pnpm verify` on this PR's head, and that run is the authoritative one.

### Scope of this run

`pnpm test:db` was not executed. This change is governance tooling with no
database access, and production is parked. No live-DB proof is claimed and none
is required at this tier.

## Capability 19: bootstrap governance identity

The lane system could not bootstrap itself. Merge Gate errors unconditionally on a
missing authoritative tier:

```js
if (!authoritativeTier) {
  errors.push('No authoritative lane manifest tier found ...');
}
```

The only producer of a lane manifest is `ops:lane-start`, and `lane-start` refuses
when the caps are exhausted. So the change that repairs admission could never
merge — verified by grep to have no skip, exempt, or bootstrap path, and
unavoidable by any branch naming, since a branch without an issue ID merely adds a
second error.

A bootstrap governance identity resolves this **without fabricating a lane
manifest**. It supplies the tier, and records that governance self-repair was
authorized, rather than pretending normal lane admission occurred.

Deliberately narrow:

* consulted **only** when no real manifest resolved a tier, so it can never
  override, weaken, or shadow a genuine lane;
* `lane_type` must be `governance` and the tier must be one of `T1`/`T2`/`T3`;
* expiry is required, and more than one live identity fails closed in the gate
  exactly as it does in `lane-start`;
* the verdict is reported distinctly — title `Merge Gate: APPROVED (bootstrap
  identity)`, plus a governance note naming the authorizer, expiry and milestone,
  and stating that this is not normal lane admission.

The recognition is inline in `merge-gate.yml` rather than in a script file, and
that is load-bearing. For `pull_request` events the workflow *definition* comes
from the merge ref, so this change applies to this PR itself; the `checkout` step
pins `base.sha`, which governs checked-out files only. Logic placed in a script
file would have been read from base and been inert here — the same stale-source
class as a re-run replaying its original event payload.

## Two-phase authority resolution, and why head-read is constrained

An earlier revision of this change read the bootstrap identity from the PR head
before base. That was wrong, and it was wrong in the exact way this issue exists
to prevent: **a PR must not be able to introduce its own authority artifact and
use that artifact to authorize itself.** A manifest-less PR could have added
`BOOTSTRAP_AUTHORIZATIONS.json` declaring `T3` and converted "cannot merge at
all" into "merges under T3 rules with no PM verdict".

Base-only reading is the correct steady-state rule, but it recreates the
deadlock: the artifact cannot reach base until the PR introducing it merges.

The resolution is a lifecycle rather than a single rule:

```
Phase 1  bootstrap introduction  (head-scoped, constrained)
Phase 2  bootstrap operation     (base/main-scoped, canonical)
Phase 3  bootstrap retirement    (no active grants)
```

Phase 1 is permitted only when **every** one of these holds:

* no lane manifest resolved a tier;
* the artifact is absent from base and present on head;
* the issue is exactly the single declared initial-bootstrap issue;
* `lane_type` is `governance` and the tier is valid;
* **every changed file in the PR is inside a strict allowlist** — the
  authorization artifact, the Merge Gate resolution logic, the bootstrap
  mechanism, its tests, and its proof artifacts. No application or runtime path
  is allowlisted.

If the diff cannot be enumerated, head-read is refused rather than allowed — an
unprovable scope is not a satisfied one.

Phase 2 begins the moment this PR merges: base carries the artifact, base is
consulted first, and the head copy is never read again. Retirement of the phase-1
branch is tracked as its own issue, so a temporary bridge cannot quietly become a
permanent loophole.

`scripts/ops/bootstrap-head-fallback-guard.test.ts` pins the exception in place:
7 assertions covering the issue pin, the exact allowlist contents, the absence of
any application/runtime path, the issue-scoped proof prefix, base-before-head
ordering, source disclosure in the verdict, and fail-closed behavior on diff
enumeration failure. The constraint lives in inline workflow JavaScript that no
unit test would otherwise execute, so widening it now requires deliberately
editing an assertion.

## Admission receipt

An admission fact that exists only in stdout cannot close an audit trail. A
bootstrap admission therefore writes
`docs/06_status/proof/<ISSUE>/bootstrap-admission-receipt.json`, committed with the
lane apparatus, recording:

* the grant verbatim as it read at admission;
* `authorization_source.sha` — the exact `main` commit it was read from, so the
  grant can be re-verified later even if the file is subsequently edited or
  removed;
* `suppressed_violations` and `remaining_violations` as separate fields, so a
  reader can confirm the authorization only ever touched capacity;
* the board the decision was made against;
* a `note` stating in words that normal lane admission did not occur.

An unresolvable source SHA is recorded as `null` rather than omitted, so a receipt
never silently looks complete.

## Design note: why this is not a bypass

`lane-start` deliberately refuses caller-supplied overrides — its own comment
records that "a caller-supplied override is not proof of PM authorization" (PM
review finding #3). That reasoning is preserved intact: this change adds **no
flag**, and the caller cannot assert an authorization at all.

The grant is read from `origin/main` via `git show`, never from the working tree.
Issuing one therefore requires landing a reviewed governance PR, so the branch
being admitted cannot grant its own admission — the same trust property
`scope-override/v1` relies on, reused rather than reinvented.

Nor is it a cap increase. A raised cap admits any lane that asks; this admits
precisely the one issue named in the grant, only as a governance lane, only
before its expiry, and refuses everything else. Every other concurrency rule
still runs unchanged, and the admission is recorded in the output so an
authorized lane is never indistinguishable from one admitted under the caps.
