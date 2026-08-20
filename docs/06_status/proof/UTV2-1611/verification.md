# PROOF: UTV2-1611

MERGE_SHA: 5bf6ccb4c59fa24054b6b9f9412d3586cff2c26c

Lane: board pick writer must not bypass the governance brake into `validated`.
Tier: T1 · lane_type: runtime · executor: codex-cli
Substantive anchor: `5bf6ccb4c59fa24054b6b9f9412d3586cff2c26c` (the sanctioned pr-update-branch commit; implementation complete at `0a1488cb`, everything since is proof-only or a main refresh)

## Summary

This lane was parked on 2026-08-16 after an acceptance failure: a `board-construction` submission carrying full valid market evidence but **no** `systemGenerated` marker still persisted as `validated`, which is precisely the bypass the lane exists to close. Five corrections were required on resume. All five are implemented, each proved by a regression that failed before its fix.

A second pass then moved this lane's coverage onto test roots that are **already wired**, which allowed the lane to drop its earlier edits to `package.json` and `docs/05_operations/db-writer-classification.json` entirely. Both files are now byte-identical to `origin/main`.

## Verification

ASSERTIONS:

- [x] The reported defect reproduced before the fix: driven through the real `processSubmission` path with in-memory repositories, the persisted row read `status: validated` where `awaiting_approval` was required.
- [x] Admission is keyed on `payload.source`, not on the marker. `board-construction` is classified `boundary-required`, so it enters the boundary whether or not a producer stamped `metadata.systemGenerated`. Governance safety no longer depends on every producer remembering to stamp it.
- [x] `board-construction` is a member of `GOVERNANCE_BRAKE_SOURCES`, giving a second, source-keyed fallback brake.
- [x] `assertEveryAutomatedSourceIsBraked()` runs at module load and throws if any source classified automated is absent from the brake set — the exact drift that produced this defect.
- [x] Compile-time source exhaustiveness holds: `as const satisfies Record<PickSource, AutomatedWriteBoundaryPolicy>` means a new `PickSource` fails to compile until deliberately classified.
- [x] Omitting `metadata.systemGenerated` does not create a human path for `board-construction`: it is `boundary-required`, so it is admitted by source and born in `awaiting_approval` regardless of the marker and regardless of whether an operator originated it. Once admitted, a missing producer identity or missing market evidence throws before persistence — never a downgrade to the human path, never a default to `validated`.
- [x] The `validated` initial state is preserved only for sources classified `human-ingress` (`smart-form`, `feed`, `system`, `api`, `discord-bot`), proved by `automated write boundary preserves the human/manual validated path` driving a `smart-form` submission through the real `processSubmission` path.
- [x] `pnpm type-check` clean.
- [x] `pnpm lint` clean.
- [x] `pnpm test` — the `test:apps-api-core` root covering this lane reports 444/444 pass, 0 fail.
- [x] `pnpm ops:automation-coverage-check` verdict PASS with `new=0`: the lane introduces no newly-unwired test file.
- [x] `scripts/ci/r-level-check.ts` is evaluated by the R-Level Compliance Check on the pull request head.
- [x] **`pnpm test:db` runs against the approved staging project on every pushed head of this lane, as part of the required `verify` context.** No run id is cited here for "this head", deliberately: a bundle lives inside the head it describes, so any such citation names the *previous* head the moment it is committed. That is not a hypothetical — it went stale three times in this bundle before the citation was removed. Read the current head's result from the `Writable DB proof (staging only)` check. No claim is made about the branch's staging history, in either direction. Earlier heads include both failed and cancelled staging runs — `5bf6ccb4`, the SHA this bundle names as its own anchor, is among the cancelled ones. Their number is deliberately not counted here: a count of the branch's own history is exactly the kind of value that goes stale on the next run, and a previous revision of this sentence was wrong precisely because it quantified the claim instead of dropping it. What matters is not a streak but the gate: `verify` is required and it enforces the staging receipt for the head it runs on. Its result is not asserted here — read it from the checks list.
- [x] `pnpm verify` is the required CI context for this lane and the context that enforces the staging receipt. Its result on the head carrying this bundle is not asserted here — that head does not exist when the bundle is written. Read it from the checks list. Locally it cannot complete: its `test:db` step requires the staging project, and `ci:assert-staging` correctly refuses the credential-containment sentinel `127.0.0.1`. The staging result is therefore CI's, by design.
- [x] **`verify` enforces a same-run receipt, not this bundle.** `ci.yml` downloads the db-proof receipt artifact scoped to its own `run_id` and `run_attempt` — the run that just produced it — and checks it with `scripts/ci/verify-db-proof-receipt.ts`. Nothing in `verify` reads `evidence.json`. The staging guarantee for any head therefore comes from CI at that head, and a stale bundle cannot weaken it.
- [x] **The `runtime_proof` arrays are a readable snapshot, not the enforcement mechanism.** They were harvested from one specific historical run (32330316960, head `29d05ebc`) so the queries and row counts are legible inside the bundle. They are labelled with that run and no other. Nothing in this lane's merge authority rests on them.
- [x] The branch's position relative to `origin/main` is deliberately **not stated here**. Neither the behind-count nor the ahead-count is: the ahead-count moves on every commit to this branch, and the behind-count moves on every commit to `main` — including the `[skip ci]` readiness-ledger bot, which fires on its own schedule. A number that a third party can change after this file is written cannot be true in it. An earlier revision removed the ahead-count for exactly this reason and kept the behind-count in the same sentence; the behind-count then went stale, which is how this was found. Read both from the PR. The branch was brought current by a sanctioned `pr-update-branch` merge, not a rebase, and every commit references only this issue.
- [x] `package.json` and `docs/05_operations/db-writer-classification.json` are byte-identical to `origin/main`; the lane touches no `docs/05_operations/**` or `.lane/**` path.

## Runtime Verification

EVIDENCE:

### 1. The defect, reproduced before the fix

```text
not ok 8 - REGRESSION UTV2-1611: an unmarked board-construction production never persists as validated
  error: |-
    persisted status was "validated" - board-construction has no direct-to-validated release class
    + actual - expected
    + 'validated'
    - 'awaiting_approval'

not ok 9 - REGRESSION UTV2-1611: an unmarked board production without producer identity fails closed
  error: 'Missing expected rejection: a board production with no producer identity must fail closed, not persist'
# tests 14 / # pass 8 / # fail 6
```

### 2. After the corrections

```text
$ pnpm test:apps-api-core
AGGREGATE tests=444 pass=444 fail=0 skipped=0
```

`apps/api/src/submission-service.test.ts` grew from 73 to 89 tests: it now hosts the automated-boundary unit coverage, with every original assertion and test name preserved.

### 3. Wiring: coverage reaches a required root without touching `package.json`

`scripts/ops/executable-wiring.ts` counts reachability from package scripts, workflows and non-test code imports only — a test importing another test does not make it reachable. The boundary coverage was therefore moved into `submission-service.test.ts`, which `test:apps-api-core` names directly, and the live staging assertions into `t1-proof-awaiting-approval.test.ts`, which `test:t1-proof:live` already enumerates and `db-writer-classification.json` already classifies.

```text
$ pnpm ops:automation-coverage-check
[automation-coverage] verdict=PASS fail=0 warn=1 classified=15
[executable-wiring] verdict=PASS required_roots=verify
[executable-wiring] tests total=468 required-reachable=313 optional-reachable=36 unwired=119 (baselined=119 new=0)
[executable-wiring] capabilities total=154 wired=136 orphan=18 (baselined=18 new=0)
```

Before this consolidation the same check reported `verdict=FAIL fail=1 ... unwired=120 (baselined=119 new=1)`, naming `apps/api/src/automated-write-boundary.test.ts`. The single remaining WARN (`WIRING_GLOB_SHADOWED` under `apps/qa-agent/`) is pre-existing on `origin/main` and unrelated to this lane.

### 4. The two registrations are gone, not merely justified

```text
$ git diff origin/main --stat -- package.json docs/05_operations/db-writer-classification.json
(no output)

$ git diff origin/main --name-only | grep -E '^docs/05_operations/|^\.lane/|^package\.json'
(no output)
```

This is what removes the `Lane Authority` failure at its cause: the lane no longer touches any path outside the runtime lane's `allowed_path_globs`, so no widening of `.lane/lanes/runtime.yml` is required. It also removes the `Shadow Parity Check` refusal, which guarded `package.json` against modification by a production-credentialed pull request.

### 5. Live staging proof and harvested runtime evidence

`pnpm test:db` executes against the approved staging project as part of the required `verify` context on each pushed head. Its result on the head carrying this bundle is not asserted here; read it from the checks list. The branch's earlier history is not uniformly green — it contains both failed and cancelled staging runs, `5bf6ccb4` among the cancelled — which is precisely why the claim rests on the required gate at the head under review rather than on a streak.

The block below reproduces **one** of those runs, `29d05ebc` (run 32330316960), because that is the run whose receipt was harvested into `runtime_proof` so the queries and row counts are legible here. It is a readable snapshot of a historical run, labelled as such — it is not the head under review and it is not what any gate checks.

The staging guarantee for the head under review comes from CI at that head: `verify` downloads the receipt scoped to its own run (`${{ github.run_id }}-${{ github.run_attempt }}`) and validates it with `scripts/ci/verify-db-proof-receipt.ts`. It never reads this bundle. Separately, and independently of the receipt, the implementation has not changed since `29d05ebc`: `git diff 29d05ebc HEAD` touches no `apps/**` and no `packages/**` path. The evidence was not hand-written: it was harvested from CI's tamper-evident `ci-db-proof-receipt/v2` artifact by `scripts/ops/ci-db-proof-harvest.ts`, which re-verifies the receipt independently (`verifyHarvestedReceipt`) rather than trusting its declared fields.

```text
Workflow: CI -> Writable DB proof (staging only)
Run:      32330316960   Job: 96309632615   Attempt: 1
Head:     29d05ebc8feab6f8f6bccccc07b5dea8e414d334
Result:   SUCCESS
Project:  xskgrzbteyqdufktjrjx  (approved staging)

# tests 7
# pass 7
# fail 0
# skipped 0

runtime_proof.queries    : 7 entries, e.g.
  picks,submissions                                        - repository bundle persists a submission and settlement
  pick_lifecycle,picks,submissions                          - invalid atomic enqueue writes no lifecycle event or outbox row
  audit_log,distribution_outbox,distribution_receipts,...   - invalid atomic delivery confirmation rolls back every write

runtime_proof.row_counts : 8 entries, e.g.
  distribution_receipts  count=1  reset (rows deleted)
  distribution_outbox    count=2  reset (rows deleted)
  sports                 count=9  upserted (synthetic reference rows)
```

This lane's own live assertions live in `apps/api/src/t1-proof-awaiting-approval.test.ts`, which `test:t1-proof:live` already enumerates and `db-writer-classification.json` already classifies. The live cleanup voids through the lifecycle FSM — `transitionPickLifecycle(repositories.picks, pickId, 'voided', ..., 'operator_override')` — and asserts exactly one `pick_lifecycle` row per fixture with `from_state = 'awaiting_approval'`. The previous direct status `PATCH`, which wrote the lifecycle column with no `pick_lifecycle` row and no FSM validation, is not reintroduced; a source-scanning guard test enforces that and was strengthened so it stays load-bearing rather than tautological.

The bundle carries no author-written `verifier.identity`: schema-v2 forbids it, and exact-head provenance comes from CI.

### 6. Scope and authorization — the six-path request

The lane changes 18 files, all runtime-compatible (`apps/api/src/**`) plus its own lane manifest, sync file and proof bundle. Six changed paths lie outside the `file_scope_lock` recorded in the manifest's first commit, which is the only version the file-scope guard trusts — later manifest edits are ignored by design, so a lane cannot widen its own scope.

**No `scope-override/v1` artifact exists for these paths.** The final request is exactly:

```
apps/api/src/distribution-service.ts
apps/api/src/distribution-service.test.ts
apps/api/src/controllers/submit-pick-controller.ts
apps/api/src/controllers/submit-pick-controller.test.ts
apps/api/src/submission-service.test.ts
apps/api/src/t1-proof-awaiting-approval.test.ts
```

Why each is required, and why none is discretionary:

- `distribution-service.ts` — carries `GOVERNANCE_BRAKE_SOURCES`. `board-construction` must join it for the source-keyed fallback brake; this file was explicitly authorized in the correction brief.
- `controllers/submit-pick-controller.ts` — follows necessarily. Once `board-construction` is a brake source, the controller's unconditional re-application of `awaiting_approval` becomes an FSM-forbidden `awaiting_approval -> awaiting_approval` transition that would reject an already-correctly-governed submission.
- `submission-service.test.ts` — hosts the automated-boundary unit coverage, because it is named directly by the `test:apps-api-core` package script. Reachability is counted only from package scripts, workflows and non-test code imports, so a test importing another test does not run.
- `t1-proof-awaiting-approval.test.ts` — hosts the live staging assertions, because it is already enumerated in `test:t1-proof:live` and already classified in `db-writer-classification.json`.
- The two `.test.ts` companions of the source files change only assertions that encoded the defect.

Reusing those two already-wired roots is what let this lane drop its earlier edits to `package.json` and `docs/05_operations/db-writer-classification.json` entirely — both are now byte-identical to `origin/main`. That removed the `Lane authority` failure at its cause rather than by widening `.lane/lanes/runtime.yml`, and removed the `Shadow Parity Check` refusal that guarded `package.json`.

The manifest records this truthfully and withdraws an earlier entry that asserted its own PM authorization; that entry was self-authored by an implementing agent and no such authorization had been granted.

### 7. Out-of-scope finding: transient `validated` for boundary-when-marked sources

An exact-head review observed that a `system-pick-scanner`, `alert-agent` or `model-driven` submission omitting `metadata.systemGenerated` is not admitted to the write boundary — those sources are classified `boundary-when-marked`, not `human-ingress` — so `processSubmission` persists it as `validated` before the controller's source-keyed brake moves it to `awaiting_approval`.

This section is scoped strictly to `boundary-when-marked` sources. It has no `board-construction` analogue: `board-construction` is `boundary-required`, admitted by source, and has no legal `validated` state — transient or resting — so nothing below describes a board submission that may remain `validated`.

Investigated rather than dismissed. The finding describes real behaviour, but it is **not introduced by this lane and is not a defect this lane created**:

- `git diff origin/main` shows no change to any scanner path in this lane.
- The real producer stamps the marker at `candidate-pick-scanner.ts:250`, so it is admitted to the boundary and born in `awaiting_approval` with no transient state.
- `submit-pick-controller.ts` applies the brake **by source**, before any distribution enqueue — no outbox row and no run is created from the transient state.
- `detectAutomatedDirectToValidatedWrite` documents the choice deliberately: flagging an unmarked `boundary-when-marked` source by source alone would turn a lawful in-flight state into a hard failure on the idempotent re-submission path, and would fail closed on ratified fixtures carrying no producer identity or market evidence.

Residual exposure, stated plainly — and corrected after an adversarial review found the first statement of it too narrow:

An earlier revision of this section said only that an asynchronous reader polling for `status = validated` could **observe** the row. That understates it. `enqueueDistributionWork`'s defense-in-depth check (`distribution-service.ts:238`) is **lifecycle-state-only, not source-aware** — it throws on `lifecycleState === 'awaiting_approval'` but does not consult `isGovernanceBrakeSource`. `requeue-controller.ts` (`POST /api/picks/:id/requeue`, operator-role gated) does not re-check the brake either; it gates on `promotion_status === 'qualified'`, non-terminal status, and no active outbox row. So an operator-authenticated caller who already knew the pick id could, inside that same synchronous window, **act on** the transient row and enqueue it for real distribution — not merely observe it.

Bounding facts, none of which make it a non-issue: it requires operator-role authentication, which already carries broader override capability elsewhere; the window is a single synchronous database round-trip with no external trigger point at which the pick id becomes knowable beforehand; and `candidate-pick-scanner.ts`'s `resolveGovernanceBrakeAction` has a `void_advanced` fallback that catches and voids a pick advanced during it.

This is **pre-existing and not introduced by this lane**, and is recorded here as a tracked follow-up rather than fixed, because narrowing `enqueueDistributionWork` to be source-aware touches the distribution path beyond this lane's authorized scope. Broader compile-time exhaustiveness hardening for `GOVERNANCE_BRAKE_SOURCES` is tracked separately, and this lane's issue explicitly directs that it not be re-scoped here.

## Stop Condition

Merge requires the head-pinned `scope-override/v1` comment, `t1-approved`, and a `pm-verdict/v1` APPROVED comment, none of which this lane may produce for itself.
