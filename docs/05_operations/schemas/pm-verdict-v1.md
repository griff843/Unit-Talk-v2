# Schema: pm-verdict/v1

> Comment schema for PM review verdicts. Posted on PRs by authorized human PM.
> Validated by `.github/workflows/merge-gate.yml`.
> Spec: `docs/05_operations/GOVERNED_LOOP_SPEC.md` section 2C.

## Format: APPROVED

```
PM_VERDICT: APPROVED
schema: pm-verdict/v1
Issue: UTV2-###

Checks:
- [x] Scope aligned with issue
- [x] Acceptance criteria met
- [x] CI green on head SHA
- [x] Proof artifacts present and SHA-bound
- [x] No governance drift
- [x] No out-of-scope changes
```

## Format: CHANGES_REQUIRED

```
PM_VERDICT: CHANGES_REQUIRED
schema: pm-verdict/v1
Issue: UTV2-###
Bounce: 1 | 2

Required Changes:
1. <specific, actionable change with file path>
2. <specific, actionable change with file path>

Next Steps:
1. <concrete action>
2. Re-post executor result when fixed
```

## Validation Rules

1. Line 1 must match `PM_VERDICT: (APPROVED|CHANGES_REQUIRED)`
2. Line 2 must be exactly `schema: pm-verdict/v1`
3. `Issue:` must match `UTV2-\d+`
4. Author must be in `.github/CODEOWNERS` (currently: `griff843`)
5. Author must NOT be a bot account
6. If `CHANGES_REQUIRED`: `Bounce:` field required with numeric value

## Authorization

Only comments from CODEOWNERS members are valid verdicts. Bot-generated verdicts, comments from unknown users, and comments with schema mismatches are silently ignored by the merge gate.

## Bounce Limit

Maximum 2 bounces (CHANGES_REQUIRED cycles). On bounce 3, the issue moves to `Failed` with labels `needs-reframe` + `pm-triage`. PM must re-scope, close, or reassign.
