# Migration And Cutover Plan

## Legacy Reference

- Legacy repo: `C:\dev\unit-talk-production`
- V2 repo: `C:\dev\unit-talk-v2`

## Rules

- Legacy code is inspected, not trusted by default.
- Reused logic must be logged with old path, new path, keep or rewrite decision, and rationale.
- Cutover requires shadow validation and explicit rollback notes.
