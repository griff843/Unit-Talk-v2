# Incident — `INC-2026-04-10-utv2-519-awaiting-approval-constraint-gap`

## Header

| Field | Value |
|---|---|
| Incident ID | `INC-2026-04-10-utv2-519-awaiting-approval-constraint-gap` |
| Title | `awaiting_approval` lifecycle CHECK constraint gap + non-atomic `transitionPickLifecycle` |
| Severity | High |
| Status | Resolved |
| Detected | 2026-04-10 (UTV2-494 Phase 7A proof runs) |
| Resolved | 2026-04-11T00:26:53Z (UTV2-519 merged) |
| Primary Linear | [UTV2-519 — P7A-04 Corrective: awaiting_approval lifecycle event constraint + atomic transition](https://linear.app/unit-talk-v2/issue/UTV2-519/) |
| Related issues | UTV2-486 (Phase 7A parent), UTV2-491 (P7A-01 lifecycle state migration — root cause origin), UTV2-492 (P7A-02 submit-pick controller tests, held in review), UTV2-509 (P7A-03a review-pick controller tests, held in review), UTV2-494 (Phase 7A proof bundle — was blocked) |
| Fix PR | https://github.com/griff843/Unit-Talk-v2/pull/223 |
| Fix commit | UTV2-494 Phase 7A proof re-run recorded in commit `556bfea` on branch `utv2-494-phase7a-evidence-bundle` (6/6 assertions PASS post-fix) |
| Owner | Claude lane (governance / schema) |

## Timeline

All times UTC.

- 2026-04-10T21:07:59Z — UTV2-519 created after UTV2-494 Lane A and Lane C proof runs failed against live Supabase project `feownrheeefbcsehtsiw`.
- 2026-04-10 — Lane A (`apps/api/src/scripts/utv2-494-phase7a-proof-a-brake.ts`) reported 0/3 brake sources passing. Lane C (`apps/api/src/scripts/utv2-494-phase7a-proof-c-review.ts`) reported 0/4.
- 2026-04-10 — Root cause isolated: `pick_lifecycle_to_state_check` did not include `'awaiting_approval'`, so the second write in `transitionPickLifecycle` was rejected after the first write (on `picks.status`) had already committed.
- 2026-04-11T00:26:53Z — UTV2-519 marked Done; PR #223 merged with the DDL fix, atomic RPC wrapper, lifecycle rollback test, and `pnpm test:db` brake coverage.
- Post-merge — UTV2-494 proof bundle re-run, 6/6 assertions PASS (see commit `556bfea`, `docs/06_status/UTV2-494-PHASE7A-EVIDENCE-BUNDLE.md`).

## Detection Path

Surfaced exclusively by UTV2-494 Phase 7A proof runs against live Supabase, not by any unit test suite:

- `apps/api/src/scripts/utv2-494-phase7a-proof-a-brake.ts` — Lane A brake-source proof. Submitted picks with `source` in `{system-pick-scanner, alert-agent, model-driven}` and asserted they landed in `awaiting_approval`. FAIL, 0/3 sources.
- `apps/api/src/scripts/utv2-494-phase7a-proof-c-review.ts` — Lane C review-controller proof. FAIL, 0/4 cases.
- Both scripts were reproducible against Supabase project ref `feownrheeefbcsehtsiw`.

InMemory-based unit tests (UTV2-492 `submit-pick-controller.test.ts`, UTV2-509 `review-pick-controller.test.ts`) were GREEN throughout because InMemory repositories do not enforce Postgres CHECK constraints — see the Policy / Control Failure section below.

## Impact

- **Governance brake non-functional against production Postgres** for all three brake sources defined in the Phase 7A brake set: `system-pick-scanner`, `alert-agent`, `model-driven`. The brake was a test-only control, not a live control, for the window between UTV2-491 and UTV2-519.
- **Stranded rows.** Because `transitionPickLifecycle` performed two sequential writes with no transaction wrapper, the `picks.status` update committed while the `pick_lifecycle` event insert was rejected by the CHECK constraint. This left `picks` rows in `awaiting_approval` with no corresponding lifecycle event and no audit row. Remediation was inventory-only under UTV2-519 scope — actual row cleanup was deferred to PM approval.
- **Phase 7A proof bundle (UTV2-494) blocked** until the fix merged.
- **UTV2-492 and UTV2-509 held in In Review** pending runtime-truth acceptance.

## Root Cause

UTV2-491 added `'awaiting_approval'` as a valid value to the `picks_status_check` CHECK constraint on the `picks` table, but did NOT update the sibling CHECK constraint `pick_lifecycle_to_state_check` on the `pick_lifecycle` events table. The `to_state` column of `pick_lifecycle` therefore did not allow `'awaiting_approval'` as a target.

The governance brake path, reached via `submit-pick-controller` for any brake-source pick, called `transitionPickLifecycle(..., 'awaiting_approval')` in `packages/db/src/lifecycle.ts`. That function:

1. UPDATE `picks` SET `status = 'awaiting_approval'` — **accepted** by the `picks` CHECK.
2. INSERT into `pick_lifecycle` with `to_state = 'awaiting_approval'` — **rejected** by the `pick_lifecycle_to_state_check`.

The two writes were sequential, not wrapped in a transaction or an atomic RPC, so step 1 stayed committed after step 2 failed. The audit row was also never written because it depended on step 2 succeeding. End state: structurally inconsistent database — stranded `awaiting_approval` rows with no lifecycle chain and no audit trail.

## Policy / Control Failure

Three governance controls failed to catch this before it reached live Postgres:

1. **Migration scope rule gap.** No repo rule required T1 migrations that add a new enum/CHECK value to enumerate every sibling CHECK constraint on referencing tables. UTV2-491 updated one CHECK and stopped.
2. **InMemory-vs-Database test coverage drift.** `submit-pick-controller.test.ts` (UTV2-492) and `review-pick-controller.test.ts` (UTV2-509) ran under InMemory repositories. InMemory repositories do not enforce Postgres CHECK constraints, so they happily accepted the `awaiting_approval` transition that live Postgres rejected. This drift is already a known risk called out in `packages/db/CLAUDE.md`, but no `pnpm test:db` case existed for the brake-source path.
3. **Atomicity violation in a state-machine transition.** `transitionPickLifecycle` performed a multi-row logical transition as two sequential writes with no transaction wrapper. Any write failure after the first step leaves the state machine in a partially-applied state. This is an architectural bug, not a migration bug — it amplified the migration miss into stranded-row corruption instead of a clean rollback.

The net effect is that the Phase 7A governance brake had never actually been exercised against real Postgres before the UTV2-494 proof run. It passed InMemory tests and was declared "live" on that basis alone.

## Remediation

Shipped by UTV2-519, merged as PR #223:

- **New migration** dropping and re-adding `pick_lifecycle_to_state_check` with `'awaiting_approval'` included in the allow-list, matching the `picks_status_check` allow-list introduced in UTV2-491.
- **Atomic RPC wrapper** — `transitionPickLifecycle` in `packages/db/src/lifecycle.ts` was rewritten to call a Postgres RPC that performs the status update, lifecycle event insert, and audit write inside a single transaction. If the lifecycle event insert fails, the status update rolls back.
- **Rollback-path unit coverage** — `lifecycle.test.ts` now covers the atomic rollback case: a forced lifecycle-insert failure must leave `picks.status` unchanged.
- **`pnpm test:db` brake-path proof case** — new coverage that submits one pick per brake source (`system-pick-scanner`, `alert-agent`, `model-driven`) against live Supabase and asserts:
  - `picks.status = 'awaiting_approval'`
  - a matching `pick_lifecycle` event exists
  - zero `distribution_outbox` rows for the pick
  - a `pick.governance_brake.applied` audit row exists
- **Stranded-row inventory** — scripted inventory of `awaiting_approval` rows with no matching lifecycle event, delivered with cleanup options. **Cleanup was NOT executed** — row mutation on historical state requires explicit PM approval and is tracked outside this incident.

Post-merge, UTV2-494 re-ran the Phase 7A proof bundle end-to-end: 6/6 assertions PASS against `feownrheeefbcsehtsiw`. See commit `556bfea` on branch `utv2-494-phase7a-evidence-bundle`.

## Follow-Up Issues

| Linear | Title | Status |
|---|---|---|
| UTV2-494 | Phase 7A proof/evidence bundle | Re-ran post-fix, 6/6 PASS (commit `556bfea`) |
| UTV2-491 | P7A-01 lifecycle state migration | Done — origin of the CHECK-constraint gap |
| UTV2-492 | P7A-02 submit-pick-controller tests | In Review pending runtime-truth acceptance |
| UTV2-509 | P7A-03a review-pick-controller tests | In Review pending runtime-truth acceptance |
| UTV2-486 | Phase 7A parent | Tracks overall phase state |

## Prevention / Lessons / New Controls

1. **T1 enum/CHECK constraint migrations must enumerate ALL sibling CHECK constraints on referencing tables in the same migration.** Any migration that adds a new enum or CHECK value to a column referenced (via FK, lifecycle, or state-machine chaining) by another table's CHECK constraint is incomplete until the sibling is updated in the same atomic deploy.
2. **State-machine transitions must be atomic.** Any multi-row logical transition (status write + event write + audit write) must be wrapped in an atomic Postgres RPC or transaction. Sequential writes without rollback-on-failure are banned for lifecycle mutations.
3. **`pnpm test:db` coverage is required for every new governance control path before the control is declared live.** InMemory repositories do not enforce CHECK constraints. A brake or gate proven only against InMemory is not proven.
4. **A governance brake is not "live" until a live-DB proof run confirms it.** Unit tests are necessary but insufficient for fail-closed controls.

## Linked Evidence / Proof Bundles

- `apps/api/src/scripts/utv2-494-phase7a-proof-a-brake.ts` — Lane A brake-source proof script (initial FAIL, post-fix PASS)
- `apps/api/src/scripts/utv2-494-phase7a-proof-c-review.ts` — Lane C review-controller proof script (initial FAIL, post-fix PASS)
- `docs/06_status/UTV2-494-PHASE7A-EVIDENCE-BUNDLE.md` — Phase 7A evidence bundle, 6/6 assertions PASS (added in commit `556bfea` on branch `utv2-494-phase7a-evidence-bundle`)
- [PR #223 — UTV2-519 corrective fix](https://github.com/griff843/Unit-Talk-v2/pull/223)
- [Linear UTV2-519](https://linear.app/unit-talk-v2/issue/UTV2-519/)
