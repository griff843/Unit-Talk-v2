# PROOF: UTV2-1904

MERGE_SHA: b14e444127d18a9e7f6091421758f2ebad604b74

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Issue: UTV2-1904
Tier: T1
Lane type: modeling
Branch: claude/utv2-1904-operator-evidence-settlement
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1579
Head SHA: f8d8b38086f20a422b78f21dd04993e3a3e60ed9
result: pass

## What this lane repairs

An evidence-plane pick could not be settled at all. `recordPickSettlement` refuses anything but a
`posted` pick, and a Track Only pick never becomes `posted` — by construction, because Track Only
means there is no delivery to post. So an operator holding a real, graded result had no way to
record it, and the four real production picks in the governed cohort had no path to a settled
record.

**Why a separate dispatch rather than a loosened guard.** The posted-state guard is what stops a
settlement being recorded against a pick that was never delivered. Loosening it would have removed
that protection for every pick rather than adding a path for the evidence plane. The dispatch is
placed deliberately *after* the `manual_review` branch: an evidence-plane pick has no delivery to
pause, and `recordManualReview` refuses anything but `posted`, so moving the dispatch above it would
silently convert that refusal into an acceptance. A `manual_review` request on a Track Only pick
must keep failing exactly as it does today — and a dedicated test asserts that it does.

## ASSERTIONS:

- [x] `isEvidencePlanePick` dispatches to `recordOperatorEvidenceSettlement`, and only after the
      `manual_review` branch has had its refusal.
- [x] **Fails closed without operator grading context.** Absent `operatorGradingContext` →
      `ApiError(400, OPERATOR_GRADING_CONTEXT_REQUIRED)`, and **no settlement row is written**.
- [x] `source: 'grading'` on this path → `ApiError(409, OPERATOR_SETTLEMENT_SOURCE_INVALID)`. An
      operator settling by hand may not claim the automated grader as the source.
- [x] `validateOperatorGradingContext` refuses each of `outcomeBasis`, `resultSourceUrl` and
      `observedAt` when missing or whitespace-only, and refuses an unparseable `observedAt`.
- [x] A settlement request *without* the context is still a valid request — whether it is required
      depends on the *pick*, which the validator cannot see. A malformed context, however, fails the
      whole request either way.
- [x] **No lifecycle transition.** `validated -> settled` is not a legal FSM edge; the operator path
      returns `lifecycleEvent: null` and `finalLifecycleState: pick.status`, and the pick stays
      `validated`.
- [x] **Zero delivery.** The recap guard in `settle-pick-controller.ts` skips an evidence-plane pick
      outright, and the staging proof counts `distribution_outbox` rows across *every* status.
- [x] A `posted` pick still settles exactly as before, with no operator context required.
- [x] Zero production writes. Containment, Track Only and member delivery unchanged.
- [ ] **Not claimed:** that the Command Center can perform this settlement. It cannot yet — see the
      dependency record below. That is a follow-on lane, blocked on a concurrency slot.

## EVIDENCE:

```
$ pnpm exec tsx --test packages/contracts/src/settlement.test.ts
# tests 18
# suites 3
# pass 18
# fail 0
# skipped 0
(exit 0)

$ pnpm exec tsx --test apps/api/src/settlement-service.test.ts
# tests 35
# pass 35
# fail 0
# skipped 0
(exit 0)

$ pnpm type-check
(exit 0)

$ pnpm lint
(exit 0)

$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 11
Rules matched: settlement-grading
Advisory (PM-gated) artifacts missing:
  - r4-fault-report [PM-gated]
(exit 0)

$ pnpm verify
NOT RUN on the workstation, by design. `verify` ends at `test:live-db`, and
`ci:assert-staging` refuses when the host resolves to the containment placeholder.
`verify` is exercised by the CI job of the same name on this head; the run and job
identifiers are carried in evidence.json under sha_binding.ci_sentinels.
```

### One pre-existing test changed, and it was made stronger rather than weaker

`recordPickSettlement still requires posted state (delivery path unchanged)` asserted
`/posted or settled state/` for an `awaiting_approval` pick. This change routes that pick to the
evidence branch, which refuses it with `OPERATOR_GRADING_CONTEXT_REQUIRED` instead — a different
refusal for the same request.

It was renamed to `recordPickSettlement refuses a context-less settlement on an evidence-plane pick`,
with the change in *which* refusal is produced documented in the test body. Both load-bearing
assertions were kept — still refused, pick status unchanged — and one was **added**:
`assert.equal(await repositories.settlements.findLatestForPick(pick.id), null)`. The test now proves
more than it did before.

### A fixture correctness note, measured rather than assumed

`processSubmission`'s in-memory sequential fallback returns a pick object with **no `status` field at
all**. Asserting on `result.pick.status` would have compared against `undefined` and proven nothing
about the fixture. `createTrackOnlyValidatedPick` therefore reads the row back with
`repositories.picks.findPickById` and asserts `status === 'validated'` as an explicit precondition.
This was found with a scratch probe (`status= undefined readback= validated`), not inferred.

## Verification
- [x] `pnpm exec tsx --test packages/contracts/src/settlement.test.ts`: 18 tests, 18 pass, 0 fail, exit 0
- [x] `pnpm exec tsx --test apps/api/src/settlement-service.test.ts`: 35 tests, 35 pass, 0 fail, exit 0
- [x] `pnpm type-check`: exit 0
- [x] `pnpm lint`: exit 0
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS, 11 changed files, `settlement-grading` matched, one advisory PM-gated artifact missing
- [ ] `pnpm verify`: not runnable on the workstation under containment — run in CI on this head
- [ ] `pnpm test`: not run in full on the workstation for this lane; the changed surface is covered by
      the two suites above, and the full suite runs inside the CI `verify` job on this head

## Runtime Verification

`apps/api/src/t1-proof-utv2-1904-operator-evidence-settlement.test.ts` runs inside
`Writable DB proof (staging only)` against staging `xskgrzbteyqdufktjrjx`, pinned by
`assert-staging-target`; production credentials are absent from that workflow. It uses
`createDatabaseRepositoryBundle(createServiceRoleDatabaseConnectionConfig(env))` and submits through
`submitPickController` with `metadata.distributionMode: 'track-only'`, then reads everything back
through PostgREST rather than from return values.

**Test 1 — an operator settles an evidence-plane pick.** Exactly **one** `settlement_records` row
exists for the pick, with `source = 'operator'`, `settled_by = 't1-proof-operator'`, the
`operatorGradingContext` persisted in the payload, `clv: null` and
`clvUnavailableReason: 'operator_evidence_settlement_has_no_event_scope'`. `picks.status` is still
`validated`. **0** `pick_lifecycle` rows carry `to_state = 'settled'`. **0** `distribution_outbox`
rows exist for the pick, counted across *every* status rather than only the ones a delivery would
use.

**Test 2 — the same settlement without the context.** Refused; **0** `settlement_records` rows; pick
status unchanged; still **0** outbox rows. The fail-closed path is proven by absence in the database,
not by an exception type.

**Why this suite and not the in-memory one.** The in-memory bundle can be satisfied by a repository
that never writes. Reading the row back from Postgres is what distinguishes *"the code returned an
object"* from *"a row exists"*, and counting outbox rows in SQL is what distinguishes *"no delivery
was requested"* from *"a delivery was requested and silently dropped"*.

### Receipts — measured, not recalled

Execution anchor `f8d8b38086f20a422b78f21dd04993e3a3e60ed9`, workflow run `34901451748`, attempt 1.

| Job | Job ID | Conclusion |
|---|---|---|
| `Writable DB proof (staging only)` | `104168552520` | success |
| `verify` | `104172133767` | success |

`verify` declares `needs: staging-db-proof` and consumes that job's same-run receipt, so the two
cannot attest to different runs.

### Staging read-back — a separate client, after the run

Read-only against staging `xskgrzbteyqdufktjrjx` at `2026-09-14T22:11:13Z`, through a different
client from the one the test used, so these are not the test's own return values restated.

```
settlement_records WHERE settled_by = 't1-proof-operator'            -> 1   (baseline before the run: 0)
  id 7f54874f-6fe4-4f1f-993f-b257faf1a67d, pick 02af9856-7589-429b-bd25-3b42d2645f17
  result=win  source=operator  confidence=confirmed  status=settled
  evidence_ref=manual:utv2-1904:2f677fbc
  payload.operatorGradingContext.outcomeBasis    = 'Final box score, home team covered -2.5'
  payload.operatorGradingContext.resultSourceUrl = 'https://example.invalid/box-score/utv2-1904'
  payload.operatorGradingContext.observedAt      = '2026-09-14T22:40:00.000Z'
  payload.clv = null   payload.clvUnavailableReason = 'operator_evidence_settlement_has_no_event_scope'
  picks.status = validated   market = nba-spread   source = api   distributionMode = track-only

UTV2-1904 proof cohort (picks WHERE metadata->>'proof_issue' = 'UTV2-1904'):
  cohort picks                                    -> 2
  cohort picks still status='validated'           -> 2
  pick_lifecycle rows for the cohort              -> 2   (both null -> validated)
  pick_lifecycle rows WHERE to_state='settled'    -> 0
  distribution_outbox rows, EVERY status          -> 0
  settlement_records rows for the cohort          -> 1

settlement_records for the refusal-path pick      -> 0
distribution_outbox, table-wide                   -> 0
```

The pick stayed `validated` — `validated -> settled` is not a legal FSM edge, and the path writes no
lifecycle event. The outbox count is the directive's *"prove zero delivery"*, measured in the
database and across every status rather than inferred from the recap guard.

The last line is recorded because it was measured, not because the movement is attributed: that
table-wide counter read **22** when the pre-run baseline was taken and reads **0** now. Nothing in
this lane deletes outbox rows, and staging is a shared CI database that other suites truncate. The
load-bearing claim is the cohort-scoped **0** — a statement about rows this lane's own picks did or
did not produce — not the table total.

**The refusal row is the control.** Without it, the success assertion would pass equally well against
an implementation that never required `operatorGradingContext` at all.

Production `zfzdnfwdarxucxtaojxm` was not written to by any part of this lane.

## Dependency record

**Command Center follow-up — owed, and not in this lane.**
`apps/command-center/src/app/actions/settle.ts` posts `status`, `result`, `source: 'operator'`,
`confidence`, `evidenceRef` and `settledBy`, and **no `operatorGradingContext`**. After this lands,
a Command Center settlement of a Track Only pick is refused with `OPERATOR_GRADING_CONTEXT_REQUIRED`.

**This is not a regression.** Today the same click is refused with `SETTLEMENT_NOT_ALLOWED`, because
the pick is not `posted`. The refusal changes identity, not existence.

Callers needing the context threaded through: `components/SettlementForm.tsx:50`,
`components/InlineSettleButton.tsx:39`, `components/CorrectionForm.tsx:44`.

It is not in this lane because `apps/command-center/**` is admitted by exactly one lane type —
`delivery-ui` — whose `max_per_app` for `command-center` is 1 and is currently held by UTV2-1802 /
PR #1513; and because it is outside this lane's pinned `file_scope_lock`. Re-typing a lane to evade
a concurrency rule is the evasion this plan has already declined once. **Blocked on Griff's T1
verdict on #1513.**

**For C2 and ticket-level statistics.** A settled evidence-plane pick now carries a
`settlement_records` row whose payload holds `operatorGradingContext`, `correction: false`,
`evidencePlane: true`, `operatorSettled: true`, the pick provenance payload, the stake-integrity
payload, `profitLossUnits` for win/loss/push, and `clv: null` with an explicit
`clvUnavailableReason`. A statistics layer over this cohort can therefore distinguish an
operator-attested settlement from a graded one **by payload rather than by inference**, and can
report CLV as unavailable-by-construction rather than as missing data.

## Merge SHA Binding

Merge SHA: b14e444127d18a9e7f6091421758f2ebad604b74
PR: https://github.com/griff843/Unit-Talk-v2/pull/1579
Approved PR head: pending merge
Execution SHA: f8d8b38086f20a422b78f21dd04993e3a3e60ed9
