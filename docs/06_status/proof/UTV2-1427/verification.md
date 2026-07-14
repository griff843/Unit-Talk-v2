# PROOF: UTV2-1427
MERGE_SHA: e2f26623563c16a701453ee476614efe2ea4c203

## Verification

## PM review round 1 — addressed

- [x] `database.types.ts` regenerated for real against an applied migration on an isolated Supabase dev branch (deleted after use) — verified byte-identical to the prior hand-authored entry.
- [x] `GET /api/discord/kill-switch` now requires `operator`-role auth (dispatch moved to after the auth gate; new test asserts 401 without auth, 200 with it).
- [x] Audit actor derived from `request.auth.identity` (trusted context), never from client-supplied body — new test asserts a spoofed body actor is not what lands in `audit_log`.
- [x] `health.ts`'s ops-alert-webhook check uses `isProductionLikeRuntime(runtime.environment)` (loaded, validated `AppEnv`), not raw `process.env`.
- [x] Confirmed no change to `best-bets`/`trader-insights` default posture in `packages/contracts/src/promotion.ts` — still deferred to a separate explicit PM approval.
- [x] `pnpm verify` and `pnpm test:db` green after all fixes.

ASSERTIONS:
- [x] Live, DB-backed kill switch checked by the worker before every dequeue, distinct from the enabled/rolloutPct registry
- [x] Fail-closed: unknown target or read error defaults to killed=true (`InMemoryDeliveryKillSwitchRepository`/`DatabaseDeliveryKillSwitchRepository`)
- [x] Staff-authorized (`operator` role only, reusing `apps/api/src/auth.ts` ROUTE_ROLES pattern)
- [x] Auditable (every toggle writes an `audit_log` row: `discord_kill_switch.engaged`/`.released`)
- [x] Reversible: killed target leaves outbox rows `pending`, release resumes delivery with no replay step
- [x] Visible in Command Center (`KillSwitchPanel` on `/operations/discord`)
- [x] Ops alert webhook now fails loud (health check degrades to 503) when unset in a production-like environment
- [x] Does NOT flip `best-bets`/`trader-insights` default posture — that one production-consequential action is explicitly deferred to the T1 merge verdict (see `DELIVERY_KILL_SWITCH.md` §5)
- [x] `pnpm verify`, `pnpm test`, `pnpm test:db` all green
- [x] R-level check PASS (lifecycle-fsm + operator-ui rules matched, no blocking artifacts missing beyond PM-gated r4)

EVIDENCE:
```text
$ pnpm type-check
(no errors)

$ pnpm test
# tests: all pass, including 3 new kill-switch tests in worker-runtime.test.ts
#   - runWorkerCycles skips a killed governed target — outbox row stays pending
#   - runWorkerCycles processes normally once the kill switch is released
#   - an unknown target with no kill-switch row is treated as killed (fail closed)
# and 4 new route tests in apps/api/src/routes/kill-switch.test.ts

$ pnpm test:db
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 22
Rules matched: lifecycle-fsm, operator-ui
Advisory (PM-gated) artifacts missing:
  - r4-fault-report [PM-gated]
```

## PM review round 2 — live-DB proof

`pnpm test:db` runs a generic smoke test (`apps/api/src/database-smoke.test.ts`)
that never touched `delivery_kill_switch` specifically — the table's live
behavior was unproven. Fixing "Require live-DB proof for runtime changes"
required writing a genuine live-DB proof (`apps/api/src/t1-proof-utv2-1427-kill-switch.test.ts`),
which surfaced that `20260714120000_add_delivery_kill_switch.sql` had only ever
been applied to a temporary, since-deleted dev branch (used earlier for type
generation) — never to the persistent Supabase project. With PM sign-off, the
migration was applied directly to the live project (`zfzdnfwdarxucxtaojxm`);
`database.types.ts` was regenerated against the live schema and is unchanged
(byte-identical to the branch-generated version already in this diff).

```text
$ npx tsx --test apps/api/src/t1-proof-utv2-1427-kill-switch.test.ts
1..4
# tests 4
# suites 0
# pass 4
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

- [x] `setKilled` persists to real Postgres; `isKilled` reads the persisted state back
- [x] `setKilled` upserts on `target` (one row per target, not one insert per call)
- [x] `isKilled` fails closed (returns `true`) for a target with no row, against the real database
- [x] `listAll` surfaces the row with correct field mapping (`actor`, `killed`, `updatedAt`)

## Routing note

This lane touches Tier C sensitive paths (`apps/worker/**`, `apps/api/src/auth.ts`, `packages/db/src/repositories.ts`, `packages/db/src/runtime-repositories.ts`, `supabase/migrations/**`). It was first dispatched to Codex per the PM's direct instruction, but Codex self-blocked citing `DELEGATION_POLICY.md`'s "Codex is never authorized for Tier C work" rule — confirming this really is a mechanical boundary in this codebase, not just a three-brain heuristic. Re-routed to Claude execution directly; see the UTV2-1427 Linear thread for the full routing-correction note.

## Known gaps / interim items

- `packages/db/src/database.types.ts`'s `delivery_kill_switch` entry was regenerated for real (`pnpm supabase:types`-equivalent) against an applied migration on a temporary isolated Supabase dev branch, deleted after use, and confirmed byte-identical to the prior hand-authored entry — it is no longer hand-authored or pending regeneration.
- `packages/db/src/schema.ts`'s `canonicalTables`/`canonicalSchema` catalog was not updated to include `delivery_kill_switch` (not in this lane's declared file scope; no CI check currently enforces this catalog's completeness). Recommend a fast T3 follow-up.
- `r3-shadow-report` and `qa-experience-report` artifacts were attempted but not generated cleanly in this sandbox (missing `@supabase/supabase-js` resolution for the shadow runner; QA experience ran but flagged pre-existing unrelated Discord sandbox issues). R-level verdict is PASS without them; only `r4-fault-report` (PM-gated, not required) is listed as missing.
