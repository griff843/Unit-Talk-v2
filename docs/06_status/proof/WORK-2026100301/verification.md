# PROOF: WORK-2026100301

Issue: WORK-2026100301
Tier: T1
PR: https://github.com/griff843/Unit-Talk-v2/pull/1714
EXECUTION_SHA: 4debf792778dc76de237ceacb8c91edaa805683f
MERGE_SHA: 9452d2de53f5af5465863664bb91ef48f4c275eb
result: PRE_MERGE — proof format corrected; the refreshed source has green CI/staging/Shadow evidence below. This proof-only successor requires fresh exact-head CI, scope authorization and executor-result validation before READY_FOR_REVIEW. PM merge approval remains separate.

## Verification

Control-closure verification on 2026-10-04:

- `pnpm exec tsx --test ... scripts/ci/assert-unmodified-vs-base.test.ts`: PASS, 217/217 focused issue tests. The control file itself passes 15/15: all original `assertUnmodified`/CLI fail-closed cases plus four base-pinned workflow regressions.
- `pnpm verify:static`: PASS, including lint, `pnpm type-check`, build, `pnpm test`, production post-migration static tests, Smart Form verification, and command checks.
- Product-path diff from PM-reviewed `ca2ef310e6726a088f1a12e0d82d0e924ad8e2f7` through the closure candidate: empty for `apps/**` and `packages/**`.
- Shadow runtime control: dependency cache, install, dry-run runner, and report parser execute from `trusted-base`, checked out at `${{ github.event.pull_request.base.sha }}` with persisted checkout credentials disabled. `${{ github.event.pull_request.head.sha }}` is evidence only and is never checked out.
- Shadow identity artifact records `trusted_base_sha`, `candidate_sha`, and `runtime_source=trusted-base` before credentials are checked. Missing mechanically read-only credentials and nonzero/empty guardrail observations remain blocking.
- `pnpm verify` at 4debf792778dc76de237ceacb8c91edaa805683f passed every static stage, then refused the unidentified localhost target. Source-head CI run 37240331566 passed required verify and writable staging DB proof; the smoke receipt records 7/7 passing tests against xskgrzbteyqdufktjrjx. T1 suites and the T1 Proof Gate also passed. Subsequent heads require fresh CI receipts.
- The sanctioned parent completed successfully: model gpt-5.6-sol, medium reasoning effort, CLI 0.153.3, exit 0; actual closure implementation and verification only. Its immutable model-routing.json is executor-generated. The earlier desktop implementation remains historically unattested.

## ASSERTIONS: historical measured behavior

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

## EVIDENCE: refreshed source and proof-only successor

The following completed checks belong to source HEAD dbeae30a850ecf176846ca45172e7aef326c87c1, based on main 9326d4d6c150988b33db3f2840ed17fce659a6d8. They supersede the earlier credential/schema/scope blockers for that source. They do not bind the new proof-only successor: fresh synchronize-triggered checks and an exact-head executor comment are required after this correction is pushed. evidence.json and the model-routing sidecar retain historical source provenance; their old outstanding-gate list is not a statement of current remote check status.

[CI run 37523408928](https://github.com/griff843/Unit-Talk-v2/actions/runs/37523408928) completed SUCCESS: staging-only writable DB proof, T1 live suites, static verification and the same-run DB receipt verification. The receipt uses the PR merge ref; the Actions run records the candidate head separately.

```text
candidate_head: dbeae30a850ecf176846ca45172e7aef326c87c1
ci_run: 37523408928, attempt 1, SUCCESS
receipt_artifact: 11441567878 / utv2-1630-db-proof-receipt-37523408928-1
receipt_github_sha: 08edd9554cefcd096d437279dc29fedd557a709d (1714/merge)
command: pnpm test:db; exit_code: 0
observed_project_ref: xskgrzbteyqdufktjrjx (approved staging)
smoke: tests 9, pass 9, fail 0, skipped 0
receipt_sha256: ab83d52125717223bd806cb92644e62bb81b4cfe2241bbcf7ba769d426ddb2b3
```

[Shadow run 37523408665](https://github.com/griff843/Unit-Talk-v2/actions/runs/37523408665) completed SUCCESS with artifact 11440854628. This is a trusted-base production read-only observation, not candidate runtime execution or live Discord acceptance. Its counts are observations of existing data, not proof that this run posted messages.

```text
candidate_sha: dbeae30a850ecf176846ca45172e7aef326c87c1
trusted_base_sha: 9326d4d6c150988b33db3f2840ed17fce659a6d8
runtime_source: trusted-base
observed_at: 2026-10-06T20:03:12.933Z
candidatesScanned: 67689; shadowOnly: 67689
picksCreated: 0; shadowModeFalseSet: 0
distributionEnqueued: 0; promotionWidened: 0
```

The [exact-source scope rebind](https://github.com/griff843/Unit-Talk-v2/pull/1714#issuecomment-6024590301) covered the unchanged 80-path candidate set. File Scope Lock passed run 37523408629 after that authorization. It must be rebound to the proof-only successor by the authorized scope approver; this artifact grants no scope or PM authority. R-Level Compliance, Runtime Verifier, Proof Auditor, T1 Proof Gate and WFR-v2 checks were green on the refreshed source. Close Eligibility Preflight's branch parser skips WORK IDs; its green status does not establish that this lane passed the shared close-eligibility evaluation.

## ASSERTIONS: evidence and review boundaries

- [x] Refreshed-source staging DB proof succeeded against xskgrzbteyqdufktjrjx, with 9/9 smoke tests and same-run receipt verification, as recorded in CI run 37523408928.
- [x] Refreshed-source trusted-base Shadow observation used the exact candidate/base identities above and recorded zero for all four mutation guardrails, as recorded in run 37523408665.
- [x] Historical local verification refused the unidentified localhost DB target. Those refusals are retained above; no guard override or writable production proof is claimed.
- [x] Historical model provenance is limited to the completed control-closure run: gpt-5.6-sol, medium, CLI 0.153.3, exit 0. Original desktop implementation model/effort remain unattested; this proof repair does not invent retroactive provenance.
- [x] Render PNGs prove local simulation layout only. No live Discord acceptance, production readiness, or Discord-wave completion is established by these artifacts.
- [ ] The proof-only successor has fresh exact-head CI/staging, Shadow, scope and executor-result evidence. Complete this externally through the exact-head checks and executor comment; do not claim old receipts apply to a new HEAD.
- [ ] Independent PM has reviewed the final exact HEAD and supplied PM merge approval. No PM approval is asserted here.

## Remaining gates and policy gaps

After this proof-only correction, all previous exact-head bindings are stale. Required synchronize-triggered checks, an authorized exact-head scope rebind, and a valid executor-result/v1 comment must precede READY_FOR_REVIEW. Independent PM review remains required; merge/deployment/live Discord authorization is not granted by this proof.

Separate product/routing gaps remain unchanged: receipt-derived result destinations do not ensure all-tier transparency; current result aggregation does not fully include void/correction history; existing unknown-stake guards suppress some posts; older delete/replace correction guidance conflicts with append-only history. No routing, lifecycle, containment, or policy correction is included in this proof repair.

## Merge SHA Binding

Merge SHA: 9452d2de53f5af5465863664bb91ef48f4c275eb
PR: https://github.com/griff843/Unit-Talk-v2/pull/1714

Only authoritative post-merge automation may bind the merge SHA.
