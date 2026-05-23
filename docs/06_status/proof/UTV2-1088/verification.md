# Verification Log: UTV2-1088

## pnpm verify

Run: 2026-05-23, worktree `claude__utv2-1088-invariant-registry-substrate`

```
pnpm verify — env:check + lint + type-check + build + test

# tests 113
# pass 113
# fail 0

verify:commands — 14 command definitions verified, 107 migrations checked, no findings.

pnpm verify: PASS (exit 0)
```

## pnpm test:db

Run: 2026-05-22, 7/7 PASS against live Supabase (`zfzdnfwdarxucxtaojxm`)

```
# tests 7
# pass 7
# fail 0
```

## invariant-registry-gate

Local run (exit 0):
```
invariant-registry-gate
  base: origin/main
  registry hash: 45cf55bf7903336ccfeeef6311028def49b7e192211fad87b9b69625784ac78b
  invariants: 15 total, 15 active
invariant-registry-gate: PASS
```

## proof-binding-validator

Local run post-rebase (exit 0):
```json
{
  "schema_version": 2,
  "gate": "proof-binding-v2",
  "issue_id": "UTV2-1088",
  "verified_source_sha": "d875ba1b251dcac22ef4c3d3a53cf5272d700f6f",
  "resolved_evidence_commit_sha": "d0d6edbf5fe92a425a0f8417e51940ce32a98750",
  "resolved_current_pr_head_sha": "d0d6edbf5fe92a425a0f8417e51940ce32a98750",
  "violations": [],
  "ok": true
}
```
