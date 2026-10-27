# Diff summary: WORK-2026102601

| File | Change |
|---|---|
| `.claude/settings.json` | Adds a `permissions` block (`deny`, `ask`). The `hooks` block is unchanged. |
| `scripts/ci/direct-main-push-guard.test.ts` | Appends static regression tests for the permission rules (host file already run by `test:ops`; avoids a `package.json` singleton change). |
| `.ops/work/WORK-2026102601.md` | Work order. |

Defense in depth only. No hook, CI, branch-protection, merge-requirement, credential or CLAUDE.md change.

## SHA Binding

Merge SHA: pending merge
PR: pending
