# PROOF: UTV2-1427
MERGE_SHA: e2f26623563c16a701453ee476614efe2ea4c203

## Verification

## PM review round 1 — addressed

- [x] `database.types.ts` regenerated for real against an applied migration on an isolated Supabase dev branch (deleted after use) — verified byte-identical to the prior hand-authored entry.
- [x] `GET /api/discord/kill-switch` now requires `operator`-role auth (dispatch moved to after the auth gate; new test asserts 401 without auth, 200 with it).
- [x] Audit actor derived from `request.auth.identity` (trusted context), never from client-supplied body — new test asserts a spoofed body actor is not what lands in `audit_log`.
- [x] `health.ts`'s ops-alert-webhook check uses `isProductionLikeRuntime(runtime.environment)` (loaded, validated `AppEnv`), not raw `process.env`.
- [x] Confirmed no change to `best-bets`/`trader-insights` default posture in `packages/contracts/src/promotion.ts` — still deferred to a separate explicit PM approval. (Round 3 below: this claim was true for `promotion.ts` but incomplete — the kill switch's own fail-closed default on an unseeded table would have silently disabled delivery regardless of `promotion.ts`. Fixed by the bootstrap migration.)
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

## PM review round 3 — bootstrap the pre-existing production posture

The docs claimed "no change to current Discord delivery defaults," which was true for `promotion.ts`'s `enabled` flags but incomplete: the worker's kill-switch check treats a missing row as `killed=true` (fail closed), and `20260714120000_add_delivery_kill_switch.sql` seeded zero rows. Deploying this lane as-is would have silently disabled delivery for every governed target on day one — the opposite of "no change."

Fixed with a second, PR-governed migration (`20260714130000_bootstrap_delivery_kill_switch_posture.sql`) that seeds one row per governed target, derived from `packages/contracts/src/promotion.ts`'s `defaultTargetRegistry` — the canonical registry, not an assumption:

| Target | `defaultTargetRegistry.enabled` | Seeded `killed` |
|---|---|---|
| `best-bets` | `true` | `false` |
| `trader-insights` | `true` | `false` |
| `exclusive-insights` | `false` (also in `blockedDiscordTargets`) | `true` |

`actor='system-bootstrap'` on every seeded row for provenance; `ON CONFLICT (target) DO NOTHING` for idempotency and to never clobber an operator's own toggle. Down script deletes only rows matching both target AND `actor='system-bootstrap'`, so it never reverts a real operator action.

Not manually seeded and not direct-written — this migration file went through the same PR-governed path as the first: committed to this branch, reviewed via CI (`migration-reversibility-gate.yml`, `Live Schema Parity`, etc.), and applied to the live Supabase project only with the same PM sign-off pattern as the first migration.

New test — `apps/api/src/t1-proof-utv2-1427-kill-switch.test.ts`'s `"bootstrap migration preserves the pre-existing production delivery posture"` — reads (never writes) the three real governed-target rows and asserts each one's `killed` state matches what `defaultTargetRegistry` says it should be, computed live from the imported registry rather than hardcoded. This test never calls `setKilled` on a real governed target — only on the synthetic fixture target — so it cannot itself alter live delivery state.

```text
$ npx tsx --test apps/api/src/t1-proof-utv2-1427-kill-switch.test.ts
1..5
# tests 5
# suites 0
# pass 5
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Acceptance criteria from PM review round 3, all proven by the test above plus the pre-existing round-1/round-2 tests:
1. **Deployment preserves the current target posture** — the new "bootstrap migration preserves..." test, read-only against real governed targets.
2. **Operators can subsequently engage/release the switch live** — unchanged from round 2's setKilled/isKilled round-trip test (same code path, safe fixture target).
3. **Unknown targets and read failures remain killed** — unchanged from round 2's fail-closed test.

`docs/05_operations/DELIVERY_KILL_SWITCH.md` §2 and §5 updated to describe the bootstrap seed and correct the "no production-consequential default state" framing; §4 also corrected — its "GET is unauthenticated" line was stale from before round 1's auth fix and is now accurate.

## Routing note

This lane touches Tier C sensitive paths (`apps/worker/**`, `apps/api/src/auth.ts`, `packages/db/src/repositories.ts`, `packages/db/src/runtime-repositories.ts`, `supabase/migrations/**`). It was first dispatched to Codex per the PM's direct instruction, but Codex self-blocked citing `DELEGATION_POLICY.md`'s "Codex is never authorized for Tier C work" rule — confirming this really is a mechanical boundary in this codebase, not just a three-brain heuristic. Re-routed to Claude execution directly; see the UTV2-1427 Linear thread for the full routing-correction note.

## Known gaps / interim items

- `packages/db/src/database.types.ts`'s `delivery_kill_switch` entry was regenerated for real (`pnpm supabase:types`-equivalent) against an applied migration on a temporary isolated Supabase dev branch, deleted after use, and confirmed byte-identical to the prior hand-authored entry — it is no longer hand-authored or pending regeneration.
- `packages/db/src/schema.ts`'s `canonicalTables`/`canonicalSchema` catalog was not updated to include `delivery_kill_switch` (not in this lane's declared file scope; no CI check currently enforces this catalog's completeness). Recommend a fast T3 follow-up.
- `r3-shadow-report` and `qa-experience-report` artifacts were attempted but not generated cleanly in this sandbox (missing `@supabase/supabase-js` resolution for the shadow runner; QA experience ran but flagged pre-existing unrelated Discord sandbox issues). R-level verdict is PASS without them; only `r4-fault-report` (PM-gated, not required) is listed as missing.
