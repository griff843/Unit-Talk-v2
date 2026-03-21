# Week 8 Settlement Readiness Review

This file confirms that all settlement freeze rule conditions are met and Week 8 implementation is authorized to begin.

Authority:
- `docs/05_operations/settlement_planning.md`
- `docs/05_operations/week_8_settlement_runtime_contract.md`

---

## Metadata

| Field | Value |
|---|---|
| Owner | Architecture |
| Status | Ratified |
| Ratified | 2026-03-20 |
| Last Updated | 2026-03-20 |

---

## Status

**Week 8 is authorized to begin.**

Week 7 is formally closed as of 2026-03-20. All settlement freeze rule conditions are met.

---

## Settlement Freeze Rule — All Conditions Met

From `docs/05_operations/settlement_planning.md`:

| Condition | Status |
|---|---|
| Week 6 promotion gate exists and CI is hardened | **Met** — 55/55 tests pass, `pnpm test:db` green |
| All Week 6 blockers cleared | **Met** — Week 6 complete |
| `discord:best-bets` live or explicitly deferred with documented reason | **Met** — live in real channel `1288613037539852329`, Week 7 formally closed |

---

## Ready Inputs

- `docs/02_architecture/contracts/settlement_contract.md` — settlement contract authority
- `docs/05_operations/settlement_planning.md` — target week, scope, three slices, first proof definition
- Week 6 runtime gate is complete: promotion evaluation live, non-qualified picks blocked
- CI enforces `pnpm test` and `pnpm test:db`
- Canonical posted-state flow proven through live canary and real Best Bets channel
- Operator-web can read outbox, receipts, runs, and picks

---

## Week 8 Scope

Defined in full in:
- `docs/05_operations/settlement_planning.md`
- `docs/05_operations/week_8_settlement_runtime_contract.md`

| Slice | Deliverable |
|---|---|
| 1 — Schema | `settlement_records` migration, regenerated types, `types.ts` updated |
| 2 — Write Path | `POST /api/picks/:id/settle`, lifecycle `posted → settled`, audit event, unit tests |
| 3 — Read Path | Operator snapshot includes settlements, operator-web shows settled picks distinctly |

First posted-to-settled proof: settle a canary pick via the API and record evidence in `system_snapshot.md`.

---

## Live System Not to Touch During Week 8

| Component | Rule |
|---|---|
| `discord:canary` routing | Permanent — never remove |
| `discord:best-bets` routing | Live and stable — do not change target map |
| Promotion gate logic | No changes to promotion evaluation or `pick_promotion_history` |
| Distribution worker | No changes to worker delivery adapters |
| Submission path | No changes to intake or pick creation |

---

## Non-Goals for Week 8

- Automated settlement via external data feed
- Multi-outcome resolution (parlay, same-game parlay)
- Full ranking or intelligence layer
- Any new product surface beyond operator write path and operator-web visibility
- New Discord routing (game-threads, strategy-room, exclusive-insights)
- Any changes to the `discord:best-bets` routing or promotion gate

---

## Anti-Drift Note

Do not begin Week 8 runtime work from chat memory alone.
Use `docs/05_operations/settlement_planning.md` as the planning authority.
Patch `settlement_planning.md` if requirements change — do not work from a different source.

---

## Required Sync After Week 8

When Week 8 is complete:
- Update `docs/06_status/status_source_of_truth.md`: Current Week → Week 9
- Update `docs/06_status/system_snapshot.md`: add first posted-to-settled proof bundle
- Update `docs/06_status/current_phase.md`
- Update `docs/06_status/next_build_order.md`
- Update the Week 8 Linear issue to Done
- Update the Notion Week 8 Checkpoint to Done

---

## Authority Links

| Purpose | File |
|---|---|
| Settlement scope and slices | `docs/05_operations/settlement_planning.md` |
| Settlement contract | `docs/02_architecture/contracts/settlement_contract.md` |
| Program state | `docs/06_status/status_source_of_truth.md` |
| Week 7 closeout | `docs/06_status/week_7_artifact_index.md` |
| Active roadmap | `docs/04_roadmap/active_roadmap.md` |
