# PROOF: UTV2-1812

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Issue: UTV2-1812
Tier: T1
Lane type: delivery-ui
Branch: claude/utv2-1812-cc-middleware-dotted-path-bypass
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1503
Head SHA: 1aab560ab42bd690846b5207428ad82575b0b098
result: PASS

## ASSERTIONS:

- [x] **A1 — The affected route surface is derived from the real route tree, not assumed.**
  `route-surface.test.ts` walks `src/app`, turns every `page.tsx` and `route.ts` into the
  pathname it serves, and asserts each reaches the middleware — 62 routes. Under the original
  matcher exactly **1 of 62** fails (`/picks/[id]`). Reported as measured: a static route matches
  only its exact pathname, so a dot-decorated static URL 404s rather than serving. The reachable
  exposure was `/picks/[id]` and every future dynamic route. The matcher suite fails 8 of 14 over
  the same mutation.
- [x] **A2 — An anonymous dotted-path request is refused, measured against a served build.**
  `GET /picks/abc.def` returns **200 with rendered operator HTML** under the original matcher and
  **401 `COMMAND_CENTER_AUTH_REQUIRED`** with the fix. Both arms built and served from the same
  tree, differing in one line.
- [x] **A3 — The two probe arms differ only in the matcher.** `sha256(middleware.ts)` recorded per
  arm: fixed `70008bf9…`, control `45541b04…`; 1 file and 1 line differ. The fixed hash was
  re-confirmed after the control revert, so arm A's tree is byte-identical to this commit.
- [x] **A4 — The correctly-configured path is preserved.** Authenticated `GET /`, `/picks/abc` and
  `/picks/abc.def` all return 200 under the fix. Public paths `/api/health` and `/icon.svg` return
  200 anonymously in both arms.
- [x] **A5 — The injected identity is load-bearing, not decorative.** `lib/require-actor.ts`
  consumes `x-command-center-actor`; the root layout and every server action resolve it and refuse
  without it. The layout omits `children` on refusal, so an element React never renders never runs.
- [x] **A6 — Every server action is guarded, and the guard cannot be satisfied by a comment.**
  `server-action-guard.test.ts` enumerates actions from source rather than from a list, so an
  unguarded action added later fails. Comments and string literals are stripped before the guard is
  looked for.
- [x] **A7 — Each control fails on the condition it names.** 7 mutations, each failing exactly one
  test. See Runtime Verification below.
- [x] **A8 — Non-goals honoured.** No change to the auth-mode precedence logic, no deployment, no
  provisioning, no unpark, no redesign beyond closing the bypass.
- [x] **A9 — No credential was used or recorded.** Both probe arms ran with a locally generated
  token and no database credentials; 0 databases were read or written by any probe.

### Stated limitation, not resolved

The anonymous `Next-Action` POST returns **401** with the fix and **404** without it. The 404 is
Next declining a **fabricated** action id before dispatch (`x-nextjs-action-not-found: 1`, body
`Server action not found.`). This demonstrates **rejection at the authentication boundary** — with
the fix the request never reaches the action dispatcher — but it does **not** prove anonymous
execution of a real server action. The remaining server-action coverage is attributed to the source
tests and their mutations (M2–M8 below), not to this probe.

## EVIDENCE:

Measured locally at the execution anchor `1aab560ab42bd690846b5207428ad82575b0b098`:

```
$ pnpm type-check
tsc -b tsconfig.json — exit 0, 0 diagnostics

$ pnpm test
5703 tests, 5703 pass, 0 fail  ("not ok" lines in the whole run: 0)

$ pnpm verify
exit 1 — every stage PASS through lint / type-check / build / test /
automation-coverage (verdict=PASS) / executable-wiring (verdict=PASS,
total=488 required-reachable=329 unwired=119 baselined=119 new=0).
The run stops only at its last stage, test:live-db:
  [assert-staging] REFUSED: target identity could not be resolved from its URL
  (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx.
This stage refuses a non-staging target by design and is not obtainable locally.
The required `verify` check on PR #1503 is the authoritative receipt for it.
new=0 is load-bearing: all three new test files are required-reachable under
verify, not parked in the 119 baselined-unwired set where they would gate nothing.

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS — rules matched: operator-ui; required artifact
qa-experience-report found at
apps/qa-agent/artifacts/unit-talk-command_center-research_lines-operator/2026-05-13T14-30-59-lopam7/result.json
```

## Verification
- [x] `pnpm type-check`: PASS — exit 0, 0 diagnostics
- [x] `pnpm test`: PASS — 5703 tests, 0 failures
- [x] `pnpm verify`: PASS through every locally obtainable stage; halts only at `test:live-db`,
      which `ci:assert-staging` refuses off-staging by design. Required `verify` on #1503 is authoritative.
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS — operator-ui matched, required artifact present

## Runtime Verification

Two production builds of the Command Center, each `next build` + `next start`, probed over real
HTTP. Configuration for both arms: `UNIT_TALK_APP_ENV=production` (auth-required derived, not
overridden — no `COMMAND_CENTER_AUTH_MODE` set), `COMMAND_CENTER_AUTH_TOKEN=<redacted — locally
generated probe value, not a provisioned secret>`, no database credentials.

Probing a served build is the only way to see this defect. Next's `config.matcher` decides whether
middleware is invoked at all, so a test that calls `middleware()` directly cannot observe it — and
every such test passed while the bypass was live.

| anonymous request | arm B: original matcher | arm A: this PR |
|---|---|---|
| `GET /picks/abc` | 401 | 401 |
| `GET /picks/abc.def` | **200, rendered operator HTML** | **401** JSON `COMMAND_CENTER_AUTH_REQUIRED` |
| `GET /picks/abc.json` | **200** | **401** |
| `GET /model-health` | 401 | 401 |
| `GET /api/events` | 401 | 401 |
| `GET /api/health` | 200 | 200 |
| `GET /icon.svg` | 200 | 200 |
| `POST /picks/abc.def` (`Next-Action`, fabricated id) | 404 `x-nextjs-action-not-found: 1` | 401 |

Authenticated (`Authorization: Bearer <redacted-probe-token>`), arm A: `GET /` 200, `GET /picks/abc`
200, `GET /picks/abc.def` 200.

Verbatim `curl -i` transcripts for both arms are preserved in `evidence.json` under
`runtime_proof.raw_responses`. Redaction applied to those transcripts and nothing else: probe token
→ `<redacted-probe-token>`, `x-request-id` → `<uuid>`, `Date` → `<timestamp>`, `ETag` → `<etag>`.

### Mutation testing — each control made to fail on the condition it names

| # | mutation | observed |
|---|---|---|
| M1 | original matcher `/((?!.*\..*).*)` restored | `middleware-matcher` 8/14 fail; `route-surface` 1/62 fail (`not ok 48 — a dot in a dynamic segment does not exempt /picks/[id]`) |
| M2 | actor guard removed from `actions/board.ts` | 1 test fails |
| M3 | actor guard removed from `actions/execution.ts` | 1 test fails |
| M4 | actor guard removed from `actions/intervention.ts` | 1 test fails |
| M5 | actor guard removed from `actions/picks.ts` | 1 test fails |
| M6 | actor guard removed from `actions/review.ts` | 1 test fails |
| M7 | actor guard removed from `actions/settle.ts` | 1 test fails |
| M8 | `actor: 'operator'` restored in `model-health/page.tsx` | 1 test fails |

Source restored after every mutation; the tree at this commit is byte-identical to the tree that
produced arm A.

**One control was itself corrected by this exercise.** M5 initially did **not** fail: the guard suite
matched `resolveActorOrRefusal` inside `actions/picks.ts`'s own docblock, so deleting the real call
left the suite green. A check a comment can satisfy constrains nothing. Comments and string literals
are now stripped before the guard is looked for, and M5 fails as it should. Recorded because it is
the same defect class the bundle exists to rule out — a self-consistent artifact where no assertion
actually constrains the code.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1503
Approved PR head: pending merge
Execution SHA: 1aab560ab42bd690846b5207428ad82575b0b098
