# Verification Log — UTV2-1087

**Issue:** INIT-1.1.4 — Freshness Honesty and Provider Auto-Quarantine
**Tier:** T1
**Executor:** claude
**Branch:** claude/utv2-1087-freshness-honesty-and-provider-auto-quarantine
**Verified at:** 2026-05-24T23:00:00Z
**SHA:** 96aceb727f968e6f0dce60ac389d31310f2e1b29

## Verification

| Check | Result |
|---|---|
| pnpm verify | PASS — env, lint, type-check, build, test, smart-form verify, command checks |
| T1 live-DB proof | PASS — 5/5 tests against live Supabase zfzdnfwdarxucxtaojxm |
| R-level | PASS — lifecycle-fsm and ingestor-provider matched; PM-gated r4-fault-report advisory |
| Adversarial (stale snapshot) | PASS — 25h-old snapshot → data_freshness: 'stale' |
| Adversarial (fresh snapshot) | PASS — 5min-old snapshot → data_freshness: 'fresh' |
| Adversarial (null snapshot) | PASS — null snapshotAt → data_freshness: 'stale' |
| Adversarial (fail-closed circuit) | PASS — CircuitOpenError thrown when circuit open |
| Adversarial (runtime quarantine) | PASS — persistent runner breaker quarantines and blocks future provider calls |
| Adversarial (scanner metadata) | PASS — runCandidatePickScan writes stale/fresh metadata end-to-end |
| Adversarial (quarantine idempotent) | PASS — second quarantine call is no-op |

## Changes

- `apps/api/src/candidate-pick-scanner.ts:212` — Gap #2: replaced `'fresh' as const` with `freshnessInfo.staleAtScanTime ? 'stale' : 'fresh'`
- `apps/ingestor/src/circuit-breaker.ts` — Gap #19: added `failClosed` option + `CircuitOpenError` class
- `apps/ingestor/src/provider-quarantine.ts` — Gap #49: new `ProviderQuarantineRegistry` with quarantine/release/listQuarantined
- `apps/ingestor/src/ingest-league.ts` — wires `quarantineRegistry` option; triggers on `CircuitOpenError`
- `apps/ingestor/src/provider-quarantine.test.ts` — 11 unit tests
- `apps/api/src/t1-proof-utv2-1087-freshness-gate.test.ts` — 5 T1 proof tests (3 adversarial + 2 live-DB)
- `apps/api/src/candidate-pick-scanner.test.ts` — end-to-end stale/fresh scanner metadata regression coverage
- `apps/ingestor/src/ingestor-runner.ts` — persistent fail-closed SGO circuit breakers and shared quarantine registry

## Sign-off

Claude (executor) — PASS

Post-merge: bind evidence_commit_sha to merge SHA before ops:truth-check.
