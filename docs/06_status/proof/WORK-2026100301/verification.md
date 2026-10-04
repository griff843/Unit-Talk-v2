# PROOF: WORK-2026100301

Issue: WORK-2026100301
Tier: T1
PR: https://github.com/griff843/Unit-Talk-v2/pull/1714
EXECUTION_SHA: 4debf792778dc76de237ceacb8c91edaa805683f
MERGE_SHA: pending merge
result: BLOCKED — local static/focused proof passes; exact-HEAD staging DB, shadow parity, trusted scope approval and T1 approval remain CI/operator gates.

## Verification

Control-closure verification on 2026-10-04:

- `pnpm exec tsx --test ... scripts/ci/assert-unmodified-vs-base.test.ts`: PASS, 217/217 focused issue tests. The control file itself passes 15/15: all original `assertUnmodified`/CLI fail-closed cases plus four base-pinned workflow regressions.
- `pnpm verify:static`: PASS, including lint, `pnpm type-check`, build, `pnpm test`, production post-migration static tests, Smart Form verification, and command checks.
- Product-path diff from PM-reviewed `ca2ef310e6726a088f1a12e0d82d0e924ad8e2f7` through the closure candidate: empty for `apps/**` and `packages/**`.
- Shadow runtime control: dependency cache, install, dry-run runner, and report parser execute from `trusted-base`, checked out at `${{ github.event.pull_request.base.sha }}` with persisted checkout credentials disabled. `${{ github.event.pull_request.head.sha }}` is evidence only and is never checked out.
- Shadow identity artifact records `trusted_base_sha`, `candidate_sha`, and `runtime_source=trusted-base` before credentials are checked. Missing mechanically read-only credentials and nonzero/empty guardrail observations remain blocking.
- `pnpm verify` at 4debf792778dc76de237ceacb8c91edaa805683f passed every static stage, then refused the unidentified localhost target. Source-head CI run 37240331566 passed required verify and writable staging DB proof; the smoke receipt records 7/7 passing tests against xskgrzbteyqdufktjrjx. T1 suites and the T1 Proof Gate also passed. Subsequent heads require fresh CI receipts.
- The sanctioned parent completed successfully: model gpt-5.6-sol, medium reasoning effort, CLI 0.153.3, exit 0; actual closure implementation and verification only. Its immutable model-routing.json is executor-generated. The earlier desktop implementation remains historically unattested.

## Assertions and measured evidence

- Shared gold accent, five distinct settled-state accents, all 22 launch families: discord-design-system.test.ts.
- Source confidence cannot appear; null CLV is absent and measured 0.0% survives: design, worker, stats and result tests.
- Missing optional financial, identity, probability, sportsbook, timestamp and media evidence is omitted: design, alert and hedge tests.
- All 150 supplied fixture losses survive recap pagination; Discord field/embed limits hold: design tests and presentation-proof.ts.
- Recap delivery resumes unsent pages after a transport failure without resending page one: recap-service.test.ts.
- Unknown VIP+ pricing is never invented; Black Label is unavailable for purchase; denial/error replies stay private after a public defer: design/foundation tests.
- Existing grading tests pass with the display-only unknown capper fallback removal.
- Offline adapter shadow: same destination, nonce and receipt in two old/new fixtures. This is not production shadow certification.

## Historical implementation commands

- Focused sender suite: 325 passing cases (includes earlier side-effect test duplication); grading suite: 100 passing cases.
- Final direct design test: 15/15 passing; required automation/executable wiring PASS, 421 reachable tests, zero newly unwired tests.
- Type-check and focused lint: PASS.
- R-level checker against origin/main: PASS; lifecycle-fsm, discord-delivery, ingestor-provider. Required measured artifacts are under artifacts/.
- pnpm test:db: REFUSED by the staging identity guard. Local configuration resolves to 127.0.0.1 / unidentified; expected staging project xskgrzbteyqdufktjrjx. No override or production DB write was attempted.
- pnpm verify at da000d16c15fb10b2a44e183cb6627e313677507: all static stages PASS; full gate BLOCKED at staging identity guard. The final tail is verify-tail.log. No database smoke/T1 live proof ran after refusal. Optional Smart Form E2E was not enabled.
- Offline rendering harness: PASS at desktop 1440px and mobile 390px; 21 representative embeds, no horizontal overflow.

QA sandbox token, guild and role/channel map are unavailable. PNGs are explicitly labeled local Discord simulation, rendered from actual builder payloads. They prove layout, not live Discord access or delivery.

## Remaining gates and policy gaps

CI requires a trusted exact issue/PR/HEAD/path scope-override/v1 record. The WORK-ID parser repair landed in PR 1712 and was incorporated through the merge-mutex wrapper. It preserves CODEOWNER-human authorization, exact identity/path matching and fail-closed behavior. The explicitly approved sender/control scope still needs a current-head external authorization record; no UTV2 identity is invented.

The prior shallow merge-base/package-diff shadow blocker is resolved structurally: the workflow no longer installs or executes candidate dependencies or runtime. The reusable `assertUnmodified` implementation and its original fail-closed tests remain unchanged. Live shadow proof is still blocked until the operator provisions the approved mechanically read-only secrets.

Tier synchronization passed on the control source head. tier:T1 remains applied. Final exact-HEAD CI and staging receipts, live shadow proof and PM merge approval remain necessary.

Historical desktop implementation model/effort remain unattested. Closure provenance is now genuine sanctioned executor evidence, recorded after a completed run. Admission metadata is not substituted for actual execution. Interrupted nested attempts are retained in checkpoint history and are not claimed as successful closure.

Separate product/routing gaps: receipt-derived result destinations do not ensure all-tier transparency; current result aggregation does not fully include void/correction history; existing unknown-stake guards suppress some posts; older delete/replace correction guidance conflicts with append-only history. Routing, lifecycle and policy remain unchanged.

## Merge SHA binding

Merge SHA: pending merge. Only authoritative post-merge automation may bind it.
