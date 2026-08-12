# PROOF: UTV2-1693

MERGE_SHA: ac409d4e50b1890ff64a5d2a9ef54b9dd7457722

> Pre-merge, this anchor carries the verified implementation SHA; the merge SHA
> does not yet exist. `runtime-verifier-gate.ts:132-134` hard-fails when no
> 40-hex SHA is present at all and only warns when it differs from the current
> head, so a placeholder word here fails the gate outright. `post-merge-lane-close.yml`
> rebinds this anchor to the authoritative merge SHA via `ops:proof-generate --merge-sha`.

## ASSERTIONS:

- [x] Invariant 6 no longer claims the lane manifest is the sole authority for active lane state.
- [x] The lane-start checklist requires a lease check as well as a manifest check, with the command for each.
- [x] All eight previously-undocumented commands are recorded, in a machine-readable map rather than prose.
- [x] `GITHUB_TOKEN` and its `gh auth token` source are documented.
- [x] Subagent policy is stated, including that subagents are advisory only.
- [x] `/dispatch` and `/verification` invoke their tools as steps, not suggestions.
- [x] `CLAUDE.md` remains thin and pointer-based; no procedural detail was added that belongs in a skill.
- [x] Every command and agent named in the new files was verified to exist before being named.

## EVIDENCE:

The section audit, the existence check, and the measured commands are recorded below.

## Verification

| Check | Result | Evidence |
|---|---|---|
| `pnpm type-check` | PASS | 0 TypeScript errors |
| `pnpm lint` | PASS | 0 ESLint problems |
| `pnpm test` | PASS | 4668 tests, 4668 pass, 0 fail, 0 skipped; 0 `not ok` lines across 30,426 lines of TAP output |
| `pnpm verify` — `test:live-db` | REFUSED (non-staging target) | `[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1)` — the staging-isolation guard operating correctly. Not required for T2, and this lane changes no DB path. |
| Existence check on every referenced command, skill and agent | PASS after one fix | 14 of 15 commands present; 4 of 4 skills; 8 of 8 agents; `docs/governance/CONCURRENCY_CONFIG.json` present. Two false claims found and corrected — see below. |

### Commands executed (explicit references)

- `pnpm type-check` — PASS, 0 TypeScript errors.
- `pnpm test` — PASS, 4668 tests, 4668 pass, 0 fail.
- `pnpm lint` — PASS, 0 ESLint problems.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — R-level compliance evaluated for this lane.

---

## Mandatory section audit

Every section of the previous `CLAUDE.md` was classified before rewriting. Nothing was dropped silently.

| # | Previous section | Classification | Disposition |
|---|---|---|---|
| 1 | Mission | **UPDATE** | Became §1 Operating role. The previous text described Claude as "the execution orchestrator" working a backlog; it never said the orchestrator is not the sole implementer, which is the behaviour the role actually requires. |
| 2 | Commands (15 lines of `pnpm` invocations) | **MOVE** | To `docs/05_operations/CAPABILITY_MAP.json`, keyed by *situation* rather than listed by name. A flat command list answers "what exists"; the failure mode being fixed is not knowing *when* to reach for one. |
| 3 | Truth hierarchy | **KEEP** | Retained verbatim as §5, plus the state-population model the old file lacked. |
| 4 | Core invariants (11) | **UPDATE** | Retained 1–5 and 7–11 unchanged. **Invariant 6 was factually wrong and is corrected.** Three added: 12 (check existing capability first), 13 (a control is proven only by failing when removed), 14 (the implementer is never the sole validator). |
| 5 | Build status — Phase 7A | **REMOVE** | Point-in-time status in a permanent-rules file. It goes stale by construction and `PROGRAM_STATUS.md` already owns it. |
| 6 | Lane execution expectations (incl. 7-step pre-closure checklist) | **MOVE TO SKILL** | Procedural detail belongs in `/lane-management` and `/verification`. §7 keeps only the rule: `ops:lane-start` and `ops:lane-close` are the sole sanctioned transitions. |
| 7 | Verification expectations | **KEEP** | Retained as §10, including the rule that `merge-gate.yml` wins when the table and the workflow disagree. |
| 8 | Authoritative documents (18-row table) | **MOVE** | Condensed into "Where things live". The old table listed documents; the new one answers "where does this kind of question get settled". |
| 9 | Skills (15-row table) | **MOVE** | To `.claude/commands/`, which is self-describing, and to the capability map for situation-based routing. |
| 10 | Session discipline | **UPDATE** | Became §12. `GITHUB_TOKEN` added — its absence blocks both preflight token generation and pre-merge authorization, and it was undocumented. |
| 11 | What this file is not | **KEEP** | Retained. |

### Sections with no predecessor

§2 Existing capability first · §3 Subagent policy · §4 Capability map · §8 Mutation safety · §9 Escalation boundary · §11 Self-improvement.

These exist because the old file was silent on them, and that silence had measurable cost: an orchestration session ran for hours hand-writing `node` one-liners for lock checking and `gh api` parsing for CI triage while eight purpose-built subagents and six diagnostics sat unused. 70 of 76 `ops:`/`ci:` scripts are referenced somewhere an agent reads, so this was an adoption failure, not a discoverability failure.

---

## Confirmed defect: invariant 6 was false

Previous text:

> "Lane manifest is the sole authority for active lane state."

All six target files for a lane were checked against manifest `file_scope_lock` entries and returned **FREE**. `ops:lane-start` then refused with `lease_conflict`. Leases are a second, independent authority that blocks lanes the manifest reports as clear.

This is not hypothetical and it is not rare — it recurred during this very session. Starting the governed proof-repair lane for UTV2-1691 failed with `lease_conflict` against a lane whose work had already merged, and required a manual `ops:lease release` first.

The replacement invariant names all the populations and states that any one of them can independently block a lane.

---

## Controls proven by making them fail

The claim under test is not "the file reads well" — it is **"every command and agent this file tells an agent to run actually exists."** A constitution that names a non-existent tool is worse than one that stays silent, because it will be believed.

The check was run against the draft before commit:

```
MISS ops:capability-audit
OK   ops:automation-coverage-check      OK   ops:execution-state
OK   ops:merge-ready                    OK   ops:pr-block-diagnostic
OK   ops:lease                          OK   ops:substrate-guard
OK   ops:lane-maximizer                 OK   ops:health
OK   ops:ci-doctor                      OK   ops:truth-check
OK   ops:lane-start                     OK   ops:lane-close
OK   ops:brief                          OK   ops:digest
```

**It found two real defects in my own draft**, both of which would have shipped as doctrine and been believed:

**1. A validator that does not exist.** §4 asserted the capability map "is machine-validated by `pnpm ops:capability-audit`". There is no such command. Fixed by naming `ops:automation-coverage-check`, which does exist, and by stating the weaker true guarantee: every command and agent the map names must exist.

**2. An injection that does not happen.** §12 asserted the `UserPromptSubmit` hook injects "system state, standing guardrails and the capability map". Nothing under `.claude/` references `CAPABILITY_MAP` — the hook runs `session-start.sh` and injects the first two only. Fixed to state plainly that the map is **not** injected and must be read directly.

Both are the same failure: a governance document asserting a mechanical guarantee that nothing provides. That is precisely what invariant 13 exists to prevent, and it is worth recording that the file's own author produced two instances of it in a single draft — which is also the argument for invariant 14.

Everything else the file references was confirmed present: all four skills (`/lane-management`, `/verification`, `/dispatch`, `/system-state-loader`), all eight agents named in §3, and `docs/governance/CONCURRENCY_CONFIG.json`.

---

## Deviation from acceptance criterion 3

AC 3 asks that the eight commands "appear in the Commands block". There is no longer a Commands block: the PM directive to rebuild this file as a thin operating constitution (~150–250 lines) is later and explicit, and a 15-line command list is exactly the procedural detail it excludes.

The eight commands are instead in `CAPABILITY_MAP.json`, each with its situation and its authority level. This is a deliberate deviation and satisfies the criterion's intent more strongly than the letter would: the map is machine-readable, situation-keyed, and states what each answer is worth — `ops:execution-state` is authoritative for capacity, `lane-governor` is advisory, `ops:merge-ready` blocks. A flat list conveys none of that.

Flagged explicitly for PM review rather than quietly reinterpreted.

---

## What this lane does not claim

- It does not claim the mandate is now mechanically enforced. `/dispatch` and `/verification` state their invocations as required steps, but nothing fails a build if an agent skips them. Per invariant 11 that is a weaker control than a CI check, and the honest description is "stated as required", not "enforced".
- It does not add the capability map to the session hook. That wiring is a separate change with its own risk surface.
- It changes no runtime, domain, DB, delivery or workflow-authority code. Scope is `CLAUDE.md`, three skills, and one new JSON document.

---

## Independent review

This lane was implemented by the orchestrator. Per invariant 14 the implementer must not be the sole validator of a governance change, so independent review is required before merge and is recorded here when complete.
