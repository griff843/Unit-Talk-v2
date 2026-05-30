---
issue: UTV2-1134
title: INIT-4.1.3 — Exception-Gated Dead-Letter Recovery
tier: T2
executor: claude
branch: claude/utv2-1134-init-413-exception-gated-dead-letter-recovery
---

## Summary

Refactors automated dead-letter recovery to use explicit exception class gating.
Closes the gap between pattern-gated (heuristic) and exception-gated
(explicitly classified, deny-by-default) recovery authority.

## Files Changed

| File | Change |
|------|--------|
| `apps/worker/src/automated-recovery.ts` | Added `RECOVERY_EXCEPTION_CLASSES`, `classifyException()`, updated `isEligibleForAutoRecovery()`, added `recovery_exception_gated` audit events |
| `apps/worker/src/worker-automated-recovery.test.ts` | 13 new tests: classification coverage, gating audit emission, replay path |

## Design

**Exception classes (8 explicitly allowlisted):**
- `network_fetch`, `network_reset`, `connection_refused`, `timeout`, `dns_failure`
- `http_rate_limit`, `http_gateway`, `html_response`

**Deny-by-default classification:**
- `no_error` (null last_error) → denied
- `denylist` (business/lifecycle error patterns) → denied
- `unknown` (no matching class) → denied
- Named class (matches allowlist) → approved

**Replay-visible audit evidence:**
- `distribution.recovery_exception_gated` emitted for EVERY gating decision
  (approved or denied), with `decision`, `exceptionClass`, `correlationId`
- `distribution.auto_recovered` includes `exceptionClass` for reconstruction

## Constraints Satisfied

- Deny-by-default: unknown exception types fail closed
- Exception classes explicitly allowlisted — not inferred from heuristics
- Every recovery decision emits replay-visible audit evidence
- No broad worker recovery expansion beyond approved gated path
- No capital deployment, no treasury operations, no scaling runtime
