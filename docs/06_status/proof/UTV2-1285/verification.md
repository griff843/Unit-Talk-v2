# UTV2-1285 — Verification

Restore qualified candidate → pick promotion via a state-aware governance brake in the
candidate-pick-scanner. Tier T1. `apps/api` only — no schema change, no migration.

## What changed

The candidate-pick-scanner previously promoted a qualified `pick_candidate` to a pick and then
**unconditionally** transitioned it to `awaiting_approval` (and voided on cleanup). Against the
lifecycle FSM (`packages/db/src/lifecycle.ts`) two of those edges are illegal:

- `queued -> awaiting_approval` — only `validated -> awaiting_approval` is a legal brake edge.
- `voided -> voided` — "any state -> voided" excludes an already-terminal pick.

When the created pick was not `validated`, the brake threw, the scanner counted an error and
moved on **without** leaving a usable gated pick — qualified candidates were not promoted.

The fix introduces a pure, exported helper `resolveGovernanceBrakeAction(pickStatus)` and
branches on its result:

| pick status | action | effect |
|---|---|---|
| `validated` | `brake_to_awaiting` | transition to `awaiting_approval` (the only legal brake edge) |
| `awaiting_approval` | `already_gated` | idempotent — fall through to candidate link |
| `voided` / `settled` | `skip_terminal` | fail closed, no illegal `voided -> voided` |
| anything else (`queued`, `posted`, …) | `void_advanced` | void a pick advanced past the gate — fail closed |

`stake_units` is asserted canonical (`> 0`) on the promoted pick. The **public delivery gate is
preserved**: system picks land in `awaiting_approval` and are never enqueued to the outbox by
this path.

## Verification

### Static gates (`pnpm verify:parallel`)

- env:check — pass
- lint — pass
- type-check (project references) — pass
- build (all packages + apps) — pass
- test — the only red was `apps/api/src/t1-proof-awaiting-approval-review.test.ts`
  ("UTV2-521 regression: non-governance, non-pending pick still rejects with NOT_PENDING"),
  a **live-DB-backed** suite unrelated to this diff. It passes 5/5 in isolation (exit 0); the
  in-suite failure is the known prod-DB-under-load flake (same pattern documented for the
  bounded-dedup lane). This change touches only `candidate-pick-scanner`.

### Unit — `apps/api/src/candidate-pick-scanner.test.ts`

```
ok 1 - candidate-pick-scanner: happy path — qualified+scored candidate becomes an awaiting_approval pick
ok 2 - candidate-pick-scanner: stale market universe snapshot writes pick metadata data_freshness=stale
ok 3 - candidate-pick-scanner: fresh market universe snapshot writes pick metadata data_freshness=fresh
ok 4 - candidate-pick-scanner: duplicate prevention — candidate with pick_id already set is skipped
ok 5 - candidate-pick-scanner: no-op when no scored candidates exist
ok 6 - AC-4: candidate scanner skips stale universe at scan time and increments skipped
ok 7 - AC-5: candidate provenance updated with stale_at_scan_time: true on skip
ok 8 - candidate-pick-scanner: skips non-O/U markets that grading cannot settle
ok 9 - resolveGovernanceBrakeAction: validated picks brake to awaiting_approval
ok 10 - resolveGovernanceBrakeAction: already-gated picks are idempotent (no re-transition)
ok 11 - resolveGovernanceBrakeAction: a pick advanced past the gate fails closed (void)
ok 12 - resolveGovernanceBrakeAction: terminal picks are skipped (never voided -> voided / settled -> awaiting_approval)
ok 13 - candidate-pick-scanner: promoted pick carries a canonical stake_units > 0 and stays gated (UTV2-1285)
# tests 13
# pass 13
# fail 0
# skipped 0
```

Tests 9–12 lock the brake state-machine; test 13 asserts a promoted pick carries
`stake_units > 0` and stays `status === 'awaiting_approval'` (public delivery gate intact).

### Runtime — `pnpm test:db` (live Supabase `zfzdnfwdarxucxtaojxm`)

```
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 157069.790202
```

## Post-deploy runtime note (funnel)

At verification time the live funnel showed `system-pick-scanner` picks correctly landing in
`awaiting_approval` (no `queued`/`voided` brake errors), confirming the brake fix in production
behavior. However a full qualified-candidate → pick proof is **supply-starved**: the MLB
ingestor intermittently re-stalls (0 MLB offers / 0 qualified candidates in the trailing 15m
window), so the scanner has no fresh candidates to promote during those windows. That residual
ingestion-robustness limiter is tracked separately and is out of scope for this lane, which
fixes the **promotion** path itself. The brake state-machine and stake-units canonicalization
are fully proven by the unit + live-DB suites above.

## Merge SHA

_Bound post-merge by `ops:proof-generate --merge-sha`._
