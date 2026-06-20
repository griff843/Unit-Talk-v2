# UTV2-1285 — Diff Summary

**Lane:** Restore qualified candidate → pick promotion (state-aware governance brake)
**Branch:** `griffadavi/utv2-1285-restore-candidate-pick-promotion`
**Tier:** T1
**Scope:** `apps/api` only. No schema change, no migration, no new package.
**Merge SHA:** `eaf4b3ecf2df0c5af558a20f75d280128287cc9b` (PR #1034, squash-merged to `main` 2026-06-20)
**merge_sha:** eaf4b3ecf2df0c5af558a20f75d280128287cc9b

## Problem

The candidate-pick-scanner promoted a qualified `pick_candidate` into a pick, then
**unconditionally** applied the Phase 7A governance brake by transitioning the freshly
created pick to `awaiting_approval` and, on the cleanup path, voiding it. Two of those
transitions were invalid against the lifecycle FSM (`packages/db/src/lifecycle.ts`):

- `queued -> awaiting_approval` — only `validated -> awaiting_approval` is a legal brake edge.
- `voided -> voided` — "any state -> voided" excludes a pick already terminal.

When the created pick was not in `validated` state the brake threw, the scanner counted an
error and moved on **without** leaving a usable gated pick — qualified candidates were not
reliably promoted. Separately, `stake_units` was not guaranteed canonical (`> 0`).

## Change

### `apps/api/src/candidate-pick-scanner.ts`

- New exported pure helper `resolveGovernanceBrakeAction(pickStatus)` returning one of
  `brake_to_awaiting | already_gated | void_advanced | skip_terminal`:
  - `validated` → `brake_to_awaiting` (the only legal brake edge)
  - `awaiting_approval` → `already_gated` (idempotent; fall through to candidate link)
  - `voided | settled` → `skip_terminal` (fail closed without an illegal `voided->voided`)
  - any other (e.g. `queued`, `posted`) → `void_advanced` (a pick advanced past the gate is
    voided — fail closed, public delivery never reached)
- Capture the created pick's status (`pickStatus`) and branch the brake on the resolved
  action instead of always transitioning then voiding. Brake/void failures still increment
  `errors` and `continue`, but no longer attempt illegal transitions.
- The public delivery gate is preserved: system picks that brake land in `awaiting_approval`
  and are never enqueued to the outbox by this path.

### `apps/api/src/candidate-pick-scanner.test.ts`

- Import `resolveGovernanceBrakeAction`; add 4 unit assertions for the helper (one per action).
- Add a `scanSingleCandidatePick`-based integration test asserting a promoted pick carries a
  canonical `stake_units > 0` and stays `status === 'awaiting_approval'` (gated).

## Why this is correct & fail-closed

- No pick is left un-gated: `validated` brakes to `awaiting_approval`; anything already at or
  past the gate is either treated as already-gated or voided — public delivery is never the
  fallback.
- No illegal FSM transition is attempted, so the scanner stops self-inflicting errors that
  previously aborted promotion.
- Guardrails honored: no public Discord enablement, no scoring/freshness threshold changes,
  no migration, no production evidence mutation outside the normal pick-creation flow.

## Files changed

| File | +/- |
|---|---|
| `apps/api/src/candidate-pick-scanner.ts` | +76 / −19 |
| `apps/api/src/candidate-pick-scanner.test.ts` | +46 / −1 |
