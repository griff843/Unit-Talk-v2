# Verification: UTV2-1095 — INIT-1.2.4 30-Day Replay Driver

## Summary

Implemented `ReplayDriver` — a deterministic 30-day full-pipeline replay driver with zero-write isolation guarantee and divergence halting semantics.

## Verification

### What was built

**`packages/verification/src/engine/replay-driver.ts`**

- `ReplayDriver` class with configurable `windowDays` (default 30), `replayRunId` (auto-generated), and `dryRun` (default true)
- `ReplayProofBundle` output containing: window metadata, picksReplayed, divergencesFound, divergenceDetails, productionWritesAttempted, halted, haltReason, completedAt
- `ReplayPickRecord` minimal local type to avoid cross-package coupling
- Composes over `FullPipelineReplayHarness` (INIT-1.2.1) and `ReplayDivergenceEngine` (INIT-1.2.3)
- Enforces `productionWritesAttempted === 0` mechanically — throws if violated
- Any divergence → `halted: true`, `divergenceDetails` populated, returns immediately (never suppresses)
- Window computed from `new Date() - windowDays * 24 * 60 * 60 * 1000`
- No Supabase, no HTTP, no external I/O

**`packages/verification/src/engine/replay-driver.test.ts`**

10 test cases using `node:test` + `tsx --test` + `node:assert/strict`:
1. Default window is 30 days
2. Zero picks yields clean proof bundle (picksReplayed=0, divergencesFound=0, productionWritesAttempted=0)
3. One clean pick is replayed with zero divergences
4. Injected divergence halts run and populates details
5. productionWritesAttempted is always 0 even with picks
6. Custom windowDays reflected in proof bundle
7. replayRunId auto-generated when not provided
8. replayRunId used when explicitly provided
9. completedAt set to valid ISO-8601 string
10. Multiple picks all counted in picksReplayed

**`packages/verification/src/engine/index.ts`**

Added exports for `ReplayDriver`, `ReplayDriverOptions`, `ReplayProofBundle`, `ReplayPickRecord`.

### Static verification

| Check | Result |
|---|---|
| `pnpm lint` | PASS |
| `pnpm type-check` | PASS |
| `pnpm build` | PASS |
| `tsx --test replay-driver.test.ts` | 10/10 PASS |
| `pnpm verify` | PASS (all checks green) |
| R-level check | PASS — no R-level artifacts required |

### Runtime verification

| Check | Result |
|---|---|
| `pnpm test:db` | 7/7 PASS — Supabase `zfzdnfwdarxucxtaojxm` |

### Invariant audit

- `productionWritesAttempted` is enforced at proof-bundle assembly — any non-zero value halts and throws
- Divergence engine `hasDivergence()` → `halted: true` — no suppression code path exists
- `dryRun` defaults to `true` (fail-closed) — production writes are mechanically prevented by `IsolatedReplayStore`
- No cross-package boundary violations — only relative imports within `packages/verification/src/`

### Source SHA

Branch HEAD: `fa634d5166286f7f339e0951d05252d547f5b07d`
Merge SHA: set-by-CI after merge to main.
