# GP-M2: Alert-Agent Submission Wiring Contract

**Status:** RATIFIED 2026-04-03
**Linear:** UTV2-372
**Lane:** claude (contract) — codex (implementation sub-issues below)
**Tier:** T1 — touches runtime routing, pick creation, and promotion policy

---

## Context

`SYSTEM_PICK_CONTRACT.md` (UTV2-294) ratified that system picks are canonical lifecycle entities.
`ALERT_AGENT_EXTRACTION_CONTRACT.md` (UTV2-125/126) separated the alert-agent into a standalone
process. GP-M2 wires these two decisions together: alert-agent creates `picks` rows via the
canonical API submission path when a qualifying alert fires.

### Current state

- `apps/alert-agent` is a standalone process — detects line movement, sends Discord webhooks
- It creates **zero** picks rows. `source: 'alert-agent'` is registered in `PickSource` but unused.
- `apps/alert-agent/src/main.ts` still imports directly from `../../api/src/` — known violation,
  addressed separately (see §Cross-app import below).

---

## Decision: HTTP Submission Path

Alert-agent submits picks by calling `POST /api/submissions` — the same endpoint used by Smart Form
and other sources. No special fast-path, no direct DB write, no bypass.

This means:
- Full `validated → queued → posted → settled` lifecycle applies
- Promotion gate is evaluated for every alert-agent pick
- Audit trail is identical to human submissions
- The cross-app import violation is **not a blocker** for GP-M2 — the submission path is HTTP, not
  a code-level import

---

## Trigger Policy

Alert-agent creates a pick only when ALL conditions are true:

| Condition | Value |
|---|---|
| Alert tier | `alert-worthy` only — `notable` and `watch` never create picks |
| Feature gate | `SYSTEM_PICKS_ENABLED=true` (env var, default `false`) |
| Dry-run gate | `ALERT_DRY_RUN=false` (alert-agent must be in live mode) |
| Idempotency | No existing pick for this alert signal's idempotency key |

`SYSTEM_PICKS_ENABLED` defaults to `false`. Operators must explicitly enable it. This gate lives in
the alert-agent process, checked before the HTTP call is made.

---

## System Pick Payload Shape

```typescript
// Built by a new helper: buildAlertAgentSubmissionPayload(signal, event)

{
  source: 'alert-agent',
  submittedBy: 'system:alert-agent',
  market: buildMarketString(signal.marketType, event.sport),
  selection: buildSelection(signal.marketType, signal.direction, signal.participantId),
  line: signal.newLine,
  odds: undefined,           // alert signals carry line movement, not odds
  confidence: 0.65,          // alert-worthy tier baseline; not adjustable per-signal
  eventName: event.name,
  metadata: {
    alertSignalIdempotencyKey: signal.idempotencyKey,
    alertTier: signal.tier,
    lineChange: signal.lineChange,
    bookmakerKey: signal.bookmakerKey,
    marketKey: signal.marketKey,
    sport: event.sport,
  },
}
```

### Field derivation rules

**`market`** — `buildMarketString(marketType, sport)`:
- `spread` → `"${sport} Spread"`
- `total` → `"${sport} Total"`
- `moneyline` → `"${sport} Moneyline"`
- `player_prop` → `"${sport} Player Prop"`

**`selection`** — `buildSelection(marketType, direction, participantId)`:
- `total` or `player_prop`: `direction === 'up' ? 'over' : 'under'`
- `spread`: `direction === 'up' ? 'over' : 'under'` (line moved up = favor the over side)
- `moneyline`: if `participantId` resolves to a known participant name, use that name;
  otherwise `direction === 'up' ? 'favorite' : 'underdog'`

**`odds`** — omitted. Alert signals track line movement, not current odds. Downstream promotion
scoring uses `confidence` as the primary quality signal.

**`confidence`** — fixed at `0.65` for `alert-worthy` tier. Not derived per-signal. Future
refinement (e.g., velocity-adjusted confidence) is a separate contract.

---

## Promotion Policy for `source: 'alert-agent'`

Add `source: 'alert-agent'` to the confidence floor bypass list in `promotion-service.ts`,
alongside `source: 'smart-form'`.

**Rationale:** Alert-agent picks are deliberate algorithmic submissions. The confidence value
(`0.65`) is explicit and intentional — applying a floor check on top of it is redundant and would
silently suppress valid signals. This mirrors the smart-form bypass: both are sources where
`confidence` is explicitly set by the caller.

**Location:** `apps/api/src/promotion-service.ts` lines 146 and 658 (both `source === 'smart-form'`
checks). Extend to `source === 'smart-form' || source === 'alert-agent'`.

No other source-specific promotion treatment is needed at GP-M2. Default scoring profile applies.

---

## Settlement Policy

`source: 'alert-agent'` is **not blocked** in `settlement-service.ts`. Unlike `source: 'feed'`
(which has an explicit settlement block at line 68), alert-agent picks may be settled normally,
including auto-settlement from feed results.

No new conditional is needed in settlement-service. This is confirmed state, not an assumption.

---

## Idempotency

Alert-agent must not create duplicate picks for the same signal. The idempotency key is
`signal.idempotencyKey` (already computed in `alert-agent-service.ts`).

Before calling `POST /api/submissions`, alert-agent checks:
- Query `picks` via API (`GET /api/picks?metadataKey=alertSignalIdempotencyKey&value=<key>`) OR
- Store a local in-memory set of submitted idempotency keys per process run (simpler, acceptable
  since alert-agent restarts are infrequent and duplicate picks on restart are low-risk)

**Decision:** Use in-memory set per process run. A restart may submit a duplicate for the most
recent signal window, but the submission-service idempotency hash (built from source + market +
selection + line + eventName) will deduplicate at the API layer if the pick is truly identical.

---

## Cross-App Import Violation

`apps/alert-agent/src/main.ts` still imports from `../../api/src/server.js` and
`../../api/src/alert-agent.js`. This is a pre-existing known violation documented in
`ALERT_AGENT_EXTRACTION_CONTRACT.md`.

**This is NOT a blocker for GP-M2.** The submission path uses HTTP. The import violation affects
the detection/notification path, not the pick creation path.

Resolution is deferred to a separate T2 hardening issue: move `startAlertAgent` and
`alert-agent-service.ts` detection logic to `@unit-talk/db` or expose via an internal API route.
That work does not block GP-M2 and must not be bundled with it.

---

## Implementation Sub-Issues

GP-M2 implementation is broken into two Codex-safe tasks:

### Sub-issue A — Promotion policy: confidence floor bypass for `source: 'alert-agent'`

**Tier:** T2 (isolated logic change + tests)
**Allowed files:**
- `apps/api/src/promotion-service.ts`
- `apps/api/src/promotion-service.test.ts` (or add new test file)

**Acceptance criteria:**
- Both confidence floor checks (lines ~146 and ~658) updated to include `source === 'alert-agent'`
- Unit tests verify alert-agent picks bypass the floor
- `pnpm verify` green

### Sub-issue B — Alert-agent HTTP submission for `alert-worthy` signals

**Tier:** T1 (new pick creation path, feature-gated)
**Allowed files:**
- `apps/alert-agent/src/main.ts`
- `apps/alert-agent/src/alert-submission.ts` (new file)
- `apps/api/src/alert-notification-service.ts` (add pick submission call after notification)

**Acceptance criteria:**
- `SYSTEM_PICKS_ENABLED` env var read in alert-agent — defaults `false`
- `buildAlertAgentSubmissionPayload(signal, event)` implemented per spec above
- `POST /api/submissions` called for `alert-worthy` signals when gate is open
- In-memory idempotency set prevents duplicate submissions within a process run
- `ALERT_DRY_RUN=true` (default) suppresses all submissions regardless of `SYSTEM_PICKS_ENABLED`
- Unit tests for `buildAlertAgentSubmissionPayload` covering all four market types
- `pnpm verify` green
- **Does not merge without explicit PM approval (T1)**

---

## What NOT to Do

- Do not create picks rows directly (bypass `POST /api/submissions`)
- Do not add a system-pick promotion bypass — promotion gate must evaluate every pick
- Do not bundle cross-app import violation fix in GP-M2 PRs
- Do not enable `SYSTEM_PICKS_ENABLED=true` in production without a canary proof run
- Do not create picks for `notable` or `watch` tier signals

---

## Cross-References

- `docs/05_operations/SYSTEM_PICK_CONTRACT.md` — canonical lifecycle decision
- `docs/05_operations/ALERT_AGENT_EXTRACTION_CONTRACT.md` — process separation history
- `docs/05_operations/T1_ALERTAGENT_LINE_MOVEMENT_CONTRACT.md` — detection thresholds
- `packages/contracts/src/submission.ts` — `PickSource` registry
- `apps/api/src/promotion-service.ts` — source-based confidence floor conditional
- `apps/api/src/settlement-service.ts` — settlement block for `source: 'feed'` (alert-agent not blocked)
- UTV2-372 (this contract), UTV2-336 (GP-M2 implementation closure)
