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
  "verified_source_sha": "3df415ac802c3e3479b0ed5779d3abbf1cff6df8",
  "resolved_evidence_commit_sha": "(resolved by CI from git log)",
  "resolved_current_pr_head_sha": "(resolved by CI from GITHUB_SHA)",
  "violations": [],
  "ok": true
}
```

## Verification

All required T1 artifacts present and passing:

- `pnpm verify` PASS (lint + type-check + build + test, 113/113)
- `pnpm test:db` PASS (7/7 against live Supabase `zfzdnfwdarxucxtaojxm`)
- `invariant-registry-gate` PASS (15 active invariants, registry hash bound)
- `proof-binding-validator` PASS (schema v2, verified_source_sha ancestor check passes)
- `id-ledger.json` present (15 entries, no duplicate IDs)
