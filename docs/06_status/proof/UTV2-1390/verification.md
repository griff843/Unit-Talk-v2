# UTV2-1390 — Workflow Reset Governance Update

## Verification

This file is the T1 verification record for UTV2-1390 (Sonnet-5-era operating model governance update).

## Metadata

| Field | Value |
|---|---|
| Issue ID | UTV2-1390 |
| Tier | T1 |
| Phase / Gate | Governance-doc implementation |
| Owner | claude/utv2-1390 |
| Date | 2026-07-01 |
| Verifier Identity | claude/utv2-1390-workflow-reset-sonnet5-operating-model |
| Commit SHA(s) | `d18ea8531e5a9a1a11f637f084983c6e14e791ba` (pre-implementation branch base; updated when PR opens) |
| Related PRs | (filled on open) |

## Scope

**Claims:**
- Removes `claude-fable-5` from all active routing/validators/docs (`three-brain.md`, `dispatch.md`, `agent-role-contracts.md`, `AGENT_SKILL_CONTRACTS.md`, `contract-validator.ts`, model routing memory)
- Confirms `three-brain.md` Rule 9 escalation list is complete and unmodified (no narrowing)
- Adds `docs/05_operations/OPERATING_MODEL_SONNET5.md` defining Outcome Contract as planning-artifact-only, its relationship to lane manifest fields, escalation-on-divergence, runtime-validation-by-tier, and the cutover clause
- No implementation/runtime code changed — governance-doc lane only
- `pnpm verify` green; `pnpm test:db` PASS (live Supabase, evidence below)

**Does NOT claim:**
- Any change to lane-close/preflight/proof-generate mechanics themselves (a real consolidated preflight script is called out as a required follow-up, not delivered in this lane)
- Any change to CONCURRENCY_CONFIG.json or executor caps
- Retroactive application to lanes already open before this PR merges

## Assertions

| # | Assertion | Evidence Type | Result |
|---|---|---|---|
| 1 | `claude-fable-5` removed from `scripts/ops/contract-validator.ts` VALID_MODELS | repo-truth | PASS |
| 2 | `claude-fable-5` removed from `docs/governance/AGENT_SKILL_CONTRACTS.md` ClaudeModel union | repo-truth | PASS |
| 3 | `claude-fable-5` removed from `docs/05_operations/agent-role-contracts.md` model ID lists | repo-truth | PASS |
| 4 | Fable 5 trigger checklist (F1-F8) and all Fable references removed from `three-brain.md` | repo-truth | PASS |
| 5 | Fable references removed from `dispatch.md`; Sonnet 5 is default T1 planning model | repo-truth | PASS |
| 6 | `three-brain.md` Rule 9 escalation list unchanged / complete (16 conditions) | repo-truth | PASS |
| 7 | `docs/05_operations/OPERATING_MODEL_SONNET5.md` exists and defines all 5 required sections | repo-truth | PASS |
| 8 | pnpm verify green | repo-truth | PASS |
| 9 | pnpm test:db green (live Supabase, 7/7 pass) | test | PASS |

## Evidence Blocks

### E9 pnpm test:db

**Test evidence**
Command: `pnpm test:db` (live Supabase `zfzdnfwdarxucxtaojxm`)
Output (tail):
```
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 105183.075732
```
All 7 assertions passed: DB connectivity, picks write path, participants no-duplicate constraint, settlement correction chain. This is a governance-doc lane with no runtime code changes; test:db is included per T1 tier policy, not because this lane touches the DB write path.

## Stop Conditions Encountered

None.

## Sign-off

**Verifier:** claude/utv2-1390-workflow-reset-sonnet5-operating-model — 2026-07-01
**PM acceptance:** pending

## Merge SHA Binding

(Filled post-merge by post-merge-lane-close.yml)
