# Week 9 — Full Lifecycle Proof and Anti-Drift Cleanup

## Metadata

| Field | Value |
|---|---|
| Owner | Architecture |
| Status | Ratified |
| Ratified | 2026-03-20 |
| Last Updated | 2026-03-20 |

---

## Objective

Prove that all V2 components work as an integrated system on the live Supabase database by executing and independently verifying one complete, unbroken lifecycle from raw submission through settlement.

Every component that has been built independently must now close the loop together:
submission intake → pick creation → lifecycle enforcement → promotion evaluation → Best Bets routing → outbox delivery → receipt recording → settlement write → audit recording → operator-visible final truth.

No new runtime features are implemented during Week 9. The objective is proof, verification, and a bounded cleanup pass.

---

## Entry Criteria (All Met)

| Condition | Status |
|---|---|
| Week 8 formally closed | Done — 2026-03-20 |
| Settlement write path live (`POST /api/picks/:id/settle`) | Done |
| First posted→settled proof already captured | Done |
| `discord:best-bets` live and stable | Done |
| `discord:canary` active (permanent control lane) | Done |
| `pnpm test` passing | Done |
| `pnpm test:db` passing | Done |

---

## In-Scope

### 1. Full Lifecycle Proof Run

Execute one pick end-to-end through all V2 stages in the live environment:

1. Submit via the normal runtime path (smart-form or API submission endpoint)
2. Approve and promote pick to `promotion_status = qualified`, `promotion_target = best-bets`
3. Route pick through `discord:best-bets` worker path
4. Confirm: outbox row `sent`, receipt recorded with real Discord message ID
5. Settle pick via `POST /api/picks/:id/settle`
6. Confirm: settlement record created, lifecycle transitions to `settled`, audit event emitted
7. Confirm: operator-web shows the pick in settled state with settlement data visible

Capture all proof fields defined in the proof template.

### 2. Independent Verification

Verify every proof field independently via Supabase PostgREST REST API (service_role_key — not the API response, not the worker log):

- submission record exists
- pick record exists with correct promotion state
- promotion history row exists
- outbox row is `sent` targeting `discord:best-bets`
- receipt exists with correct channel and Discord message ID
- all four lifecycle events exist: validated → queued → posted → settled
- settlement record exists with correct result, source, and status
- audit log entries exist for: promotion.qualified, distribution.sent, settlement.recorded
- original outbox and receipt are unmodified after settlement
- operator snapshot shows final `settled` state
- zero failed/dead_letter outbox rows at close

### 3. Anti-Drift Cleanup Pass

After the proof run, complete a bounded cleanup pass:

- Review and annotate any pre-Week 6 historical outbox rows that may add noise to operator incident triage
- Confirm governance docs listed in `docs/05_operations/docs_authority_map.md` are current and consistent with runtime reality
- Confirm all authority links in `docs/06_status/status_source_of_truth.md` resolve to actual files
- Confirm `docs/04_roadmap/active_roadmap.md` reflects the true completed sequence
- Confirm `docs/06_status/system_snapshot.md` reflects current runtime reality

The cleanup pass is bounded: no schema migrations, no new API routes, no UI changes. Documentation and status file accuracy only.

### 4. Readiness Decision

After the proof and cleanup are complete, write the readiness decision in `docs/05_operations/week_9_readiness_decision.md`:

- What is the verified system state
- What may proceed next
- What remains explicitly blocked
- What conditions must be met before any expansion

---

## Non-Goals

The following are explicitly out of scope for Week 9:

- No new Discord channel routing (`discord:trader-insights`, `discord:exclusive-insights`, `discord:game-threads`, `discord:strategy-room`)
- No changes to `discord:best-bets` target map or promotion gate
- No new API routes or schema migrations
- No smart-form or operator-web feature additions
- No automated settlement feed
- No multi-outcome settlement logic
- No new product surfaces of any kind
- No Week 10 implementation work
- No scope expansion of any kind during the proof run or cleanup pass

---

## Proof Fields

All of the following must be captured and independently verified:

| Stage | Field |
|---|---|
| Submission | submission ID |
| Submission | submission event ID |
| Pick creation | pick ID |
| Approval | approval status (`approved`) |
| Promotion | promotion history ID |
| Promotion | promotion score |
| Promotion | promotion status (`qualified`) |
| Promotion | promotion target (`best-bets`) |
| Routing | outbox ID |
| Routing | outbox target (`discord:best-bets`) |
| Delivery | outbox status (`sent`) |
| Delivery | posted lifecycle event ID |
| Receipt | receipt ID |
| Receipt | Discord message ID |
| Receipt | target channel ID (`1288613037539852329`) |
| Settlement | settlement record ID |
| Settlement | settlement result |
| Settlement | settlement source |
| Settlement | settled lifecycle event ID |
| Audit | audit action IDs (promotion.qualified, distribution.sent, settlement.recorded) |
| Operator | operator snapshot timestamp |
| Operator | final pick lifecycle state (`settled`) |
| Operator | worker health |

---

## Execution Checklist

### Pre-Run Checks

- [ ] `pnpm type-check` green
- [ ] `pnpm build` green
- [ ] `pnpm test` green
- [ ] `pnpm test:db` green
- [ ] operator snapshot: worker health `healthy`, zero failed outbox rows
- [ ] `discord:canary` recent sent rows present, no failures
- [ ] `discord:best-bets` no `failed` or `dead_letter` rows

### Proof Run Steps (in order)

- [ ] Submit pick via normal runtime path
- [ ] Confirm submission record created
- [ ] Approve pick (`approval_status = approved`)
- [ ] Promote pick (`promotion_status = qualified`, `promotion_target = best-bets`)
- [ ] Confirm promotion history row created
- [ ] Pick routes through worker to `discord:best-bets`
- [ ] Confirm outbox row `sent`
- [ ] Confirm receipt recorded with real Discord message ID `1288613037539852329`
- [ ] Settle pick via `POST /api/picks/:id/settle`
- [ ] Confirm settlement record created
- [ ] Confirm lifecycle is `settled`
- [ ] Confirm audit entry `settlement.recorded` exists
- [ ] Confirm operator-web shows pick as `settled` with settlement data

### Independent Verification (after proof run)

- [ ] Verify all 23 proof fields from live DB via REST API
- [ ] Verify lifecycle chain: validated → queued → posted → settled
- [ ] Verify three audit entries: promotion.qualified, distribution.sent, settlement.recorded
- [ ] Verify original outbox and receipt rows unmodified after settlement
- [ ] Verify zero failed/dead_letter outbox rows

### Anti-Drift Cleanup

- [ ] Review historical noisy outbox rows — annotate or mark as pre-Week 6 baseline
- [ ] Confirm all authority links in `status_source_of_truth.md` resolve to real files
- [ ] Confirm `active_roadmap.md` reflects true completed sequence
- [ ] Confirm `system_snapshot.md` reflects current runtime reality
- [ ] Confirm all governance docs are current

### Readiness Decision

- [ ] Write `docs/05_operations/week_9_readiness_decision.md`
- [ ] Record verified system state
- [ ] Record what may proceed and under what conditions
- [ ] Record what remains blocked

### External Tracking

- [ ] Update `docs/06_status/status_source_of_truth.md`
- [ ] Update `docs/06_status/system_snapshot.md`
- [ ] Update `docs/06_status/current_phase.md`
- [ ] Update `docs/04_roadmap/active_roadmap.md`
- [ ] Create Linear Week 9 issue and mark Done
- [ ] Create Notion Week 9 checkpoint and mark Done

---

## Close Criteria

Week 9 is complete only when all of the following are true:

1. One full pick lifecycle completes end-to-end: submission → approval → promotion → Best Bets outbox sent → receipt recorded → settlement recorded → lifecycle `settled`
2. All 23 proof fields are captured and independently verified from the live DB
3. All three audit entries confirmed: `promotion.qualified`, `distribution.sent`, `settlement.recorded`
4. Original distribution artifacts (outbox, receipt) confirmed unmodified after settlement
5. Zero failed/dead_letter outbox rows at close
6. Anti-drift cleanup pass complete
7. Readiness decision recorded in `docs/05_operations/week_9_readiness_decision.md`
8. `docs/06_status/system_snapshot.md` updated with proof bundle
9. Linear Week 9 issue marked Done
10. Notion Week 9 checkpoint marked Done

---

## Failure Conditions

Use `docs/06_status/week_9_failure_note_template.md` if any of the following occur:

- Lifecycle chain breaks at any stage
- Outbox row enters `failed` or `dead_letter`
- Settlement write returns an error or creates incomplete record
- Audit entries are missing
- Original outbox or receipt row is mutated during settlement
- Independent verification finds a mismatch between any proof field and live DB state
- Worker health becomes `degraded` or `down` during proof run

Program kill conditions remain binding: see `docs/06_status/status_source_of_truth.md`.

---

## What May Start After Week 9

Determined by the readiness decision in `docs/05_operations/week_9_readiness_decision.md`.

Nothing begins without explicit ratification in that document.

Candidates for post-Week-9 consideration (not authorized by this contract):
- `discord:trader-insights` expansion (if canary and best-bets remain healthy and operator visibility is confirmed sufficient)
- `discord:exclusive-insights` expansion (same conditions)
- Automated settlement feed (requires separate contract, feed reliability proof, and idempotency design)

What is NOT a candidate regardless of proof outcome:
- `discord:game-threads` — thread routing not implemented; architectural gap
- `discord:strategy-room` — DM routing not implemented; architectural gap
- Any new product surface without a written and ratified contract

---

## Authority Links

| Purpose | File |
|---|---|
| Full lifecycle proof template | `docs/06_status/week_9_full_lifecycle_proof_template.md` |
| Failure note template | `docs/06_status/week_9_failure_note_template.md` |
| Readiness decision | `docs/05_operations/week_9_readiness_decision.md` |
| Program state | `docs/06_status/status_source_of_truth.md` |
| Evidence record | `docs/06_status/system_snapshot.md` |
| Settlement contract | `docs/02_architecture/contracts/settlement_contract.md` |
| Best Bets channel contract | `docs/03_product/best_bets_channel_contract.md` |
| Discord routing policy | `docs/05_operations/discord_routing.md` |
