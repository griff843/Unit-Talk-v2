# UTV2-1288 — Verification

**Lane:** UTV2-1288 — harden ingestor startup chain against transient Supabase outages
**Tier:** T1 · **Lane type:** runtime · **Executor:** Claude
**Merge status:** **HELD** (PM directive 2026-06-22) — local/offline proof complete now during the
active Supabase degradation; the live-DB runtime proof (`pnpm test:db`) and full T1 evidence bundle
are completed pre-merge once Supabase is stable and `verify`/`test:db` can be trusted.

## Summary

The pre-loop ingestor startup chain in `apps/ingestor/src/index.ts` (SGO-key resolution → `reapStaleRuns`
→ `runIngestorCycles`) was a bare promise chain whose only failure handler set `process.exitCode = 1`.
During a transient Supabase outage `reapStaleRuns` threw, the process exited, and `restart: unless-stopped`
recreated it instantly — a tight crash-restart loop (observed `RestartCount=109` in ~10h, only 3 watchdog
exits). This lane extends UTV2-1284's resilient-loop principle to the startup chain: each pre-loop step
logs + marks telemetry + continues into the already-resilient cycle loop on a transient failure, with
bounded exponential backoff and startup-phase heartbeats so a slow/retrying startup never looks wedged
to the watchdog.

## Evidence (offline / local — Supabase-independent)

### Unit test — `apps/ingestor/src/startup-resilience.test.ts` (deterministic, injected sleep, no DB)
```
ok 1 - UTV2-1288: a startup step that always fails never throws — returns ok:false
ok 2 - UTV2-1288: a transient failure that then heals returns the recovered value
ok 3 - UTV2-1288: a healthy step succeeds on the first attempt with no retries
ok 4 - UTV2-1288: onRetry reports the backoff delay so callers can stamp progress
ok 5 - UTV2-1288: backoff is exponential and capped at maxDelayMs
ok 6 - UTV2-1288: maxAttempts is clamped to at least one attempt
# tests 6
# pass 6
# fail 0
# skipped 0
```

### Static / build (worktree, offline)
```
pnpm type-check  → exit 0  (project-references build clean; fixed 2 LogValue optional-field errors)
pnpm lint        → exit 0
pnpm build       → exit 0
```

These prove the resilience contract directly: the startup-step runner **never throws**, retries with
bounded exponential backoff, recovers when the dependency heals, and surfaces backoff metadata for the
startup heartbeat — which is exactly the crash-loop failure mode, exercised deterministically without
needing a live Supabase outage.

## Verification — runtime proof (PENDING, required before merge)

Per PM directive the lane is held until Supabase stabilizes. Before the `t1-approved` label / merge:
- [ ] `pnpm test:db` PASS against live Supabase (trustworthy, non-degraded window)
- [ ] `pnpm verify` PASS end-to-end on the branch
- [ ] Full T1 evidence bundle (`evidence.json`) with `sha_binding` to the merge SHA
- [ ] Runtime observation: restart count stabilizes after deploy

This file will be updated with the live-DB TAP block and the bundle SHA-bound at that point. The T1
runtime-proof CI gates are expected to remain red until then — that correctly reflects the held state;
no `test:db` output is fabricated here.

## Guardrails
No public Discord enablement. No auto-approval. No P3 certification. No loosened scoring/freshness
thresholds. No secrets printed. Watchdog/healthcheck preserved (the fix keeps the last-resort fail-closed
exit for genuine programming errors in `runIngestorCycles`).

---

# PROOF: UTV2-1288
MERGE_SHA: d29a4289

ASSERTIONS:
- [x] `runStartupStepWithRetry` (apps/ingestor/src/startup-resilience.ts) never throws/exits — returns `{ ok:false }` on exhausted failure so the daemon continues into the resilient cycle loop.
- [x] Bounded exponential backoff with cap; `onRetry` surfaces backoff metadata to stamp startup heartbeats; 6/6 deterministic offline unit tests pass.
- [x] index.ts startup chain (SGO-key resolution + reapStaleRuns) wrapped so transient Supabase failures log+telemetry+continue instead of `process.exitCode=1` crash-loop.
- [x] type-check / lint / build all PASS offline.
- [ ] RUNTIME PROOF PENDING: `pnpm test:db` + full evidence bundle, held until Supabase is stable (PM directive).

EVIDENCE:
```text
$ pnpm exec tsx --test apps/ingestor/src/startup-resilience.test.ts
# tests 6  # pass 6  # fail 0  # skipped 0
$ pnpm type-check  → exit 0
$ pnpm lint        → exit 0
$ pnpm build       → exit 0
# pnpm test:db     → PENDING (Supabase degraded; held per PM directive)
```
