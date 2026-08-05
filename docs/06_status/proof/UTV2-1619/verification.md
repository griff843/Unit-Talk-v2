# PROOF: UTV2-1619 — governance bootstrap authorization (capability 18)

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
- [x] No production, runtime, migration, workflow, or delivery path is touched.

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

Full suite, 13 sub-suites, 97 node:test TAP summary blocks:

```
TAP summary blocks: 97
blocks reporting a nonzero '# fail': 0
TEST_EXIT=0
```

The new unit suite specifically:

```
1..17
# tests 17
# suites 0
# pass 17
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Coverage is deliberately weighted toward refusal rather than admission — a grant
that admits too much is the failure mode that matters here. BA-3 through BA-14
are all refusals: wrong issue, wrong lane type in either direction, expired,
boundary-expired, unparseable expiry, missing file, malformed JSON, entry missing
a required field, two active grants, and an empty grant list.

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
