# PROOF: UTV2-1902

MERGE_SHA: pending merge

> Pre-merge, the merge row intentionally holds the placeholder value. The Execution SHA row below
> carries the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-23T06:00:00.000Z
Issue: UTV2-1902
Tier: T1
Lane type: runtime
Branch: claude/utv2-1902-score-gate-smart-form-best-bets
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1630
Head SHA: 2dc79802be461f8a0420cdce945bc4326e753d23
Execution SHA: 2dc79802be461f8a0420cdce945bc4326e753d23
Diff base: 966d9a31b851a67f65864002b8ef5109b2003bfe
result: pass

> PM rule, ratified under UTV2-1900: intake source never confers promotion. Smart Form picks are
> score-gated for board promotion like any other source. Human capper delivery picks get no
> board target. The confidence-floor and exposure-gate carve-outs are unchanged.

## ASSERTIONS:

Each box names a test that asserts it and a mutation that makes that test fail.

### Smart Form is score-gated, not source-promoted

- [x] A below-threshold Smart Form pick stays below threshold, with no board target.
      `UTV2-1902: a below-threshold Smart Form pick stays below threshold, with no board target`
      (`apps/api/src/promotion-edge-integration.test.ts`).
- [x] A below-threshold Track Only pick carries no board target either.
      `UTV2-1902: a below-threshold Track Only pick carries no board target either`.
- [x] A Smart Form pick that meets the threshold qualifies, by score.
      `UTV2-1902: a Smart Form pick that meets the threshold qualifies by score`.
- [x] Through the full submit path, a below-threshold Smart Form pick is neither promoted nor
      enqueued. `UTV2-1902: handleSubmitPick smart-form pick below promotion threshold is not
      promoted or enqueued` (`apps/api/src/submission-service.test.ts`).
- [x] The exposure-gate carve-out is unchanged. Same-game exposure is decided by score, not
      rejected by the exposure gate:
      `handleSubmitPick smart-form same-game exposure is decided by score, not by the exposure gate`.

### Human capper delivery picks get no board target

- [x] A human capper delivery pick that meets a board threshold still gets no board target, and is
      suppressed with `HUMAN_CAPPER_BOARD_PROMOTION_NOT_APPLICABLE`.
      `UTV2-1902: a human capper delivery pick that meets a board threshold still gets no board target`.
- [x] The same qualifying scores *without* a delivery authorization do qualify. The suppression
      keys on the authorization, not on the source.
      `UTV2-1902: the same qualifying scores without a delivery authorization do qualify`.
- [x] Board `force_promote` is refused with `409 HUMAN_CAPPER_DELIVERY_PICK`.
      `UTV2-1902: board force_promote is refused for a human capper delivery pick`.
- [x] Official-picks entitlement is not narrowed. The UTV2-1923 human capper delivery proof suite
      (`apps/api/src/t1-proof-utv2-1923-human-capper-delivery.test.ts`) still passes in full. Its
      one change asserts that the pick no longer acquires a board target, while the
      `official-picks` release path is unchanged.

### Command Center tells the truth about promotion

- [x] A human capper pick with no board target renders the absence, not a lane.
- [x] A `force_promote` history row reads as an override, never as score qualification.
- [x] An explicit `hasRealEdge: false` wins over a numeric `realEdge`.
      All three are in `apps/command-center/src/lib/promotion-presentation.test.ts` (7 tests).

### The rule is canonical

- [x] `docs/05_operations/T1_SMART_FORM_V1_CONTRACT.md` §7a states the rule, the carve-outs, the
      409 refusal and the unchanged Track Only behaviour, and that it governs over earlier text.

## MUTATION CONTROLS:

Every mutation was applied at head `2dc79802b` and reverted with `git checkout`. The baseline was
re-run clean after each.

| Mutation applied | Expected | Observed |
|---|---|---|
| Drop the human capper suppress override in `promotion-service.ts` (`override: undefined`) | the HC board-target control fails | `not ok 94 - UTV2-1902: a human capper delivery pick that meets a board threshold still gets no board target`. 236 pass / 1 fail |
| Replace the 409 predicate in `override-promotion-controller.ts` with `false` | the refusal control fails | `not ok 93 - UTV2-1902: board force_promote is refused for a human capper delivery pick`. 236 pass / 1 fail |
| Restore a source-only `forcePromote` for `source === 'smart-form'` in `promotion-service.ts` | every score-gate control fails | 7 failures, including tests 90, 91, 92, 95 and 101 (UTV2-1902) and the exposure-gate and board-capacity tests. 230 pass / 7 fail |
| `const overridden = false` in `promotion-presentation.ts` | the override-labelling control fails | `not ok 2 - UTV2-1902: a force_promote history row reads as an override, never as score qualification`. 6 pass / 1 fail |
| Delete the `explicit === false` branch of `readRealEdgePresence` | the explicit-false control fails | `not ok 4 - UTV2-1902: explicit hasRealEdge:false wins over a numeric realEdge`. 6 pass / 1 fail |
| None (baseline) | all pass | API focused suites 237/237; Command Center 7/7 |

## RUNTIME EVIDENCE:

### The defect instance, measured in production (read-only)

A read-only `SELECT` against production `zfzdnfwdarxucxtaojxm` at 2026-09-23T05:51Z, on
`picks` joined to `pick_promotion_history`:

| Field | Value |
|---|---|
| pick | `2cc92f4b-bdc9-4fc4-8cf3-493407d2716b` |
| `source` / `distributionMode` | `smart-form` / `delivery-eligible` |
| `promotion_status` / `promotion_target` | `qualified` / `best-bets` |
| `promotion_score` | **32.75** |
| history, `best-bets` | `status = qualified`, `override_action = force_promote`, reason `hard eligibility checks passed \| smart-form submissions route directly to best-bets` |
| history, `trader-insights` | `not_eligible`, score 33.7, `edge score 0.00 is below threshold 85.00` |
| history, `exclusive-insights` | `not_eligible`, score 31.16, `edge score 0.00 is below threshold 90.00` |

A score of 32.75 was recorded as `qualified` for a member-facing board purely because of its
intake source. This is the path the diff removes. As the issue directs, the production rows are
**not rewritten**. The instance is recorded here as evidence only.

### Containment readback (read-only, same query window)

| Probe | Value |
|---|---|
| `delivery_kill_switch` | `best-bets`, `exclusive-insights`, `official-picks`, `trader-insights` all `killed = true` (the only unkilled row is the `t1-proof-utv2-1427-kill-switch` fixture target) |
| `distribution_outbox` total / newest | 5,750 / 2026-09-23 02:21:03 |
| governed picks (`metadata ? 'distributionMode'`) | 9 |

Nothing in this lane deployed, wrote to production, or changed containment.

### Writable DB proof

`pnpm test:db` cannot run from a developer checkout: `ci:assert-staging` refuses anything that is
not the staging project. The authoritative run is the CI `staging-db-proof` job on PR #1630. Its
run-scoped `ci-db-proof-receipt` is verified inside the required `verify` context by
`scripts/ci/verify-db-proof-receipt.ts`. Text in this file cannot show which database a run
targeted, so no TAP block is transcribed here.

## Verification

EVIDENCE:

| Command | Exit | Result |
|---|---|---|
| `pnpm type-check` | 0 | pass: no diagnostics |
| `pnpm lint` | 0 | pass: no output |
| `pnpm test` | 0 | pass: **6,082 `ok` lines, 0 `not ok`**, 105 suite blocks each `# fail 0` |
| `pnpm exec tsx --test apps/api/src/promotion-edge-integration.test.ts apps/api/src/submission-service.test.ts apps/api/src/t1-proof-utv2-1923-human-capper-delivery.test.ts` | 0 | 237 pass / 0 fail |
| `pnpm exec tsx --test apps/command-center/src/lib/promotion-presentation.test.ts` | 0 | 7 pass / 0 fail |
| `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | 0 | `Verdict: PASS`, 13 changed files, rules matched `promotion-scoring`, `operator-ui` |
| `pnpm verify` | n/a locally | refuses at `ci:assert-staging` from a developer checkout (deliberate staging isolation). The required `verify` context on PR #1630 **passed** at head `9ed2aaae8c59cffa9bf99c3730b1076f8debd8ca`, including its run-scoped DB-proof receipt check |
| `pnpm test:db` | n/a locally | CI `staging-db-proof` job on PR #1630, receipt verified inside `verify` |

### R-level: what the PASS does and does not show

`r-level-check` reports `promotion-scoring` → R2 (`r2-determinism`), R3 (`r3-shadow-report`), and
`operator-ui` → `qa-experience-report`, all `found: true`. **Those artifacts belong to other
issues.** The check's globs match `artifacts/r2-determinism-utv2-845.json`,
`artifacts/shadow-report-utv2-845.json` and a 2026-05-13 QA result. They are not evidence about
this diff. The producers were run against this head:

- `tsx scripts/shadow-scoring-runner.ts --mode ci` exits 1 with
  `SUPABASE_URL and SHADOW_PARITY_READ_ONLY_KEY are required`. That credential is absent, and this
  lane does not handle secrets.
- `tsx scripts/live-data-lab-runner.ts` exits 1 with `ERR_MODULE_NOT_FOUND`. The script does not
  exist on `main`.

The determinism this diff relies on is structural. It removes a branch and adds one pure
predicate (`isHumanCapperDeliveryAuthorized`) that decides between two fixed override inputs to
the existing `evaluatePromotionEligibility`. It adds no randomness, clock or I/O. Nothing here
claims an R2 or R3 artifact was produced.

## STOP CONDITIONS ENCOUNTERED:

- **T1 merge authority belongs to Griff.** This PR needs the `t1-approved` label **and** a
  `pm-verdict/v1` APPROVED comment from CODEOWNERS. Neither is claimed or inferred here.
- **Not deployed.** Dispatching a production deployment is reserved decision 8. Until then,
  production keeps running the source-only path.

## Sign-off

Verifier Identity: Claude Opus 5.5 (1M context), acting as execution orchestrator
Date: 2026-09-23
Commit SHA(s): 2dc79802be461f8a0420cdce945bc4326e753d23
Related PRs: https://github.com/griff843/Unit-Talk-v2/pull/1630

Nothing in this bundle self-certifies Done.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1630
