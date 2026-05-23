# Verification Log: UTV2-1083

## pnpm verify

Run: 2026-05-23, worktree `claude__utv2-1083-reversible-migration-capability`

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

## migration-reversibility-gate

Local run (exit 0 — zero new migrations, gate is the deliverable):
```
migration-reversibility-gate: no new migrations — PASS
```

## Adversarial fixtures (scripts/ci/migration-reversibility-gate.test.ts)

```
ok 1 - F1: missing down script — gate FAILS with exit 1
ok 2 - F2: comment-only down script — gate FAILS with exit 1
ok 3 - F3: IRREVERSIBLE without ratification record — gate FAILS with exit 1
ok 4 - F4: unresolvable base ref — gate exits 2 (infra error, not silent pass)
ok 5 - F5: valid reversible down script — gate PASSES with exit 0
ok 6 - F6: IRREVERSIBLE with ratification record — gate PASSES with exit 0
ok 7 - F7: zero new migrations — gate PASSES with exit 0
# pass 7 / fail 0
```

## proof-binding-validator

Local run post-rebase (exit 0):
```json
{
  "schema_version": 2,
  "gate": "proof-binding-v2",
  "issue_id": "UTV2-1083",
  "verified_source_sha": "176d9dba71c5a588856e02dbcf24ca3974467aca",
  "resolved_evidence_commit_sha": "(resolved by CI from git log)",
  "resolved_current_pr_head_sha": "(resolved by CI from GITHUB_SHA)",
  "violations": [],
  "ok": true
}
```
