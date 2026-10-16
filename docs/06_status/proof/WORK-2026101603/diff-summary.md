# Diff summary: WORK-2026101603

Pre-proof hook accepts the canonical post-merge v2 SHA binding. Local commit hook and its tests only.

| File | Change |
|---|---|
| `.claude/hooks/pre-proof-validator.sh` | Evidence check accepts non-empty ci_sentinels OR the canonical post-merge v2 binding; all other checks unchanged. |
| `scripts/ops/proof-check.test.ts` | Three tests: canonical binding accepted; nine incomplete or forged bindings blocked; acceptance clause mutation test. |
| `.ops/work/WORK-2026101603.md` | Repo-owned work order. |

## SHA Binding

Verified source SHA: `dec9bfc7b9a92f5ac9435c8a5103b32353db1f98`
Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1764
