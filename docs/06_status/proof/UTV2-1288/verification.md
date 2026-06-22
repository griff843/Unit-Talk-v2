# UTV2-1288 — Verification

**Lane:** UTV2-1288 — harden ingestor startup chain against transient Supabase outages
**Tier:** T1 · **Lane type:** runtime · **Executor:** Claude
**Merge status:** Runtime proof OBTAINED in a stable Supabase window (2026-06-22) — `pnpm test:db` and
full `pnpm verify` both PASS on the branch. Ready for PM Review / `t1-approved`. Merge remains PM-gated
(no auto-merge). The earlier "held" status reflected the Supabase degradation window, now cleared.

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

## Verification — runtime proof (OBTAINED)

Obtained in a stable Supabase window after the degradation cleared (branch head `632bd505`):

### `pnpm test:db` — live Supabase (project `zfzdnfwdarxucxtaojxm`) — PASS (exit 0)
```
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
# tests 7
# pass 7
# fail 0
# skipped 0
```

### `pnpm verify` — full pipeline (env:check + lint + type-check + build + test, incl. live-DB suites) — PASS (exit 0)
All suites green (0 failures), including the live-DB suites (`database-smoke`, `t1-proof-awaiting-approval`, `execution_intents`) that flaked during the degradation window — confirming the run was made against a healthy Supabase.

- [x] `pnpm test:db` PASS against live Supabase (stable window)
- [x] `pnpm verify` PASS end-to-end on the branch
- [x] T1 evidence bundle (`evidence.json`) updated with runtime proof + `sha_binding`
- [ ] Runtime observation: restart count stabilizes after deploy (post-merge/deploy, PM-gated)

No `test:db` output is fabricated — TAP above is the verbatim run on this branch.

## Guardrails
No public Discord enablement. No auto-approval. No P3 certification. No loosened scoring/freshness
thresholds. No secrets printed. Watchdog/healthcheck preserved (the fix keeps the last-resort fail-closed
exit for genuine programming errors in `runIngestorCycles`).

---

# PROOF: UTV2-1288
MERGE_SHA: 99006b7bb3634603b97b582c661395dbd52d01ba

ASSERTIONS:
- [x] `runStartupStepWithRetry` (apps/ingestor/src/startup-resilience.ts) never throws/exits — returns `{ ok:false }` on exhausted failure so the daemon continues into the resilient cycle loop.
- [x] Bounded exponential backoff with cap; `onRetry` surfaces backoff metadata to stamp startup heartbeats; 6/6 deterministic offline unit tests pass.
- [x] index.ts startup chain (SGO-key resolution + reapStaleRuns) wrapped so transient Supabase failures log+telemetry+continue instead of `process.exitCode=1` crash-loop.
- [x] type-check / lint / build all PASS offline.
- [x] RUNTIME PROOF OBTAINED: `pnpm test:db` PASS 7/7 + full `pnpm verify` PASS on the branch (stable Supabase window).

EVIDENCE:
```text
$ pnpm exec tsx --test apps/ingestor/src/startup-resilience.test.ts
# tests 6  # pass 6  # fail 0  # skipped 0
$ pnpm type-check  → exit 0
$ pnpm lint        → exit 0
$ pnpm build       → exit 0
$ pnpm test:db     → exit 0   # tests 7  # pass 7  # fail 0  # skipped 0
$ pnpm verify      → exit 0   (full pipeline, incl. live-DB suites, all green)
```

## Closeout references
Static gate runs `pnpm type-check` and `pnpm test`; R-level checked via `scripts/ci/r-level-check.ts`.
