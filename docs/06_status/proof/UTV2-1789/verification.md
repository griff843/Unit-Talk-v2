# PROOF: UTV2-1789

MERGE_SHA: 8afcba5233441b4e45bed40f4677ee544ade8288

> Pre-merge the merge anchor carries the verified implementation identity.
> `post-merge-lane-close.yml` rebinds merge authority only after GitHub supplies
> the merged-PR attestation.

Generated at: 2026-09-01T14:22:27Z
Issue: UTV2-1789
Tier: T1
Lane type: delivery-ui
Branch: claude/utv2-1789-cc-auth-fail-closed
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1474
Head SHA: 8afcba5233441b4e45bed40f4677ee544ade8288
result: pass

## ASSERTIONS:

- [x] Production and staging authentication is fail-closed and cannot be downgraded by any environment variable (DoD 1).
- [x] No `dev_bypass` operator identity is reachable in production or staging (DoD 2).
- [x] Bypassed requests are never recorded as legitimate privileged actions (DoD 3).
- [x] `apps/command-center/.env.example` defaults fail-closed with an explanatory comment (DoD 4).
- [x] Tests are execution-proven and include mutation cases that fail on the condition each guard names (DoD 5).
- [x] Root `.env.example` and the sibling `*_RUNTIME_MODE=fail_open` defaults are assessed and reported, unmodified (DoD 6).
- [x] An unlabelled runtime (no `NODE_ENV`, no `UNIT_TALK_APP_ENV`) requires authentication rather than defaulting open.
- [x] A correctly configured production deployment still authenticates — the fix is not a blanket refusal.
- [ ] PM merge approval on the exact head (DoD 7). Not satisfied: no approval artifact exists.

## EVIDENCE:

```
$ pnpm verify:static
EXIT=0
99 node:test blocks executed, every one reporting "# fail 0"; no block reported a non-zero failure count.

$ pnpm exec tsx --test apps/command-center/src/lib/command-center-auth-fail-closed.test.ts
# pass 16
# fail 0

$ pnpm exec tsx --test apps/command-center/src/lib/server-api.test.ts
# pass 15
# fail 0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 9
Rules matched: operator-ui
```

## Verification
- [x] `pnpm type-check`: pass (executed inside `pnpm verify:static`, EXIT=0)
- [x] `pnpm test`: pass (executed inside `pnpm verify:static`, 99 blocks, 0 failures)
- [x] `pnpm verify`: `verify:static` pass (EXIT=0). The `test:live-db` half is not runnable from this containment checkout — it needs the `staging-ci` credential only the CI `staging-db-proof` job holds. CI's required `verify` job asserts that job's result as its first step, so the live half is proven there and is not claimed here.
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS

## Runtime Verification

Measurement basis: the exported entry point the middleware calls, and
`middleware()` itself driven with a real `NextRequest`. No stub auth layer.

Every control was proven by mutation — the guard was removed or inverted on the
merged source and the suite re-run:

| Mutation applied | Failing tests |
|---|---|
| Restore the mode-before-environment ordering | `not ok` 1, 2, 3, 5, 6, 10, 14 — seven failures |
| Default an unlabelled runtime to auth-not-required | `not ok 12` |
| Revert `.env.example` to `fail_open` | `not ok 13` |
| Remove the `dev_bypass` branch from the middleware | `not ok 15` |
| None (restored) | `# pass 16 / # fail 0` |

The pre-existing `server-api.test.ts` suite still passes unchanged at 15/15,
including the correctly-configured production paths.

## Item 6 — root `.env.example` assessment (assess only, unmodified)

- **Root `.env.example:217` carries the same `COMMAND_CENTER_AUTH_MODE=fail_open`.** This change neutralises it — production and staging now ignore the value entirely. The residual is that the example still reads as if fail-open were a supported production posture. Correcting it needs separate approval; nothing outside `apps/command-center/**` was touched.
- **The five service `*_RUNTIME_MODE=fail_open` defaults (`:37`, `:87`, `:100`, `:146`, `:168`) are materially different and already backstopped.** `packages/config/src/env.ts:482` throws `RUNTIME_MODE_MUST_FAIL_CLOSED` whenever `isProductionLikeRuntime(env)` holds and the mode is not `fail_closed`, and `apps/api/src/server.ts:206`, `apps/worker/src/runtime.ts:66`, `apps/ingestor/src/index.ts:84` and `apps/discord-bot/src/main.ts:33` all route their key through that resolver. Those services refuse to boot in production with the shipped default. Command Center had no equivalent startup gate, which is why it alone was exposed.
- **`apps/api/src/auth.ts:273-287` has the same precedence shape but is unreachable in production**, for that same reason: the API process cannot start with `UNIT_TALK_API_RUNTIME_MODE=fail_open` under a production-like environment. Aligning it is defence-in-depth worth doing, but it is a shared API auth surface and explicitly outside this lane.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1474
Approved PR head: pending merge
Execution SHA: 8afcba5233441b4e45bed40f4677ee544ade8288
