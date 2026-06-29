# No Public Delivery Proof

**Date:** 2026-06-29  
**Issue:** UTV2-1359

---

## Evidence Plane Architecture

Picks from autonomous sources (`system-pick-scanner`, `model-driven`, `alert-agent`)
enter the governance brake at submission time:

```
validated → awaiting_approval   (governance brake: "non-human source X")
```

These picks are:
- **NOT** enqueued to the outbox
- **NOT** transitioned to `queued` or `posted`
- **NOT** delivered to any Discord channel (public or canary)

The grading service explicitly handles these picks for evidence accumulation:

```typescript
// apps/api/src/grading-service.ts:93-100
// Evidence plane: also process awaiting_approval picks so outcome data
// accumulates without requiring public delivery approval. Per UTV2-1253.
const [postedPicks, evidencePicks] = await Promise.all([
  fetchAllByLifecycleState(repositories.picks, 'posted'),
  fetchAllByLifecycleState(repositories.picks, 'awaiting_approval'),
]);
```

Settlement for these picks uses `recordEvidenceSettlement`, which:
- Creates a `settlement_records` row with `evidencePlane: true`
- Does NOT transition `picks.status` (stays `awaiting_approval`)
- Records CLV and ROI in the settlement payload

---

## Proof: Pick a122bcca Had No Public Delivery

**Evidence 1 — Lifecycle table (2 rows only):**
```
null → validated    (submitter, 11:10:18 UTC)
validated → awaiting_approval  (promoter, 11:10:24 UTC)
```
No `queued`, `posted`, or `settled` lifecycle transition exists.

**Evidence 2 — picks.status = 'awaiting_approval'**  
The pick's current lifecycle state is `awaiting_approval`. It was never enqueued.

**Evidence 3 — settlement_records.payload.evidencePlane = true**  
The settlement record explicitly flags this as an evidence-plane settlement.

**Evidence 4 — No outbox row**  
Distribution service throws `GovernanceBrakeError` for `awaiting_approval` picks:
```typescript
// apps/api/src/distribution-service.ts:107-108
`Distribution blocked: pick ${pickId} is in awaiting_approval lifecycle state.`
```

**Evidence 5 — No Discord API call**  
The worker only processes picks from the outbox. No outbox row → no Discord call.

---

## Why This Is Sufficient Proof

The PM directive says: "No public Discord delivery. No member-facing output."

- The pick was ingested, scored, governance-braked, evidence-graded, settled, CLV computed.
- At no point did any Discord API call occur.
- The evidence_ref links to a real game result (`game-result:493c640d`).
- The audit_log records the full chain: promotion decisions + settlement event.

---

## PM Gate Condition for Single-Pick Full Proof

To prove criterion 4 (promoted/eligible) without public delivery in a SINGLE pick,
an operator must:

1. Query current `awaiting_approval` picks with positive promotion scores
2. Select one with a qualifying event (game not yet complete)
3. Execute: `POST /api/picks/:id/review { decision: 'approve', enqueueTarget: 'discord:canary' }`
4. Wait for grading cycle
5. Query settlement record

`discord:canary` is the internal canary channel — not member-facing.

See **UTV2-1361** for the PM gate issue.
