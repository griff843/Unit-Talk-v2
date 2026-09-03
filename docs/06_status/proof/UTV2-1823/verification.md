# PROOF: UTV2-1823

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-03T05:05:38.734Z
Issue: UTV2-1823
Tier: T1
Lane type: runtime
Branch: claude/utv2-1823-authenticate-trace
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1501
Head SHA: 38ef1fd97e1e57b55f4da1263a124905665996f8
result: pass

## ASSERTIONS:

- [x] AC1 — Anonymous `GET /api/picks/<valid-id>/trace` returns 401 with the standard `UNAUTHORIZED` error body and zero pick data. Asserted by `UTV2-1823: anonymous GET /api/picks/:id/trace is refused with 401 and leaks no pick data` (`apps/api/src/server.test.ts`), which checks `status === 401`, `body.ok === false`, `body.error.code === 'UNAUTHORIZED'`, `body.data === undefined`, and that the serialized response body contains neither the seeded pick id nor its `submittedBy` value in any field.
- [x] AC2 — An authenticated operator receives the unchanged 200 payload. Asserted by `UTV2-1823: authenticated operator GET /api/picks/:id/trace still returns the unchanged 200 aggregate`, which checks all eight keys (`pick`, `submissionEvents`, `promotionHistory`, `outboxEntries`, `distributionReceipts`, `settlementRecords`, `auditLogEntries`, `lifecycleEvents`) are present and the pick id round-trips.
- [x] AC3 — An authenticated request for an unknown pick id still returns 404 `PICK_NOT_FOUND`, so authentication failure and not-found stay distinguishable. Asserted by `UTV2-1823: authenticated GET /api/picks/:id/trace for an unknown pick is 404, not 401`.
- [x] AC4 — No other route's auth behaviour changes. The diff adds exactly one disjunct (`|| traceMatch`) to the existing gate predicate and moves the trace route's match and handler across it. No other predicate, route, handler or response shape is touched; `apps/api/src/auth.ts` is not in the diff. The pre-existing 50 tests in `apps/api/src/server.test.ts` — which cover the POST routes, the kill-switch GET and the other public GETs — pass unchanged.
- [x] AC5 — `/api/picks/{id}/routing-preview` and `/api/picks/{id}/promotion-preview` are explicitly dispositioned: **they remain public in this pass, and that is a known open exposure, not an oversight.** See "Disposition of the sibling preview routes" below.
- [x] AC6 — No consumer regression. `apps/command-center` does not call `/trace`; the only in-repo reference to the route outside `apps/api` is a documentation string in `scripts/ops/observability-proof.ts:93`, which names the endpoint and does not call it.

## EVIDENCE:

Measured on the lane worktree at head `38ef1fd97e1e57b55f4da1263a124905665996f8`.

```
$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 5
Rules matched: (none) -- no R-level artifacts required for this diff

$ pnpm type-check
> pnpm exec tsc -b tsconfig.json
(exit 0 -- no diagnostics)

$ pnpm test
(aggregate across every suite)
# tests 5462
# pass 5462
# fail 0

$ pnpm exec tsx --test apps/api/src/server.test.ts
# pass 53
# fail 0
```

## Verification
- [x] `pnpm type-check`: PASS -- `tsc -b tsconfig.json` exits 0 with no diagnostics
- [x] `pnpm test`: PASS -- 5462/5462 tests pass, 0 fail
- [x] `pnpm exec tsx --test apps/api/src/server.test.ts`: PASS -- 53/53, including the three UTV2-1823 acceptance tests
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS -- no R-level artifacts required for this diff
- [x] `pnpm verify`: **PASS** — required `verify` check completed `success` at the anchor SHA `38ef1fd97e1e57b55f4da1263a124905665996f8` (run [33785176215](https://github.com/griff843/Unit-Talk-v2/actions/runs/33785176215), job 100750090391, 17:38:56Z → 17:42:45Z). It is checked here because the run has completed; it was correctly unchecked while it had not.

## Runtime Verification

**Where the live-DB proof comes from.** This lane's local checkout cannot reach
a database by design: `local.env` pins `SUPABASE_URL` to `http://127.0.0.1:1`
so that no local shell can touch production. `pnpm test:db` is therefore not
run locally, and no local run is claimed here. The T1 live-DB receipt for this
lane is the run-scoped staging receipt produced inside the required `verify`
job at this PR's head SHA, against the staging project.

**That receipt now exists and is green.** At the anchor
`38ef1fd97e1e57b55f4da1263a124905665996f8`:

- `pnpm test:db` — **7 tests, 7 pass, 0 fail** against staging, in producer job
  [100748085293](https://github.com/griff843/Unit-Talk-v2/actions/runs/33785176215/job/100748085293)
- receipt `ci-db-proof-receipt/v2`, `sha256=157d9c7ef1113e76bdac47ebb64eca2fc0cbe7f4b0749cde264d2a81d0bcc1a7`,
  consumed by `scripts/ci/verify-db-proof-receipt.ts` inside the required `verify` job
- `verify`'s "Assert the DB proof producer succeeded" step read
  `staging-db-proof result: success`; it fails closed on any other result
- the "Run the T1 live proof suites against staging" step reported `# fail 0` throughout

The receipt's target is masked by secret redaction in the log. It is staging,
not production: `staging-path-enforcement` and the production-credential guard
both gate that job, and production credentials are not available to it.

Full detail, with run and job ids, is in `runtime-health.json` alongside this
file.

**What the change touches at runtime.** The diff moves one route match and its
handler across an existing predicate in `apps/api/src/server.ts`. It performs
no query, opens no connection, reads no environment variable and alters no
repository call. `handleTracePickRoute` and `tracePickController` are unchanged,
so the authenticated response is produced by exactly the code path that
produced the unauthenticated one.

**Behaviour when auth is disabled.** `authenticateRequest`
(`apps/api/src/auth.ts:234-239`) returns `BYPASS_CONTEXT` when
`authConfig.enabled` is false and `failClosed` is false, and
`BYPASS_CONTEXT.role` is `'operator'` (`auth.ts:82-85`). The inline
`auth.role === 'operator'` check therefore admits the bypass context, so a
`fail_open` development server keeps serving `/trace` exactly as before. In
`fail_closed` mode with auth disabled, `authenticateRequest` returns `null` and
the route answers 401 — which is the correct fail-closed outcome and matches
every other gated route.

**Why the role check is stated inline rather than in `ROUTE_ROLES`.**
`authorizeRoute` (`auth.ts:258-267`) iterates `ROUTE_ROLES` and returns `false`
when no pattern matches. No pattern covers `/api/picks/{id}/trace`, so routing
the trace request through `authorizeRoute` would answer **every** authenticated
operator with 403 — the route would be closed to its intended users, not
protected. `apps/api/src/auth.ts` is a Tier C exact path this lane is not
authorized to edit, so the policy is stated at the call site and the code
carries a comment recording that it belongs in `ROUTE_ROLES` and should move
there when a lane is authorized to touch `auth.ts`.

## Mutation control (required by the issue's verification plan)

A test that still passes with the guard removed proves nothing. The gate
predicate was reverted to its pre-change form and the suite re-run.

**Mutation applied** — `apps/api/src/server.ts:614`, the `|| traceMatch`
disjunct removed so the trace route is once again dispatched above the auth
gate:

```diff
-  if (method === 'POST' || url.pathname === '/api/discord/kill-switch' || traceMatch) {
+  if (method === 'POST' || url.pathname === '/api/discord/kill-switch') {
```

**Result with the guard removed** — `pnpm exec tsx --test apps/api/src/server.test.ts`:

```
# Subtest: UTV2-1823: anonymous GET /api/picks/:id/trace is refused with 401 and leaks no pick data
not ok 51 - UTV2-1823: anonymous GET /api/picks/:id/trace is refused with 401 and leaks no pick data
  ---
  duration_ms: 13.877492
  type: 'test'
  location: '.../apps/api/src/server.test.ts:1:56848'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:

    200 !== 401

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 401
  actual: 200
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (.../apps/api/src/server.test.ts:2660:12)
  ...
# Subtest: UTV2-1823: authenticated operator GET /api/picks/:id/trace still returns the unchanged 200 aggregate
ok 52 - UTV2-1823: authenticated operator GET /api/picks/:id/trace still returns the unchanged 200 aggregate
# Subtest: UTV2-1823: authenticated GET /api/picks/:id/trace for an unknown pick is 404, not 401
ok 53 - UTV2-1823: authenticated GET /api/picks/:id/trace for an unknown pick is 404, not 401
# pass 52
# fail 1
```

The anonymous-401 assertion fails on exactly the condition it names: with the
guard gone the route answers **200 with the full aggregate** to an
unauthenticated caller. That is the defect this lane closes, observed directly
rather than asserted.

The other two UTV2-1823 tests pass under the mutation, which is the correct and
expected outcome — they assert the authenticated 200 and the authenticated 404,
neither of which depends on the guard. They are stated here so the bundle is not
read as claiming all three tests are guard-sensitive; only test 51 is, and it is
the one that carries the security claim.

**Restoration** — `apps/api/src/server.ts` was restored from a byte-for-byte
copy taken before the mutation; `git diff` reports no change against the
committed file, and the guarded suite returns `# pass 53 / # fail 0`.

## Disposition of the sibling preview routes (AC5)

`GET /api/picks/{id}/routing-preview` and `GET /api/picks/{id}/promotion-preview`
remain unauthenticated after this change. This is a deliberate, recorded
decision, and the reason is a consumer constraint, not a judgement that the
routes are safe.

**They do leak the same class of state.** `routingPreviewController`
(`apps/api/src/controllers/routing-preview-controller.ts:77-90`) returns the
pick's `status`, `source`, `promotionTarget`, `promotionStatus`,
`promotionScore`, `promotionReason`, the latest outbox row's `target`,
`outboxStatus` and `outboxAttemptCount`, the full `gateChecks` array and a
`routingExplanation`. `promotionPreviewController:59-65` returns
`wouldPromoteTo`, `score`, `reasons` and `qualifies`. Promotion scoring and
outbox delivery state are staff-only operational state by exactly the UTV2-1427
standard applied to `/trace` above.

**Why they are not gated here.** `apps/command-center/src/lib/data/preview.ts`
calls both routes through `proxyToApi`, which issues a bare
`fetch(`${base}${path}`, { cache: 'no-store' })` with **no `Authorization`
header**. Gating either route in this lane would return 401 to the Command
Center and break the operator surface — which AC6 of this issue explicitly
forbids ("No consumer regression ... no operator surface breaks"). Closing this
exposure requires the Command Center proxy to carry a service credential first,
which is a Command Center change outside this lane's declared file scope
(`apps/api/src/server.ts`, `apps/api/src/server.test.ts`,
`docs/06_status/proof/UTV2-1823/**`).

**Standing risk while they remain open.** Any caller who knows a pick UUID can
still read that pick's promotion score, promotion reason, resolved delivery
target and outbox attempt count. That is narrower than `/trace` — no audit log,
no settlement records, no distribution receipt external ids, no raw `metadata`
— but it is not nothing, and it is not closed by this lane. It is reported to
the PM rather than silently absorbed.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1501
Approved PR head: pending merge
Execution SHA: 38ef1fd97e1e57b55f4da1263a124905665996f8
