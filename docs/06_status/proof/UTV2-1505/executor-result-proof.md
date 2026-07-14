# PROOF: UTV2-1505
MERGE_SHA: 7b509ffc00ab54be052e53e971d158dbb11c7ed3

ASSERTIONS:
- [x] Define role, scope, and independence — PASS (charter defines an independent QA/red-team role that never implements or approves, only tests against contracts/specs)
- [x] Define when QA review is required — PASS
- [x] Define relationship to PM/Claude/Codex/Fable/Sonnet — PASS
- [x] Include fixture/fallback contamination checks — PASS (blocked-environment states recorded as blocked, not pass; missing evidence never inferred as pass)
- [x] No implementation unless PM approves — PASS (docs-only charter, no code/workflow changes)

EVIDENCE:
```text
pnpm type-check
  PASS

pnpm test
  PASS

pnpm verify
  PASS (initial run and post-rebase rerun both green)

npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
  Verdict: PASS — Rules matched: (none)
```

NOTES:
Docs-only charter lane (docs/05_operations/QA_RED_TEAM_AGENT_CHARTER.md), no code,
workflow, or runtime path touched.
