# DIFF SUMMARY: UTV2-1949

MERGE_SHA: pending merge

Execution SHA: 14d88b67d3bd74a54c18607d3c92466184c1d70b
Lane type: hygiene
Tier: T2

## New files (3)

| File | Purpose |
|---|---|
| `scripts/ops/temp-workspace.ts` | `createTempWorkspace()` / `releaseTempWorkspace()` / `cleanupTempWorkspaces()`. Creates a temp directory and releases it on process exit, so a *failing* test releases its inodes too. Tracks only directories it created; `releaseTempWorkspace()` is a no-op on any other path, so it cannot be used as an arbitrary-path remover. |
| `scripts/ops/temp-workspace.test.ts` | 5 tests, including a behaviour drill that spawns a child process which throws after creating a workspace and asserts the directory is gone. |
| `scripts/ci/temp-workspace-cleanup-guard.test.ts` | Mechanical guard over `scripts/**` and `apps/**` `*.test.ts`. Fails when a test file creates a temp directory with no way to release it. |

## Modified files (18)

44 call sites of the form `fs.mkdtempSync(path.join(os.tmpdir(), 'prefix-'))` were
replaced with `createTempWorkspace('prefix-')`, and the imports that became unused
were removed. No test logic, assertion or fixture was changed.

| File | Sites |
|---|---|
| `scripts/ops/lane-start.test.ts` | 9 |
| `scripts/edge-fallback-report/run-edge-fallback-report.test.ts` | 7 |
| `scripts/ci/ops-api-diagnose-workflow.test.ts` | 4 |
| `scripts/audits/utv2-1382-scoring-validation.test.ts` | 4 |
| `scripts/ops/proof-check.test.ts` | 3 |
| `scripts/ci/nextjs-deploy-wiring.test.ts` | 3 |
| `scripts/ut-cli/ut-cli.test.ts` | 2 |
| `scripts/proof-check.test.ts` | 2 |
| `scripts/ci/ops-p0-containment-workflow.test.ts` | 2 |
| `scripts/ops/delegation-state.test.ts` | 1 |
| `scripts/ops/executable-wiring.test.ts` | 1 |
| `scripts/ops/update-record.test.ts` | 1 |
| `scripts/ops/automation-coverage-check.test.ts` | 1 |
| `scripts/ops/system-alignment-check.test.ts` | 1 |
| `scripts/ops/proof-repair.test.ts` | 1 |
| `scripts/ci/direct-main-push-guard.test.ts` | 1 |
| `scripts/ci/workflow-production-credential-guard.test.ts` | 1 |
| `apps/ingestor/src/provider-offer-replay.test.ts` | 2 — `t.after()` cleanup instead of the helper, to avoid importing from `scripts/` inside an app |

## Not changed

- No `/tmp` sweeping, scanning or pattern-matched deletion anywhere.
- No production code, no migration, no workflow, no containment setting, no delivery path.
- No test assertion, fixture or expectation.
