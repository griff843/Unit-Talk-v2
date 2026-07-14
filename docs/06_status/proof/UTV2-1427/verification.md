# PROOF: UTV2-1427
MERGE_SHA: 51e4fa069b043409876fb0998a18d8fbf9d6138f

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

## Routing note

This lane touches Tier C sensitive paths (`apps/worker/**`, `apps/api/src/auth.ts`, `packages/db/src/repositories.ts`, `packages/db/src/runtime-repositories.ts`, `supabase/migrations/**`). It was first dispatched to Codex per the PM's direct instruction, but Codex self-blocked citing `DELEGATION_POLICY.md`'s "Codex is never authorized for Tier C work" rule — confirming this really is a mechanical boundary in this codebase, not just a three-brain heuristic. Re-routed to Claude execution directly; see the UTV2-1427 Linear thread for the full routing-correction note.

## Known gaps / interim items

- `packages/db/src/database.types.ts`'s `delivery_kill_switch` entry is hand-authored (documented inline in the file) pending `pnpm supabase:types` regeneration once this migration is live in production — the shape matches the migration DDL exactly so the eventual regen is a no-op.
- `packages/db/src/schema.ts`'s `canonicalTables`/`canonicalSchema` catalog was not updated to include `delivery_kill_switch` (not in this lane's declared file scope; no CI check currently enforces this catalog's completeness). Recommend a fast T3 follow-up.
- `r3-shadow-report` and `qa-experience-report` artifacts were attempted but not generated cleanly in this sandbox (missing `@supabase/supabase-js` resolution for the shadow runner; QA experience ran but flagged pre-existing unrelated Discord sandbox issues). R-level verdict is PASS without them; only `r4-fault-report` (PM-gated, not required) is listed as missing.
