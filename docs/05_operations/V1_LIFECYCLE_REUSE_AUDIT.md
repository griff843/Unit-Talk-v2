# V1 Lifecycle Logic Reuse Audit

**Status:** Ratified 2026-03-31
**Issue:** UTV2-24
**Authority:** Migration reference — informs future porting decisions

---

## Summary

V1 has mature lifecycle infrastructure that V2 has not yet ported. V2's simpler model is working but lacks several production-grade safety mechanisms. This audit classifies each V1 component as PORT, ENHANCE, or SKIP.

---

## Porting Decisions

### PORT — High value, V2 lacks equivalent

| Component | V1 File | What it does | V2 gap | Effort |
|-----------|---------|-------------|--------|--------|
| **Transition validator** | `lib/lifecycle/transition-validator.ts` | Enforces allowed state transitions, validates timestamp/state invariants | V2 has minimal transition checks in `lifecycle.ts` | Medium |
| **Idempotency (atomic claims)** | `lib/lifecycle/idempotency.ts` | `atomicClaimForPost()` / `atomicClaimForSettle()` — conditional DB update prevents double-posting/settling | V2 has no atomic claim guards | Medium |
| **Writer authority** | `lib/lifecycle/writer-authority.ts` | Per-field authority map — only specific roles can write specific fields | V2 has single-writer by convention, not enforcement | Medium |
| **Structured error hierarchy** | `lib/lifecycle/errors.ts` | Typed errors with machine-readable codes, HTTP status mapping, autopilot freeze | V2 has basic error handling | Low |

### ENHANCE — V2 has basic version, V1 has richer features

| Component | V1 advantage | V2 current state | Enhancement |
|-----------|-------------|-----------------|-------------|
| **Settlement lifecycle** | Explicit dispute/void paths, settlement freezing | Basic win/loss/push settlement | Add `DISPUTED` path, settlement freeze flag |
| **Promotion policy** | Band classification (HARD/SOFT/NONE), constitutional gates, probability validation | Weighted composite scoring (different by design) | V2 model is intentionally different — `KNOWN_DIV`. Consider probability gates as enhancement. |
| **Retry/circuit breaker** | `RetryPolicy` with exponential backoff, `enhanced-circuit-breaker.ts` | V2 has circuit breaker in worker + ingestor | Extend retry patterns to grading/settlement services |

### SKIP — V2 has better approach or not needed

| Component | Reason to skip |
|-----------|---------------|
| **Lifecycle FSM states** | V2's 6-state model (draft/validated/queued/posted/settled/voided) is simpler and working. V1's 10-state model adds complexity without clear V2 benefit. |
| **Scheduler patterns** | V2 uses `setInterval` + `system_runs` (simple, working). V1's custom scheduler adds no value. |
| **Write adapter** | Migration adapter — V2 is greenfield, no schema migration needed. |
| **Feature snapshot integrity** | Advanced model versioning — defer until model retraining is implemented. |
| **Canary router** | V2 now has rollout controls (UTV2-154) with deterministic hash sampling — superior to V1's canary router. |

### DEFER — Valuable but not urgent

| Component | When to revisit |
|-----------|----------------|
| **Dead letter queue** | If transient failures become frequent in production |
| **Single-writer gate** | If concurrency issues arise with multiple API instances |
| **Parlay atomicity** | When V2 implements multi-leg ticket support |

---

## Recommended Porting Order

**Phase 1 — Safety foundation (next milestone):**
1. Transition validator — enforce FSM strictly
2. Idempotency (atomic claims) — prevent double-posting/settling
3. Writer authority — single-writer enforcement

**Phase 2 — Quality gates:**
4. Structured error hierarchy — typed codes + autopilot freeze
5. Settlement dispute/void paths — operator resolution workflow

**Phase 3 — Resilience:**
6. Retry policy in service layer — grading/settlement services
7. Enhanced circuit breaker — extend existing patterns

---

## Key V1 Patterns Worth Understanding

**Atomic claim pattern** (most reusable):
```sql
-- Conditional update: only succeeds if not already claimed
UPDATE unified_picks SET posted_to_discord = true
WHERE id = $1 AND posted_to_discord = false
RETURNING id;
-- Empty result = already claimed (idempotent)
```

**Constitutional gates** (design principle):
V1 marks some promotion gates as "constitutional" — they cannot be disabled even in production. This is a fail-closed design that protects brand quality. V2 should adopt this principle for critical gates.

**Derived lifecycle stage** (anti-pattern to avoid):
V1 derives lifecycle stage from multiple fields (`status`, `promotion_status`, `settlement_status`) rather than storing it explicitly. This is fragile. V2's explicit `status` column is better.

---

## Files to Reference

| Purpose | V1 Path |
|---------|---------|
| State machine types | `apps/api/src/lib/lifecycle/types.ts` |
| Transition validator | `apps/api/src/lib/lifecycle/transition-validator.ts` |
| Idempotency guards | `apps/api/src/lib/lifecycle/idempotency.ts` |
| Writer authority | `apps/api/src/lib/lifecycle/writer-authority.ts` |
| Error hierarchy | `apps/api/src/lib/lifecycle/errors.ts` |
| Promotion policy | `apps/api/src/agents/GradingAgent/scoring/promotionPolicy.ts` |
| Enhanced circuit breaker | `apps/api/src/services/enhanced-circuit-breaker.ts` |
