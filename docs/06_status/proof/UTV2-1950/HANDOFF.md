# Command Center recovery handoff

Owner requested stopping scope expansion and landing the current recovery checkpoint on main for Claude.

## Checkpoint
- Branch: codex/utv2-1950-command-center-recovery
- Head: c3da26c2b (12 commits ahead of main when handoff began)
- Worktree: /home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__utv2-1950-command-center-recovery
- Main checkout: /home/griff843/code/Unit-Talk-v2
- Full implementation/proof chronology: PLAN.md in this directory.
- Main merge/PR status: pending; update this field after actual merge.

## Delivered scope
Ordinary browser sign-in/session/actor/logout; schema-correct pick details; truthful governed/non-governed counts; complete correction-aware performance cohort; database-backed Picks search/paging; independent overview loading; no speculative navigation prefetch; operator workspace navigation; canonical delivery controls; durable per-pick/per-settlement recap provenance and explicit uncertain/legacy states; independently streaming System Health with honest request/offer/quota/time-window labels.

## Verification
- c3da26c2b: 657 Command Center unit tests, type check, selected lint and Next production build pass; 12/12 Playwright recovery cases pass.
- Local read-only production-build p95: Picks666ms, Overview1898ms, Performance874ms, Settlement1046ms, Delivery400ms, Outbox514ms; latest System Health1387ms (20 warm samples). These are local diagnostic-proxy measurements, not deployed acceptance.
- Complete pnpm verify passed on 09e128882 in run35550274115. Later browser stage failed because Next bundle was not built. c3da26c2b explicitly adds the missing build.
- Complete pnpm verify step passed on c3da26c2b; its later browser proof is still running. Authoritative run: https://github.com/griff843/Unit-Talk-v2/actions/runs/35551270130 . Inspect terminal result before claiming fully green.
- R-level check against origin/main: PASS; operator-ui; QA artifact recognized. 120 changed files.

## Runtime
- User preview http://localhost:4302/ serves .next/health-final, production build, read-only proxy54329, business API disconnected at port1.
- Preview credentials: preview / local-readonly (local diagnostic credentials only).
- NEVER rebuild .next/health-final while serving it. Build another dist directory, verify, then switch.
- Candidate4304 was stopped for handoff.
- No production deployment, ingestion activation, kill-switch changes or member delivery performed.

## Preserved unfinished Outbox slice
The adjacent outbox-pagination-pending.patch contains four files adding separate attempt/receipt paging, exact totals, stable ID tie-breaks, 8s bounds, and verified empty-page recovery for PostgREST416. Apply with git apply from a suitable new branch/worktree.
- 659 app tests, types, selected lint, coverage wiring and Next build passed.
- New delivery browser case passed (including out-of-range return links and mobile). Full browser run had11 pass/1 failure: Overview count section exceeded existing4s cold concurrent threshold. Do not increase the threshold merely to hide this. Investigate/re-measure; final full gate not run on this patch.
- Patch excluded from handoff checkpoint to avoid delaying/weakening required verification.

## Remaining launch acceptance (not done)
1. Read actual staging settlement/correction browser proof result and fix any failure. Must demonstrate persisted actor/evidence, original-row immutability, correction linkage, zero TrackOnly outbox/lifecycle settlement promotion.
2. Manual-review queues/counts currently query immutable historical manual_review records; audit resolved/superseded entries. Settlement history still needs paging.
3. Aggregate recap health and actionable legacy-missing-evidence exceptions; historical records cannot prove whether recaps posted.
4. Owner performance sample-size policy unanswered. Percentages are intentionally suppressed until a real volume gate is defined; do not invent policy. Cadence/CLV acceptance remains to audit.
5. Live source health: SGO latest stored offer June30; no recorded ingestion in last24h at Sept21; Odds API has no current offers. Healthy page rendering does not mean live feeds are operating.
6. Broad phone/action/failure-state acceptance and actual deployed performance remain. Decision/Research future labels are not evidence of built workflows.
7. Production deployment remains the owner's reserved approval after a concrete verified release. Main merge is not deployment or full readiness.

Do not mark the original full-working/full-verified goal achieved. No PM/Linear closeout was performed.
