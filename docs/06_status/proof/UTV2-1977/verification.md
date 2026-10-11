# PROOF: UTV2-1977

MERGE_SHA: pending merge

Issue: UTV2-1977
Tier: T2
result: STATIC_PASS_DB_DEFERRED

## ASSERTIONS:

- [x] Exactly one recognized Delivery/UI app root is required.
- [x] Website plus `docs/03_product/brand/**` is admitted.
- [x] Website plus issue-owned proof, lane, and sync paths is admitted.
- [x] A policy-authorized `scripts/**` path is admitted beside one app.
- [x] Empty, supporting-only, multi-app, unknown, forbidden, malformed, missing-policy, and invalid-policy scopes fail closed.
- [x] The policy denylist takes precedence over its allowlist.
- [x] Existing recognized-app coverage and the full focused test count are preserved.

## EVIDENCE:

The baseline implementation on `origin/main` returned `null` immediately for
every path outside a recognized app prefix. Its regression explicitly expected
`apps/command-center/...` plus `scripts/ops/shared.ts` to fail even though
`delivery-ui.yml` independently authorizes `scripts/**`. The same implementation
also rejected the UTV2-1976 website-plus-brand and issue-owned supporting paths.

The focused post-change suite exercises both admission and refusal directions:

```text
pnpm exec tsx --test 'scripts/ops/shared.test.ts'
1..142
# tests 142
# suites 0
# pass 142
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

The complete ops suite also passed:

```text
pnpm test:ops
# tests 3693
# suites 21
# pass 3683
# fail 0
# cancelled 0
# skipped 10
# todo 0
```

Acceptance matrix measured by the focused tests:

| Scope | Result |
|---|---|
| `apps/web/**` | `web` |
| website + `docs/03_product/brand/**` | `web` |
| website + issue-owned proof/lane/sync paths | `web` |
| command-center + `scripts/ops/shared.ts` | `command-center` |
| docs/brand only | `null` |
| web + command-center | `null` |
| web + unknown or forbidden path | `null` |
| empty scope | `null` |
| missing or invalid policy | `null` |

## Verification

- [x] `pnpm exec tsx --test 'scripts/ops/shared.test.ts'`: PASS, 142 tests, 0 failures.
- [x] `pnpm test:ops`: PASS, 3,683 passing tests, 0 failures, 10 skips.
- [x] `pnpm verify:static`: PASS, including lint, type-check, build, full `pnpm test`, production-post-migration checks, Smart Form verification, and command/migration checks.
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS; 7 changed files, no R-level rules matched and no extra R-level artifacts required.
- [ ] `pnpm verify`: the entire `verify:static` stage passed, then the writable DB stage was blocked by the staging identity guard. This is not represented as a green full gate.

Literal writable-DB disposition required by the execution packet:

```text
Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (host=unparseable). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
```

The actual local guard output was:

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
```

No runtime or production proof is claimed. This T2 lane changes static ops
admission logic and tests only.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Execution SHA: 37f0e9df5cfcc8a9074990909a5162afde2df51c
