# PROOF: UTV2-1789

MERGE_SHA: 974da2705296e8a0dd561a333e9cd23db3793396

> Pre-merge the merge anchor carries the verified implementation identity.
> `post-merge-lane-close.yml` rebinds merge authority only after GitHub supplies
> the merged-PR attestation.

Generated at: 2026-09-01T15:09:06Z
Issue: UTV2-1789
Tier: T1
Lane type: delivery-ui
Branch: claude/utv2-1789-cc-auth-fail-closed
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1474
Head SHA: 974da2705296e8a0dd561a333e9cd23db3793396
result: pass

## ASSERTIONS:

- [x] Production and staging authentication is fail-closed and cannot be downgraded by any auth-mode environment variable (DoD 1). Stated exactly: once the runtime *identifies* as `production` or `staging`, no `COMMAND_CENTER_AUTH_MODE`, `UNIT_TALK_COMMAND_CENTER_AUTH_MODE` or `UNIT_TALK_OPERATOR_RUNTIME_MODE` value can make auth optional. The environment-identity labels themselves (`UNIT_TALK_APP_ENV`, `NODE_ENV`) are of course still what decide whether a runtime is deployed -- this lane does not, and cannot, prevent a host from mislabelling itself. `isDeployedEnvironment` uses `.some()`, so either label alone suffices, and `deploy.yml` writes `UNIT_TALK_APP_ENV=production`.
- [x] No `dev_bypass` operator identity is reachable in production or staging (DoD 2).
- [x] Bypassed requests are never recorded as legitimate privileged actions in the audit log (DoD 3). Scoped precisely: the middleware now emits `command_center.dev_bypass` instead of `command_center.privileged_action`. It still sets **two** headers on the dev-bypass branch: `x-command-center-actor` (`middleware.ts:78`, actor `command-center:dev-bypass`) and `x-command-center-role: operator` (`middleware.ts:79`). Both are set on every non-public matched route that passes auth -- `PUBLIC_PATH_PREFIXES` returns early at `middleware.ts:19-21` before any header is attached. No application code reads either header -- `git grep` returns only those two lines, this suite, and docs -- so nothing downstream consumes them, but they are emitted and this bundle does not claim otherwise.
- [x] `apps/command-center/.env.example` defaults fail-closed with an explanatory comment (DoD 4).
- [x] Tests are execution-proven and include mutation cases that fail on the condition each guard names (DoD 5) -- with one documented exception recorded under "Mutation coverage limit" below: the early `isDeployedEnvironment` return is redundantly enforced and is not independently mutation-pinnable.
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
# pass 17
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

Each mutation below was applied to the merged source and the suite re-run. This
is not a claim that every individual branch is independently pinned -- one is
not, and that exception is documented rather than papered over:

Tests are identified by name, not index: a later revision inserted a regression
and shifted every index after it, so index-based references in an earlier
revision of this bundle were wrong. All four mutations below were re-executed
against the current tree.

| Mutation applied | Result | Failing tests (by name) |
|---|---|---|
| Restore the mode-before-environment ordering (delete the deployed-environment return AND revert `fail_open` to `return false`) | 17 tests, 9 pass, **8 fail** | `fail_open cannot open production`; `fail_open cannot open staging`; `every mode alias that used to disable auth is inert in production`; `an unlabelled runtime is treated as deployed, not as development`; `a production runtime is never told auth is optional`; `no deployed environment is optional-auth under any mode`; `the dev bypass is unreachable when development also names a deployed env`; `middleware: an anonymous production request under fail_open is refused` |
| Default an unlabelled runtime to auth-not-required (`return isDeployedEnvironment(env)` as the final fallthrough) | 17 tests, 16 pass, **1 fail** | `an empty environment requires auth` |
| Revert `apps/command-center/.env.example` to `fail_open` | 17 tests, 16 pass, **1 fail** | `.env.example does not ship a value that disables auth` |
| Remove the `dev_bypass` branch from the middleware | 17 tests, 16 pass, **1 fail** | `middleware: a bypassed request is not recorded as a privileged action` |
| None (restored) | **17 pass / 0 fail** | — |

Not every individual branch is independently pinned; see "Mutation coverage
limit" immediately below for the one documented exception and why removing the
redundant defence to manufacture a failure was rejected.

The pre-existing `server-api.test.ts` suite still passes unchanged at 15/15,
including the correctly-configured production paths.

### Mutation coverage limit -- the deployed-environment guard is NOT independently pinned

Recorded because an independent review found it and an earlier revision of this
bundle overclaimed. Deleting the headline guard on its own:

```
  if (isDeployedEnvironment(env)) {
    return true;
  }
```

leaves the suite at **17 pass / 0 fail**. It is observationally redundant with
the rewritten `fail_open` branch (`return !isDevelopmentEnvironment(env)`),
because `DEPLOYED_ENVIRONMENTS = {production, staging}` and
`DEVELOPMENT_ENVIRONMENTS = {development, test, local}` are disjoint: any
deployed name makes `isDevelopmentEnvironment` false, so both mechanisms return
`true` on the same inputs.

Proven exhaustively rather than argued. An 800-combination differential drove
the real exported `authenticateCommandCenterRequest` over
`UNIT_TALK_APP_ENV` x `NODE_ENV` x `COMMAND_CENTER_AUTH_MODE`
(10 x 10 x 8, including unset, empty, whitespace, mixed case and unrecognised
values), with and without the guard:

```
original rows: 800
mutated rows:  800
diff => IDENTICAL across all 800 combinations
```

No input distinguishes them, so no test could. The guard was therefore NOT
removed to manufacture a failing mutation.

**The redundancy is still load-bearing**, which is why the guard stays. A
second-order mutation weakening the classifier from `every` to `some` in
`isDevelopmentEnvironment`, on the conflicting environment
`UNIT_TALK_APP_ENV=production` + `NODE_ENV=development` + `fail_open`:

| Variant | Anonymous request result |
| --- | --- |
| Source as-is | refused (`COMMAND_CENTER_AUTH_MISCONFIGURED`) |
| Classifier weakened, guard present | refused -- the guard holds the line |
| Classifier weakened, guard removed | **AUTH BYPASSED (`ok: true`)** |

What IS pinned is the invariant, by the new regression
`no deployed environment is optional-auth under any mode`, which asserts
`required === true` across both deployed environments x eight mode values x
four `NODE_ENV` values. Under the original mode-before-environment defect it
fails along with 7 siblings (**17 tests, 9 pass, 8 fail**), and passes 17/17 on
restore.

## Item 6 — root `.env.example` assessment (assess only, unmodified)

- **Root `.env.example:217` carries the same `COMMAND_CENTER_AUTH_MODE=fail_open`.** This change neutralises it — production and staging now ignore the value entirely. The residual is that the example still reads as if fail-open were a supported production posture. Correcting it needs separate approval; nothing outside `apps/command-center/**` was touched.
- **The service `*_RUNTIME_MODE=fail_open` defaults are only PARTLY backstopped.** An earlier revision of this bundle claimed all five were; that was wrong and is corrected here. `packages/config/src/env.ts` throws `RUNTIME_MODE_MUST_FAIL_CLOSED` only from `assertProductionRuntimeConfig`, and that function has exactly four non-test callers, verified by `git grep assertProductionRuntimeConfig`:

  | Runtime-mode variable | Enforcement path | Backstopped |
  | --- | --- | --- |
  | `UNIT_TALK_API_RUNTIME_MODE` | `apps/api/src/server.ts:214` | yes |
  | `UNIT_TALK_DISCORD_BOT_RUNTIME_MODE` | `apps/discord-bot/src/main.ts:51` | yes |
  | `UNIT_TALK_INGESTOR_RUNTIME_MODE` | `apps/ingestor/src/index.ts:104` | yes |
  | `UNIT_TALK_WORKER_RUNTIME_MODE` | `apps/worker/src/runtime.ts:87` | yes |
  | `UNIT_TALK_ALERT_AGENT_RUNTIME_MODE` | none -- `apps/alert-agent` contains no `RUNTIME_MODE` reference at all | **NO** |
  | `UNIT_TALK_OPERATOR_RUNTIME_MODE` | none reaches `assertProductionRuntimeConfig`. It *is* read, at `apps/command-center/src/lib/server-api.ts:358` (an auth-mode alias, inert in deployed environments after this change) and `apps/command-center/src/lib/data/client.ts:115` -- consumed where it no longer matters, enforced nowhere. Root `.env.example:225` ships it **empty**, not `fail_open`. | **NO** |

  Root `.env.example:100` ships `UNIT_TALK_ALERT_AGENT_RUNTIME_MODE=fail_open` with nothing enforcing it. That residual is real, is outside this lane's scope, and is tracked as **UTV2-1813** (<https://linear.app/unit-talk-v2/issue/UTV2-1813/>) rather than asserted away here. Nothing outside `apps/command-center/**` is modified by this lane.
- **`apps/api/src/auth.ts:273-287` has the same precedence shape but is unreachable in production**, for that same reason: the API process cannot start with `UNIT_TALK_API_RUNTIME_MODE=fail_open` under a production-like environment. Aligning it is defence-in-depth worth doing, but it is a shared API auth surface and explicitly outside this lane.

## Command Center deployment status

The Command Center is **not currently deployed through the production
workflow**. `docker-compose.prod.yml:77-83` places it behind an opt-in
`profiles: [command-center]`, and no workflow under `.github/workflows/`
deploys it -- it appears only in CI, QA and proof-gate jobs.

Two consequences, both recorded deliberately:

1. The request-surface residual below has **no current production blast
   radius**, but it is a prerequisite blocker before any Command Center
   deployment.
2. No `COMMAND_CENTER_AUTH_*` value is provisioned anywhere in the deploy path,
   while `deploy.yml` writes `UNIT_TALK_APP_ENV=production`. Because this change
   makes a deployed environment unconditionally auth-required, whoever first
   deploys the Command Center must provision `COMMAND_CENTER_AUTH_TOKEN` (or
   basic credentials) in the same change, or the app returns
   `503 COMMAND_CENTER_AUTH_MISCONFIGURED` on every route rather than serving
   anonymously. That is the intended fail-closed direction, but it is an
   operational precondition, not a silent improvement.

## Scope boundary -- what this lane does NOT claim

This lane corrects the **auth-mode precedence** defect: no environment variable
can downgrade a deployed Command Center to fail-open. It does **not** prove that
every Command Center route is authenticated.

An independent review verified a separate pre-existing gap: the middleware
matcher `'/((?!.*\\..*).*)'` (`middleware.ts:90`) excludes any path containing
a dot, while the dynamic route `app/picks/[id]/page.tsx` matches a dotted
segment -- so `GET /picks/anything.json` renders the pick-detail page, which
mounts settlement, correction and intervention server actions, without entering
the middleware. There is no handler-level authorization behind it.

That defect is pre-existing, is NOT introduced or fixed here, and is tracked as
**UTV2-1812** (<https://linear.app/unit-talk-v2/issue/UTV2-1812/>), a bounded T1
security issue whose description opens with `## PRE-DEPLOYMENT BLOCKER` and which
is explicitly marked a hard blocker for any future Command Center production
deployment.

Stated as plainly as possible, so no reader can take more from this bundle than
it earned: **this PR does not prove that the Command Center is authenticated.**
It proves one negative — that no environment variable can downgrade a deployed
Command Center's auth mode to fail-open.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1474
Approved PR head: pending merge
Execution SHA: 974da2705296e8a0dd561a333e9cd23db3793396
