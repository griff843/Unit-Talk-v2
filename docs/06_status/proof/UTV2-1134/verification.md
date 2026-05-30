---
issue: UTV2-1134
title: INIT-4.1.3 — Exception-Gated Dead-Letter Recovery
tier: T2
---

## Verification

### pnpm verify

```
VERIFY_EXIT:0
```

All stages passed: sync-check, system-alignment, automation-coverage, env:check,
lint, type-check, build, test (pass / 0 fail), verify:commands.

### R-level check

```
Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required for this diff
```

### Exception class coverage (classifyException tests)

- `null` → `no_error` denied ✓
- unknown string → `unknown` denied ✓
- denylist match → `denylist` denied ✓
- denylist wins over allowlist ✓
- `fetch failed` → `network_fetch` approved ✓
- `ECONNRESET` → `network_reset` approved ✓
- `ETIMEDOUT` → `timeout` approved ✓
- `503 Service Unavailable` → `http_gateway` approved ✓
- `429` → `http_rate_limit` approved ✓
- `<!DOCTYPE html>` → `html_response` approved ✓

### Gating audit event tests

- Denied recovery emits `distribution.recovery_exception_gated` with `decision: denied` ✓
- Approved recovery emits `distribution.recovery_exception_gated` with `decision: approved` ✓
- `distribution.auto_recovered` includes `exceptionClass` for replay reconstruction ✓

### No scope bleed

Changes confined to:
- `apps/worker/src/automated-recovery.ts`
- `apps/worker/src/worker-automated-recovery.test.ts`

No migration, no contracts, no domain changes.
