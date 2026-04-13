# Schema: executor-result/v1

> Comment schema for executor completion claims. Posted on PRs by Claude or Codex.
> Validated by `.github/workflows/executor-result-validator.yml`.
> Spec: `docs/05_operations/GOVERNED_LOOP_SPEC.md` section 2B.

## Format

```
EXECUTOR_RESULT: READY_FOR_REVIEW
schema: executor-result/v1
Issue: UTV2-###
Lane: claude | codex
Branch: claude/utv2-###-slug | codex/utv2-###-slug
PR: #NNN
Head SHA: <exact 40-char SHA of current PR head>
Proof Artifact: docs/06_status/proof/UTV2-###.md | CI only
Checklist:
- [x] <acceptance criterion 1 — verbatim from issue>
- [x] <acceptance criterion 2>
Known Gaps:
- <description, or "none">
```

## Validation Rules

1. Line 1 must be exactly `EXECUTOR_RESULT: READY_FOR_REVIEW`
2. Line 2 must be exactly `schema: executor-result/v1`
3. `Issue:` must match `UTV2-\d+`
4. `Lane:` must be `claude` or `codex`
5. `Branch:` must match `(claude|codex)/utv2-\d+-*` and equal the PR head ref
6. `PR:` must match `#\d+` and equal the PR number
7. `Head SHA:` must exactly match the current PR head SHA
8. `Proof Artifact:` must be a file path (validated by the action) or `CI only` for T3
9. `Checklist:` must have at least one item
10. `Known Gaps:` must be present

## Rejection

Invalid comments are **ignored** by the merge gate. An invalid result does NOT advance the issue. The executor must fix and re-post.

## What This Does NOT Do

This comment is a **structured claim**, not certification. The executor-result-validator independently verifies CI status, proof file existence, and SHA binding. The executor saying "done" means nothing until verified.
