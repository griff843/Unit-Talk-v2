# Verification Results — SPRINT-CONSTITUTIONAL-CONVERGENCE-002

> 2026-06-02 · HEAD branch `chore/constitution-restoration-001`. All commands run live this sprint.

## Verification — commands & results

| Command | Exit | Result |
|---|---:|---|
| `pnpm constitution:check` | **0** | PASS — **9/9** required files, 19/19 capability layers, SHA `b22b6e5b…` matches pin |
| (adversarial) hide `CANONICAL_PROGRAM_STATE.md` | **1** | FAILS CLOSED — `FAIL: Missing required constitutional artifact` |
| `pnpm type-check` | **0** | PASS (`tsc -b` clean) |
| `pnpm lint` | **0** | PASS (eslint, exit 0) |
| `pnpm verify` | **0** | **PASS** — env:check + lint + type-check + build + test + verify:commands all green |

### `pnpm verify` detail (exit 0)
- Full chain completed: `env:check` → `lint` → `type-check` → `build` → `test` → `verify:commands`.
- Test run: **113 tests pass, 0 fail** (final suite), all prior suites green.
- `command-manifest:check`: 14 command definitions verified.
- `check-migration-versions`: 117 migrations, no duplicate versions.
- `lint-migrations`: 117 migrations, no findings.

**No "pre-existing unrelated failure" needed to be recorded — `pnpm verify` fully passed.** (The unrelated working-tree changes to `scripts/deploy-check.*` and deploy configs did not break verify and are excluded from the commit.)

## `git status --short` (sprint scope)
**Committed in this sprint (constitution-002):**
- Modified: `docs/00_constitution/{README,CONSTITUTIONAL_DRIFT_AUDIT,PROGRAM_ALIGNMENT_MATRIX}.md`, `docs/02_architecture/CONSTITUTIONAL_LINEAR_EXECUTION_STRUCTURE.md`, `docs/06_status/CERT_BOARD.md`, `docs/06_status/decisions/M10_PATH_A_DECISION.md`, `docs/06_status/programs/PROGRAM_{2,3}_CERTIFICATION.md`, `docs/06_status/programs/PROGRAM_5_ACTIVATION.md`, `docs/06_status/proof/SPRINT-CONSTITUTION-RESTORATION-AND-RATIFICATION-001/{executive-summary,next-actions}.md`, `scripts/constitution-check.ts`
- New: `docs/00_constitution/{CANONICAL_PROGRAM_STATE,CERTIFICATION_GAP_REGISTER,CONSTITUTIONAL_CONVERGENCE_BACKLOG_PLAN}.md`, `docs/06_status/proof/SPRINT-CONSTITUTIONAL-CONVERGENCE-002/` (8 files)

**Excluded (pre-existing/unrelated — NOT this sprint):** `.github/workflows/deploy.yml`, `staging-deploy.yml`, `deploy/production/*`, `scripts/deploy-check.*`, `scripts/backup/production-backup.sh`, `docs/06_status/lanes/UTV2-1150.json`, `docs/06_status/proof/UTV2-1150/evidence.json`, `docs/06_status/proof/R10-FEATURE-WIRING-TRUTH-AUDIT/`, `docs/06_status/proof/SCORING-ENGINE-TRUTH-AUDIT/`, `docs/06_status/readiness/`.

## Compliance assertions
- ✅ **No runtime behavior changed** (docs + tsx guard + one package.json line only — unchanged since 001).
- ✅ **No certification status advanced** — P3/P4/P5 explicitly NOT certified; P1/P2 cert unchanged.
- ✅ **P5 remains FROZEN_NOT_CERTIFIED.**
- ✅ **No Linear issues created.**
