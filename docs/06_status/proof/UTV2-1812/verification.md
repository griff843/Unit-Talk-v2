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
Head SHA: 3d46af43633264c86f717851510a5cf86958f88c
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
- [x] **A5 — Privileged identity is derived from the request's credentials, never from an
  injected header.** `lib/request-auth.ts` authenticates the *current request's own* header bag
  through `authenticateCommandCenterRequest` and returns `{actor, role, method}` from the
  credential it verified. `lib/require-actor.ts` is a thin wrapper over it:
  `requireAuthenticatedActor()` throws `PrivilegedAccessDeniedError` on refusal and
  `resolveActorOrRefusal()` converts that into `{ok:false}`. **No production code path reads
  `x-command-center-actor`.** The single non-test occurrence in the whole app is
  `src/middleware.ts:78`, which *writes* it onto the forwarded request; nothing reads it back. A
  caller who forges the header therefore changes nothing, and
  `governance-lanes-route-auth.test.ts` asserts exactly that: a request carrying
  `x-command-center-actor: attacker` and no credential is refused 401.
- [x] **A5b — Each privileged operation authenticates individually, not once at a layout.**
  Counted from source at this commit, excluding test files:
  - **13 `resolveActorOrRefusal()` call sites across 9 modules** — the 8 server-action modules
    (`app/actions/{board,execution,intervention,picks,review,settle,model-health}.ts` and
    `app/operations/discord/actions.ts`) and `app/layout.tsx`. A server action is independently
    addressable, so the layout's own check protects none of them; each carries its own.
  - **8 `assertPrivilegedRequestAuthenticated()` call sites** in the read path —
    `lib/data/{client,preview,model-performance,storage-health}.ts` and `lib/data/runtime-truth.ts`
    (2), plus `lib/governance-board.ts` and `app/model-health/page.tsx`. This is what makes the
    privileged **reads** authenticate independently of whether middleware ran: the credential is
    checked where the service-role data access happens, not at the route edge.
  - **3 route handlers** authenticate the request's own headers directly via
    `authenticateHeaderBag(request.headers)` — `app/api/{health,events,governance/lanes}/route.ts`.

  The assertion fails closed outside request scope as well: `authenticateCurrentRequest()` catches a
  missing `headers()` context and returns `COMMAND_CENTER_REQUEST_CONTEXT_UNAVAILABLE` / 401 rather
  than proceeding unauthenticated.
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

Measured locally at the execution anchor `3d46af43633264c86f717851510a5cf86958f88c`, with `SUPABASE_URL`,
`SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` explicitly unset — that is,
under CI's environment rather than this checkout's:

```
$ pnpm type-check
tsc -b tsconfig.json — exit 0, 0 diagnostics

$ env -u SUPABASE_URL -u SUPABASE_ANON_KEY -u SUPABASE_SERVICE_ROLE_KEY pnpm test
5807 tests, 5807 pass, 0 fail, 0 skipped  ("not ok" lines in the whole run: 0)

$ pnpm verify
exit 1 — every stage PASS through lint / type-check / build / test /
automation-coverage (verdict=PASS) / executable-wiring (verdict=PASS,
total=496 required-reachable=337 optional-reachable=40 unwired=119
baselined=119 new=0).
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
- [x] `pnpm test`: PASS — 5807 tests, 0 failures, 0 skipped
- [x] `pnpm verify`: PASS through every locally obtainable stage; halts only at `test:live-db`,
      which `ci:assert-staging` refuses off-staging by design. Required `verify` on #1503 is authoritative.
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS — operator-ui matched, required artifact present

### The narrowed package test glob drops nothing that was running

`apps/command-center/package.json` changed its `test` script from
`tsx --test "src/**/*.test.ts" "src/**/*.test.tsx"` to
`tsx --test src/lib/*.test.ts src/lib/*.test.tsx src/lib/data/*.test.ts`. Read as a glob
that means fewer files, so it is worth stating what it actually cost.

POSIX `sh` expands `**` as a single path segment, so the old pattern never reached
`src/lib/data/` at all — the auth assertions this lane added there would have been written
and never run. The narrowed form reaches them explicitly.

Four Command Center test files are outside the new pattern:
`src/app/api/governance/lanes/route.test.ts`, `src/app/command-center-pages.test.tsx`,
`src/app/command-center-rebuild.test.tsx` and `src/components/ui/shared-components.test.tsx`.
All four are already listed in `docs/05_operations/executable-wiring-baseline.json` on
`origin/main` as baselined-unwired, and the wiring report at this anchor reports
`unwired=119 (baselined=119 new=0)` — so they were not running before this change either,
and this change adds none. That is a pre-existing gap this lane neither created nor closes.

### A defect in this bundle's own controls, found by CI and repaired

Two of the pins this lane added — `lib/data/client-cache-auth.test.ts` and the
`the authenticated forged-actor cases actually reach the backend` case in
`lib/server-action-guard.test.ts` — passed locally and failed the required `verify`.
Neither failure was behavioural. Both build the data client, which resolves `SUPABASE_*`
before any request exists, so a checkout carrying those values rendered them green and
CI, which carries none, red. A control whose verdict depends on ambient environment
constrains nothing reliably.

The repair is `withLoopbackSupabaseTarget` in `lib/test-support/workspace-env.ts`. It
**overrides** the Supabase target with a literal loopback address rather than filling a
gap, so both environments now exercise the same target. `decideTarget` in
`packages/db/src/privileged-client-boundary.ts` classifies a literal loopback address as
`loopback` and allows it explicitly as provably isolated; `globalThis.fetch` is stubbed
over the same window in the forged-actor harness. Nothing there can reach a real database
in either direction.

The docblock that previously described this residue as irreducible was corrected in the
same commit, and now states what the control does not establish: the stubbed response
means the test says nothing about how a real backend would treat the request. It
establishes only that each action issues an outbound request under an authenticated
caller, which is what makes the forged-actor loops non-vacuous.

Recorded here rather than omitted because it is the same class the rest of this bundle
exists to rule out — an artifact that agrees with itself while constraining nothing.

## Runtime Verification

**Re-measured 2026-09-05 against the current implementation, not carried forward.** The table below
was produced after the credential-derived-actor rework (`870bbbaf`), replacing an earlier probe run
at anchor `1aab560ab`. Nothing here is quoted from the earlier run.

Two production builds of the Command Center, each `next build` + `next start`, probed over real
HTTP from the same tree, differing in exactly one line of `src/middleware.ts`. Configuration for
both arms: `UNIT_TALK_APP_ENV=production` (auth-required derived, not overridden — no
`COMMAND_CENTER_AUTH_MODE` set), `COMMAND_CENTER_AUTH_TOKEN=<redacted — locally generated probe
value, not a provisioned secret>`, and `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` /
`SUPABASE_ANON_KEY` explicitly unset via `env -u`.

Probing a served build is the only way to see this defect. Next's `config.matcher` decides whether
middleware is invoked at all, so a test that calls `middleware()` directly cannot observe it — and
every such test passed while the bypass was live.

The two arms are identified by what the build actually compiled, read out of
`.next/server/middleware-manifest.json` rather than from the source line:

| arm | `sha256(src/middleware.ts)` | compiled matcher regexp |
|---|---|---|
| A (this PR) | `70008bf9782372c84d628297940893c409221cb9a427f1842322a5a86d2ce88c` | `^(?:\/(_next\/data\/[^/]{1,}))?(?:\/((?!_next\/static\|_next\/image).*))(…)?[\/#\?]?$` |
| B (original) | `45541b041a1336fc712d6c518ad19acb3587203f2f1462fc14e587fc4fb7df2b` | `^(?:\/(_next\/data\/[^/]{1,}))?(?:\/((?!.*\\..*).*))(…)?[\/#\?]?$` plus a second matcher for `/icon.svg` |

Arm A's build was produced first; arm B was produced by reverting only the matcher, and the arm-A
`sha256` was re-confirmed byte-for-byte after the revert, so the committed tree is the tree that
produced arm A.

**Both probe runs were preconditioned.** The harness refuses to start if the port is already
listening and aborts if the server exits before probing. This is not theoretical: a first arm-A run
on port 4399 was contaminated by a stale `next-server` left over from an earlier session, which
answered every request with a foreign build and produced anonymous 200s. Those numbers were
discarded, the process was killed, the preconditions were added, and both arms below were re-run on
clean ports (A: 4401, B: 4402).

Each cell is `HTTP status` and, where the body carried one, the refusal code found in it. Byte
counts are recorded in `evidence.json`; they are corroborating detail, not the claim — a 200 with a
matching byte count is not by itself proof of equivalent content.

| request | credential presented | arm B: original matcher | arm A: this PR |
|---|---|---|---|
| `GET /` | none | 401 `COMMAND_CENTER_AUTH_REQUIRED` | 401 `COMMAND_CENTER_AUTH_REQUIRED` |
| `GET /picks/abc` | none | 401 `COMMAND_CENTER_AUTH_REQUIRED` | 401 `COMMAND_CENTER_AUTH_REQUIRED` |
| `GET /picks/abc.def` | none | **200, 5920 bytes of rendered operator HTML** | **401 `COMMAND_CENTER_AUTH_REQUIRED`** |
| `GET /picks/abc.json` | none | **200, 5925 bytes** | **401 `COMMAND_CENTER_AUTH_REQUIRED`** |
| `GET /model-health` | none | 401 | 401 |
| `GET /api/events` | none | 401 | 401 |
| `GET /api/health` | none | 200 (public) | 200 (public) |
| `GET /icon.svg` | none | 200 (public) | 200 (public) |
| `GET /picks/abc.def` | **forged identity headers only** (`x-command-center-actor: attacker`, `x-command-center-role: admin`, `x-forwarded-user: attacker`) | **200, 5920 bytes** | **401 `COMMAND_CENTER_AUTH_REQUIRED`** |
| `GET /picks/abc.json` | forged identity headers only | **200, 5925 bytes** | **401** |
| `GET /` , `/picks/abc`, `/model-health`, `/api/events` | forged identity headers only | 401 | 401 |
| `GET /picks/abc.def` | **invalid credential** (`Authorization: Bearer definitely-not-the-token`) | **200, 5914 bytes** | **401 `COMMAND_CENTER_AUTH_INVALID`** |
| `GET /picks/abc.json` | invalid credential | **200, 5919 bytes** | **401 `COMMAND_CENTER_AUTH_INVALID`** |
| `GET /` , `/picks/abc`, `/model-health`, `/api/events` | invalid credential | 401 `COMMAND_CENTER_AUTH_INVALID` | 401 `COMMAND_CENTER_AUTH_INVALID` |
| `GET /`, `/picks/abc`, `/picks/abc.def`, `/picks/abc.json`, `/model-health` | **valid credential** | 200 | 200 |
| `POST /picks/abc.def` (`Next-Action`, fabricated id) | none | **404, `x-nextjs-action-not-found: 1`** | **401 `COMMAND_CENTER_AUTH_REQUIRED`** |
| `POST /picks/abc` (`Next-Action`, fabricated id) | none | 401 `COMMAND_CENTER_AUTH_REQUIRED` | 401 `COMMAND_CENTER_AUTH_REQUIRED` |

Three things this table does and does not establish, stated so the reader does not have to infer
them:

1. **The forged-identity row is the point of the A5 rework.** Forging `x-command-center-actor` buys
   nothing under either matcher — arm B's 200 comes from the matcher bypass, not from the header,
   and the identical byte counts (5920/5925) between the anonymous and forged rows are what shows
   the header changed no rendered content.
2. **The invalid-credential row is distinct from the anonymous row.** Under arm A they differ in
   refusal code (`COMMAND_CENTER_AUTH_INVALID` vs `COMMAND_CENTER_AUTH_REQUIRED`), which is how the
   probe distinguishes "authentication evaluated and rejected" from "authentication never ran".
3. **The `Next-Action` POST proves rejection at the boundary, not prevention of a real action.** The
   arm-B 404 is Next declining a *fabricated* action id before dispatch. Under arm A the request is
   refused before it reaches the dispatcher at all — a genuine difference — but no real server
   action was invoked in either arm, so this row does **not** demonstrate anonymous execution of a
   real action being stopped. That coverage is carried by the source tests and mutations M2–M8
   below, and by A5b, not by this probe.

Two rows sit at valid credential and are **not** successful backend execution: `GET /api/events`
returns **500** and `GET /api/health` returns **503**, identically in both arms. Both are the
probe's deliberate absence of Supabase credentials surfacing as a downstream fetch failure
(`command_center.health_read_failed … TypeError: fetch failed` in the server log). They are recorded
because reaching an authenticated handler that then fails on a missing backend proves the request
passed the authentication boundary — and proves nothing at all about the handler's behaviour with a
real backend.

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

## Independent review

Reviewed by an agent that did not implement the change.

| Bound to | Finding |
|---|---|
| implementation commit `870bbbafb70087c1bba1d814c20eca0861f9e16f` | ACCEPTED |
| post-review fixture change (`FORGED_AUTHENTICATED_IDENTITY_HEADERS`) | CONFIRMED without restarting the review — no blocker found |

Measured by the reviewer at that commit: `server-action-guard.test.ts` 54/54, and the full
`apps/command-center` suite 488 pass / 0 fail / 0 skipped under the then-current `src/**` glob. The
reviewer also measured *why* the fixture change was needed: the previous bare `'admin'` role value
was invisible to all three detection predicates, so a forwarded caller-supplied authority claim
would have gone undetected beside a correctly recorded actor.

The reviewer raised one residue, recorded rather than chased: for `x-command-center-role` the
sentinel is a *suffix* (`admin-<sentinel>`), so an action forwarding a truncated role would still
evade the search. Verbatim forwarding, the realistic case, is caught. No single fixture value
defeats arbitrary truncation.

### What changed after the review, and what it did to the numbers

`c4551d69460c1a159baca8d1226a45b654a13d42` moved test files; it changed no product code, so the
reviewer's acceptance of `870bbbafb` still binds the shipped implementation.

The move was forced by the required `verify` check. This branch had widened
`apps/command-center/package.json` to `tsx --test "src/**/*.test.ts" "src/**/*.test.tsx"`. tsx
expands that recursively, so every file ran — but `scripts/ci/automation-coverage-check.ts` models
POSIX `sh`, where `**` is a single path segment. It therefore read the change as dropping the six
`src/lib/data/*.test.ts` files and as newly reaching two files that are reviewed entries in
`docs/05_operations/executable-wiring-baseline.json`, and failed. That baseline is outside this
lane's `file_scope_lock`, so the script now names each directory with a single-segment glob the
checker can resolve, and the assertions that had been added to unreachable files were moved to
files the script runs:

| was | now |
|---|---|
| `src/app/command-center-rebuild.test.tsx` (rewritten) | `src/lib/unauthenticated-route-renders.test.tsx` |
| `src/app/unauthenticated-page-reads.test.tsx` | `src/lib/unauthenticated-page-reads.test.tsx` |
| new assertions in `src/app/api/governance/lanes/route.test.ts` | `src/lib/governance-lanes-route-auth.test.ts` |

488 → 480 is fully accounted for: eleven tests left the run — `command-center-pages.test.tsx` (5),
`shared-components.test.tsx` (3) and `route.test.ts` (3), none of which is reachable on `main`
either — and three joined (`governance-lanes-route-auth.test.ts`). Every assertion this branch
authored still executes.

**One limitation this created, stated plainly.** `src/app/command-center-rebuild.test.tsx` was
restored to its state on `main` rather than deleted, because deleting it would require editing the
wiring baseline. Measured directly, main's version is 8 tests, 2 pass, **6 fail** — its assertions
name page copy from a much earlier revision. It failed that way before this branch and is reachable
from no package script or workflow, so nothing runs it and this PR changes neither fact. The
rewritten, passing form of those assertions is what now runs, from
`src/lib/unauthenticated-route-renders.test.tsx`.

### Second review pass — the whole range, through the final head

The acceptance above binds `870bbbaf`. Because that commit is not the head, a second reviewer — again
one that did not author the change — was given the full range
`870bbbafb70087c1bba1d814c20eca0861f9e16f..3d46af43633264c86f717851510a5cf86958f88c` and asked
whether anything after the accepted commit altered what was accepted. It returned
**`VERDICT: CONFIRMED`**, on these measured grounds:

- **No product code is in the range.** Every non-test file changed is one of: `next-env.d.ts`, now
  byte-identical to `origin/main` (`git diff origin/main --` is empty — `870bbbaf` carried a locally
  regenerated variant and `8bbfd38f1` reverted it); the one-line `test` script in
  `apps/command-center/package.json`; `docs/06_status/readiness/readiness-score.json`, which arrived
  with the `origin/main` merge; and `src/lib/test-support/workspace-env.ts`, which a grep of
  non-test sources under `apps/command-center/src` shows no product module imports.
- **The loopback target is allowed deliberately, and nothing can reach a real database.**
  `isLoopbackTarget` in `packages/db/src/target-identity.ts` matches `127.0.0.0/8`, `classifyTarget`
  returns `kind: 'loopback'`, and `decideTarget` allows it with reason *"target is a literal loopback
  address"*. Three independent reasons no request escapes: the helper **overrides** `SUPABASE_URL`
  rather than filling a gap, so an ambient real project ref cannot survive the window;
  `server-action-guard.test.ts` stubs `globalThis.fetch` across the same window; and
  `client-cache-auth.test.ts` issues no request at all. The module-level `_client` cache in
  `lib/data/client.ts` was checked rather than assumed — every reachable `getDataClient()` runs
  inside a loopback window, and node:test gives each file its own process.
- **Both windows are `finally`-protected** and restore prior values, deleting keys that were absent.
- **No assertion was weakened.** The reviewer re-derived the mutation argument for both named
  guards: moving `assertPrivilegedRequestAuthenticated()` inside the `if (!_client)` cache check
  (the original bug shape) still fails `assert.rejects`, and forwarding the caller-supplied
  `x-command-center-actor` into an outbound payload still trips the sentinel search. The loopback
  repair is what makes those assertions *reachable*; before it they died in
  `packages/config/src/env.ts` on the missing `SUPABASE_*` trio, which is a harness failure, not a
  behavioural one.
- **The `test` script is a widening against `main`, not a narrowing.** `origin/main` reads
  `tsx --test src/lib/*.test.ts src/lib/data/*.test.ts`; the `src/**` form was introduced by this
  lane and walked back, and the net change against `main` is `+ src/lib/*.test.tsx`. The reviewer
  independently confirmed all four unmatched files are already baselined entries on `main`, and that
  `src/app/command-center-rebuild.test.tsx` fails 6 of 8 in a clean `main` checkout — so the wide
  glob would have imported a pre-existing red.

Reviewer-measured, with the ambient credentials stripped: the two touched files 55 pass / 0 fail; the
`apps/command-center` package suite `# tests 480 / # pass 480 / # fail 0`; and
`pnpm ops:automation-coverage-check` `verdict=PASS`, `unwired=119 (baselined=119, new=0)`.

One non-blocking flag it raised, recorded rather than corrected: the docblocks in
`governance-lanes-route-auth.test.ts` and `unauthenticated-route-renders.test.tsx` say the `src/app`
originals are "not reachable from any package script". That is true of `origin/main` and true of the
merged result, but it was momentarily false at `870bbbaf`, where this branch's own wide glob reached
them. Read as a statement about the shipped state it is correct.

### The QA Experience advisory fails for lack of a server, not for a regression

`QA Experience Regression (Advisory)` is red on this PR, and the cause is stated here rather than
left as an unexamined red or waved off as "advisory". It re-runs on every head; the measurement
below was taken at head `96c913c9` and the cause is not head-dependent.

Re-run locally at the same head (`pnpm qa:experience --regression --mode fast --skip-preflight`,
artifact `apps/qa-agent/artifacts/unit-talk-command_center-daily_ops-operator/2026-09-05T12-56-34-fl38sw/`,
recorded `Head SHA: 96c913c9b`), it reproduces exactly:

```
1. x Navigate to dashboard
   > page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:4300/
FAILED command_center_dashboard_shell_renders (critical): Missing dashboard shell selectors:
        lifecycleCard, apiStatus, workerStatus.
```

No Command Center process is listening. The two expectations that can be evaluated without a
rendered page both passed — `command_center_no_broken_lifecycle_signals` and
`command_center_no_5xx_network_responses` — and all three preflights report
`SKIPPED ... Skipped by --skip-preflight`. So the single critical failure is the one expectation
that requires a running server, and its network log names the connection refusal as the reason.
The check's own note says the same thing: *"apps are not running in CI."*

That makes this an infrastructure absence reported as a behavioural verdict — the same
aggregate-conflation shape recorded elsewhere in this repo — and **not** evidence of a regression
introduced by this change. It is also not evidence that no regression exists; it is evidence of
nothing at all about behaviour, which is precisely why it is written down instead of counted.

One related honesty note: the `qa-experience-report` artifact that satisfied the R-level check is
`unit-talk-command_center-research_lines-operator/2026-05-13T14-30-59-lopam7/result.json`, dated
2026-05-13. It predates this lane by months and says nothing about this change. It satisfies the
gate mechanically; it is not verification of this repair. The verification that *is* evidence about
this change is the built-app run recorded under **Runtime Verification** above, where the middleware
was bypassed in an isolated environment and missing, invalid, forged and valid credentials were each
exercised against the running application.

### Limitations of these controls, stated rather than implied

Two things the guard suite cannot see, recorded so a later reader does not mistake its scope:

1. **Import discovery is textual.** `server-action-guard.test.ts` finds actions by walking the
   source tree and matching exported async functions in `'use server'` modules, with comments and
   string literals stripped. It therefore covers actions declared where it looks. An action reached
   through a dynamically constructed import, or defined outside the directories it walks, would not
   be enumerated and so would not be required to carry the guard. The mitigation is A5b's
   per-operation authentication, which does not depend on the enumeration being complete: an
   unenumerated action still calls into a data path that authenticates, or it does not touch
   privileged data at all.
2. **`searchParams` and other request inputs are not modelled.** These controls decide *whether the
   caller is authenticated*, not *what the authenticated caller may ask for*. A parameter that
   selects records is out of their scope entirely; nothing in this bundle claims otherwise, and
   authorization beyond authentication is not part of this repair.

Closure for this issue is the authentication repair, its production build, the behavioural
verification above, and this account of the controls' limits — not a proof that every future
program over this app is safe.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1503
Approved PR head: pending merge
Execution SHA: 3d46af43633264c86f717851510a5cf86958f88c
