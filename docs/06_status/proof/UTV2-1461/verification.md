# PROOF: UTV2-1461 Verification

Issue: UTV2-1461
Tier: T2
Branch: claude/utv2-1461-merge-queue-decision-packet
MERGE_SHA: 57452722868109bc00833825a32f2bd880bc57ba

Squash-merge SHA on main (implementation commits 8455c424..5bb51d58 merged via PR #1152).

## ASSERTIONS:

- [x] Packet answers all 5 required sections (availability, Design A mapping, Design B fallback, preflight/SHA-re-post impact, recommendation with rollout + rollback)
- [x] Availability check is evidenced from the live GitHub API (GraphQL `mergeQueue: null`; REST ruleset probe rejected `merge_queue` rule with HTTP 422), not assumption; probe left no residue (`GET /rulesets → []`)
- [x] Explicit recommendation present: Design B now, Design A staged behind an org-transfer PM decision
- [x] No code or workflow changes in this lane (docs + lane bookkeeping only)
- [x] `pnpm type-check` passes; r-level-check matches no rules for a docs-only diff

## Verification

Executed 2026-07-04 from the lane worktree; raw output in EVIDENCE below.

- `pnpm type-check` — PASS
- `pnpm test:db` — PASS (7/7 against live Supabase)
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS (no rules matched)
- GitHub API availability probes — executed live, transcribed in the packet §1

## EVIDENCE:

```text
pnpm type-check → PASS (tsc -b tsconfig.json, zero errors)

pnpm test:db (live Supabase, project zfzdnfwdarxucxtaojxm)
# tests 7
# pass 7
# fail 0
# skipped 0

npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
→ Verdict: PASS; Changed files: 3; no R1-R5 rules matched

gh api /repos/griff843/Unit-Talk-v2 → "private": false, owner.type "User"
gh api graphql mergeQueue(branch:"main") → null
gh api -X POST /repos/griff843/Unit-Talk-v2/rulesets (disabled probe, rules:[{type:"merge_queue"}])
→ HTTP 422 "Invalid rule 'merge_queue'"
gh api /repos/griff843/Unit-Talk-v2/rulesets → [] (no residue)
```
