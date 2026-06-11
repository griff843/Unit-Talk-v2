# UTV2-1254 — Verification

## Verification

Replay/historical validation of the evidence pipeline against the live production DB (project `zfzdnfwdarxucxtaojxm`), 2026-06-11. All runs used production code paths; no synthetic outcomes were fabricated; nothing here is certification evidence — replay/controlled-validation only.

### 1. Non-public picks flow through the evidence plane — VALIDATED

A single controlled grading pass (`npx tsx apps/api/src/grading-cron.ts`, production `runGradingPass` → `recordEvidenceSettlement`) was run from this repo against live Supabase:

- **143 evidence-plane settlements** written (`settlement_records.payload->>'evidencePlane'='true'`): 90 win / 53 loss.
- Settled picks **remained in `awaiting_approval`** (by design — evidence settlement does not transition the public-delivery lifecycle).
- No public Discord delivery occurred as a result.

```sql
select sr.result, count(*) from settlement_records sr
where sr.payload->>'evidencePlane'='true' group by 1;
-- win=90, loss=53 (plus 1 prior t1-proof row)
```

### 2. Evidence flow decoupled from public delivery — VALIDATED (with blockers found)

Outbox sends since the UTV2-1251 deploy (2026-06-11 02:50Z): `discord:canary` only. Zero public-channel sends. Public delivery plane stayed gated while evidence settlements accumulated.

```sql
select target, count(*) from distribution_outbox
where status='sent' and updated_at > '2026-06-11T02:50:00Z' group by 1;
-- discord:canary only
```

### 3. Settlement → grading path — VALIDATED

187 settlements recorded since deploy via the standing settlement path (97 win / 78 loss / 12 push), plus the 143 evidence-plane settlements above. `settlement_records` written with results; win/loss/push assignment works.

### 4. CLV join path — STRUCTURALLY VALIDATED; settlement blocked by two defects

The join (`picks → pick_candidates(pick_id) → market_universe(universe_id) WHERE closing_over_odds IS NOT NULL`, post-cutover 2026-06-07T13:38:28Z) returns **142 picks** (grew from 126 during validation — accumulation works). However settled CLV-path remains **0** because:

1. **UTV2-1257** — grading-cron has no managed runtime home; `grading.run` stopped 2026-06-08 14:03Z when an unmanaged local process died (1,823 prior runs, actor `grading-service`; `grading` absent from production docker-compose and `.env.production`).
2. **UTV2-1258** — `DatabasePickRepository.listByLifecycleState` runs unbounded → Supabase 1000-row cap, ordered `created_at ASC`: grading forever sees the 1000 **oldest** picks per lifecycle. Observed: 29 cycles each logging `attempted=2000 graded=0 skipped=2000` after the initial 143 grades; the 113 awaiting CLV-join picks never entered the window.

Gradeability of the blocked picks confirmed: their events are `completed` **and `game_results` rows exist** —

```sql
select e.status, count(*) picks, count(*) filter (where gr.id is not null) with_game_result
from picks p join pick_candidates pc on pc.pick_id=p.id
join market_universe mu on mu.id=pc.universe_id
join events e on e.id=mu.event_id
left join game_results gr on gr.event_id=e.id and gr.participant_id=p.participant_id
where mu.closing_over_odds is not null and p.created_at >= '2026-06-07T13:38:28Z'
  and p.status='awaiting_approval' group by 1;
-- completed: 1695 join-rows, all 1695 with game_result; in_progress: 14; scheduled: 27
```

Expectation (not a claim): once UTV2-1257 + UTV2-1258 ship, the next grading pass settles the eligible CLV-join picks and the UTV2-1250 metric starts moving.

### 5. Command Center visibility — VALIDATED at code/test level

- `apps/command-center/src/lib/data/queues.ts:309` queries `status.eq.awaiting_approval,approval_status.eq.pending` — suppressed/awaiting picks are a first-class governance queue, not filtered out.
- `picks-workflow.ts:102` models `awaiting_approval` as an explicit workflow state.
- Tests: `npx tsx --test apps/command-center/src/lib/server-api.test.ts apps/command-center/src/lib/data/client.test.ts` → **18/18 pass**.
- Caveat (honest gap): Command Center is not deployed on Hetzner (absent from docker-compose; local Next.js app, port 4300). Runtime rendering was not verified in production.

### Standard checks

- `pnpm type-check` — PASS (preflight PB1)
- `pnpm test` — PASS (preflight PB2)
- `pnpm test:db` — PASS against live Supabase, run from this lane worktree 2026-06-11:

```text
$ pnpm test:db
# tests 7
# pass 7
# fail 0
# cancelled 0
# skipped 0
```
- `pnpm verify` — via PR CI (binding record)
- `scripts/ci/r-level-check.ts` — via PR CI

### Guardrail compliance

No outcomes fabricated; replay/controlled-validation results not counted as certification evidence; no CLV/ROI/edge claims; no public Discord posts (canary untouched by this lane); UTV2-1042 not closed.

## Post-merge SHA binding

Merge SHA: b9f86f99fa379cd4d71f9e3b6cbc430b749c5590 (PR #1009, squash, merged on green)

- `pnpm type-check` — PASS / `pnpm test` — PASS (preflight + CI verify on branch head 4cd33f83)
- `pnpm verify` — green via required CI check on PR #1009
- `scripts/ci/r-level-check.ts` — R-Level Compliance Check ✓ PASSED on PR #1009
