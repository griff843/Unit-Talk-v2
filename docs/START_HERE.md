# START HERE — Unit Talk V2 Agent Onboarding

Read this before touching any code. Estimated time: 10 minutes.

---

## Mission

Unit Talk V2 is a **contract-first, fail-closed sports-betting pick pipeline**. It accepts picks from users, scores and promotes qualified picks, routes them to Discord, grades settled bets against game results, and provides an operator dashboard.

Claude Code is the execution orchestrator: work the Linear backlog, merge on green per tier policy, keep execution truth mechanical rather than narrative.

---

## Where to Look First (read in this order)

1. **`CLAUDE.md`** — root invariants, commands, tier policy, skill table. Read this first, every session.
2. **`docs/CODEBASE_GUIDE.md`** — monorepo structure, package DAG, tech stack, DB schema facts.
3. **`docs/05_operations/EXECUTION_MAP.md`** — master phase map, what is shipped, what is next.
4. **Relevant skill** — see Skills Quick-Reference below. Invoke before touching the relevant subsystem.
5. **`docs/05_operations/docs_authority_map.md`** — ranked doc authority; resolves conflicts between docs.

---

## 10-Minute Orientation Sequence

Run these steps at the start of every fresh session, in order.

```bash
# 1. Sync local main with remote (stale local state = false premises)
git fetch origin && git pull --ff-only origin main

# 2. Check active lanes — know what is in flight before starting anything
ls docs/06_status/lanes/*.json | xargs grep -l '"status": "in_progress"'

# 3. Surface current system state: lanes, Linear queue, runtime status
pnpm ops:brief

# 4. Re-read CLAUDE.md — invariants and tier policy may have been updated
# (The UserPromptSubmit hook auto-injects system state; invoke /system-state-loader only if data looks stale)
```

After these four steps:
- If starting a new lane: run `pnpm ops:scope-suggest --issue UTV2-###` then `ops:lane-start UTV2-###`.
- If continuing work: check the lane manifest at `docs/06_status/lanes/UTV2-###.json` for current state.
- If the board needs clearing: invoke `/loop-dispatch` or `/dispatch-board`.

---

## Dispatch Entry Point

| When | Use |
|------|-----|
| Clear the entire backlog autonomously | `/loop-dispatch` — runs `/dispatch-board` repeatedly until empty or blocked |
| Single dispatch cycle: pick top candidates | `/dispatch-board` |
| Execute one specific issue | `/dispatch UTV2-###` |
| Routing decision only (who executes?) | `/three-brain` |

---

## Skills Quick-Reference

| Skill | When to use |
|-------|-------------|
| `/dispatch-board` | Clear board — routes entire Linear backlog, one cycle |
| `/loop-dispatch` | Continuous loop — repeat dispatch-board until empty or all blocked |
| `/dispatch` | Execute a specific issue or pick top candidates (single cycle) |
| `/three-brain` | Executor routing decision for any issue (Claude / Codex / Griff) |
| `/execution-truth` | Deciding if work is Done; reconciling narrative vs artifacts |
| `/lane-management` | Starting, progressing, blocking, closing any lane |
| `/verification` | Before any merge claim or `ops:truth-check` call |
| `/code-structure` | Touching package/app boundaries, imports, or generated files |
| `/betting-domain` | Touching CanonicalPick, scoring, promotion, lifecycle, CLV, grading |
| `/outbox-worker` | Touching outbox polling, delivery adapter, retry, circuit breaker |
| `/system-state-loader` | Forced state reload after `/clear` or when hook data is stale |
| `/t1-proof` | Assembling a T1 evidence bundle |
| `/db-verify` | Live DB verification against real Supabase |
| `/systematic-debugging` | Structured debugging when a fix resists quick diagnosis |
| `/verify-pick` | Verify a specific pick end-to-end against live data |
| `/audit` | Codebase audit — coverage gaps, debt, anti-patterns |
| `/pick-lifecycle` | Pick FSM transitions, promotion pipeline, lifecycle states |
| `/operator-runbook` | Operator interventions, manual overrides, incident response |

---

## Core Invariants Checklist

Before any commit or merge, verify all 11 hold:

- [ ] 1. `main` is shipped truth. Agent claims are never authoritative.
- [ ] 2. No lane without preflight. No Done without `ops:truth-check` pass.
- [ ] 3. One issue → one lane → one branch → one PR.
- [ ] 4. Proof must tie to the merge SHA. Stale proof is invalid.
- [ ] 5. Tier label (T1/T2/T3) is required before Ready.
- [ ] 6. Lane manifest is the sole authority for active lane state.
- [ ] 7. Domain (`@unit-talk/domain`) is pure. No I/O, no DB, no HTTP, no env.
- [ ] 8. Apps own side effects. Packages never import from apps. Apps never import from apps.
- [ ] 9. Postgres outbox is the only delivery queue. Exactly one `DeliveryOutcome` per attempt.
- [ ] 10. Fail closed — never silent fallback to `qualified`, `pass`, or `done`.
- [ ] 11. If a rule can be enforced mechanically, it must not live only in prose.

---

## Common Pitfalls

These come from the project's real incident history. Avoid them.

**1. Missing preflight token before lane-start**
`ops:lane-start` requires a valid preflight token. Generate it first. Owner directory must match the branch owner (e.g., `claude/` prefix for Claude lanes).

**2. Scope bleed — file_scope_lock too narrow**
The `file_scope_lock` must list every file the lane will create (source, test, proof, any new package.json). If you create a file not in the lock, scope_bleed CI fails. Add it before lane-start via `ops:scope-suggest`.

**3. Ghost lanes block new lanes**
Merged-but-unclosed lane manifests (status still `in_progress`) block new lanes that touch the same files. Reconcile ghost lanes first: run `/lane-reconciler`, then admin-merge the closeout batch, then start the new lane.

**4. Branch rename closes the PR**
Renaming the head branch of an open PR closes it and it will not reopen. Fix: open a fresh PR from the renamed branch with the lane apparatus committed. Do not rename branches with open PRs.

**5. Stale proof fails the done-gate**
Proof must reference the merge SHA, not the branch HEAD at the time of the PR. The post-merge workflow (`post-merge-lane-close.yml`) generates the SHA-bound proof automatically. Do not self-certify Done before the workflow runs.

**6. Codex PRs open as drafts — Merge Gate never triggers**
Codex opens PRs as drafts. The Merge Gate only triggers on `ready_for_review`, `synchronize`, and `labeled` events — not `opened`/`draft`. Run `gh pr ready <PR#>` to unblock the gate after Codex finishes.

**7. Cross-issue references in commit messages**
PR title, body, and commit messages must not mention other `UTV2-###` IDs. Write "the backfill lane" instead of `UTV2-1234`. Cross-issue refs fail branch-discipline CI.

---

## Verification Policy by Tier

| Tier | Verification required | Proof | Merge authority |
|------|-----------------------|-------|-----------------|
| T1 | type-check + test + test:db + runtime proof | Evidence bundle v1, SHA-tied | PM `t1-approved` label |
| T2 | type-check + test + issue-specific checks | Diff summary + verification log | Orchestrator on green |
| T3 | type-check + test | Green CI on merge SHA | Orchestrator on green |

`pnpm verify:quick` is sufficient for pre-commit checks. `pnpm verify` is required before merge. `pnpm test:db` is required for T1 only.

---

## Authoritative Documents Table

| Document | Answers |
|----------|---------|
| `CLAUDE.md` | Mission, commands, invariants, tier policy, skills list |
| `docs/CODEBASE_GUIDE.md` | Monorepo layout, package DAG, tech stack, DB schema facts |
| `docs/05_operations/EXECUTION_MAP.md` | Master phase map (phases 1–8), what is shipped, what is next |
| `docs/05_operations/MODELING_SEQUENCE.md` | Elite-core / human-like-core modeling sequence |
| `docs/05_operations/WORKFLOW_SPEC.md` | Three-lane workflow spec |
| `docs/05_operations/EXECUTION_TRUTH_MODEL.md` | Full truth hierarchy; resolves "what is real" disputes |
| `docs/05_operations/TRUTH_CHECK_SPEC.md` | Done-gate contract; what `ops:truth-check` checks |
| `docs/05_operations/LANE_MANIFEST_SPEC.md` | Lane manifest schema, lifecycle states, field definitions |
| `docs/05_operations/DELEGATION_POLICY.md` | Tier assignment rules, sensitive-path policy, reshaping |
| `docs/05_operations/EVIDENCE_BUNDLE_TEMPLATE.md` | Canonical T1 evidence bundle format |
| `docs/05_operations/docs_authority_map.md` | Ranked doc authority; conflict resolution rules |
| `docs/05_operations/PROVIDER_KNOWLEDGE_BASE.md` | SGO / odds provider integration knowledge |
| `docs/05_operations/r1-r5-rules.json` | R-level verification rule definitions |
| `docs/06_status/PROGRAM_STATUS.md` | High-level program status at its stated update time |
| `docs/06_status/KNOWN_DEBT.md` | Known-debt pointer index |
| `docs/06_status/proof/PROOF-TEMPLATE.md` | Simple proof template (T2/T3) |
| `docs/05_operations/schemas/executor-result-v1.md` | Executor result schema |
| `docs/05_operations/schemas/pm-verdict-v1.md` | PM verdict schema |

---

## Truth Hierarchy (ranked)

When sources conflict, higher rank wins unconditionally:

| Rank | Source | Authoritative for |
|------|--------|-------------------|
| 1 | GitHub `main` | Shipped code, merge SHAs, CI on merge |
| 2 | Proof bundle (tied to merge SHA) | Completion evidence |
| 3 | Lane manifest (`docs/06_status/lanes/*.json`) | Active lane state |
| 4 | Linear | Workflow intent, tier label, ownership |
| 5 | Chat / memory / agent claims | Context only — never authoritative |

Full spec: `docs/05_operations/EXECUTION_TRUTH_MODEL.md`.

---

## Pre-Closure Checklist (T3/T2 minimum — 7 steps)

Before running `ops:lane-close`:

1. `pnpm verify` green on the branch
2. R-level check: `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — all required artifacts present
3. Proof SHA binding automated — `post-merge-lane-close.yml` runs `ops:proof-generate --merge-sha` after merge
4. CI green on merge SHA (not just branch CI — check GitHub, not local)
5. T1 only: `pnpm test:db` green + evidence bundle generated and validated
6. Tier label set in Linear (auto-applied by `ops:lane-finalize`; verify it)
7. `ops:truth-check UTV2-###` exits 0
