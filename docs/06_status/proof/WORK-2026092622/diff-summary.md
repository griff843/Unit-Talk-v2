# Diff summary: WORK-2026092622

| File | Change |
|---|---|
| `scripts/ops/preflight.ts` | Adds `isRepoOwnedWorkId`, `readCommittedWorkOrder` (reads HEAD only) and `runRepoOwnedWorkChecks` (PL1–PL4 answered from the work order). `runLinearChecks` routes a `WORK-###` identity there before any credential lookup. Extracts `checkMechanicalFloor` (PE2) and `runManifestOwnershipChecks` (PL5/PL6) unchanged, so both paths share them. `isLaneRegistryPath` accepts `WORK-###` sync files and manifests. |
| `scripts/ops/preflight.test.ts` | 12 new tests for the WORK path. The registry test now checks behaviour, not the regex's source text. |
| `scripts/ops/execution-packet.ts` | `fetchLinearTaskSource` refuses a `WORK-###` identity before curl runs. |
| `scripts/ops/execution-packet.test.ts` | 1 new test: a WORK identity makes no curl call; a UTV2 identity still does. |
| `.ops/work/WORK-2026092622.md` | This lane's work order. |
| `.ops/work/WORK-20260924*.md`, `WORK-2026092501-2503`, `2602`, `2605-2608`, `2620` (10 files) | Committed byte-for-byte from the root checkout, where they were untracked and failed PG2. |

## SHA Binding

Merge SHA: 0f5d48322fd494c967da694a7ce44991104a0232
PR: https://github.com/griff843/Unit-Talk-v2/pull/1663
Execution SHA: 063620c2dcd005396d4aa8ae6ecf2a213ae32f03
