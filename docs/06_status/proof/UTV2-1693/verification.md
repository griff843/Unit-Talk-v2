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
- [x] Every capability map entry carries situation, capability, kind, authority and fallback; all 22 capabilities and all fallbacks resolve to a real command or agent (0 problems).
- [x] The escalation boundary states its categories and defers to `/three-brain` Rule 9 as canonical for stop conditions, rather than duplicating that list.

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

Every section of the previous `CLAUDE.md` was classified before rewriting.

> **Corrected after independent review.** This section originally claimed "nothing was dropped silently."
> That was false: the `Commands` row below covered three prose rules as well as the command list, and two
> of them were dropped without a home — one of which another canonical doc cites by name. Both are now
> restored to §12. See R4 under Independent review.

| # | Previous section | Classification | Disposition |
|---|---|---|---|
| 1 | Mission | **UPDATE** | Became §1 Operating role. The previous text described Claude as "the execution orchestrator" working a backlog; it never said the orchestrator is not the sole implementer, which is the behaviour the role actually requires. |
| 2 | Commands (15 lines of `pnpm` invocations **plus three prose rules**) | **MOVE + partial drop, now corrected** | Command list to `docs/05_operations/CAPABILITY_MAP.json`, keyed by *situation* rather than by name — a flat list answers "what exists", while the failure mode being fixed is not knowing *when* to reach for one. The section's three prose rules were initially mishandled: environment-load order survived, but the `sleep`-then-poll prohibition and the read-`database.types.ts`-before-SQL guard were dropped. Both restored to §12 after review. |
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

## Remediation-path verification rule added post-review

`/verification` gains one rule, added after this lane's independent review and after a defect that the rule would have caught:

> **A refusal that names a remedy is not tested until the remedy has been executed and observed to succeed.**

The evidence is UTV2-1700, found the same day. `ops:merge-wrapper main-sync` correctly refuses on a diverged branch and names `git-merge-main` as the safe remedy; `git-merge-main` runs `git merge --ff-only`, so it fails with the identical error in the only state that prescribes it. That shipped through careful implementation, independent review, mutation testing and PM approval — every one of which verified that the refusal fires, and none of which executed the remedy.

It belongs in this lane because `/verification` is already in the declared file scope and because it is a standing rule about how proof is judged, not a procedure. It widens the content reviewed at head `ac409d4e`, so it is disclosed here rather than folded in silently.

## Independent review

This lane was implemented by the orchestrator, on a document that governs the orchestrator. Per invariant 14 the implementer must not be the sole validator, so it was reviewed by `pr-risk-reviewer` at head `ac409d4e`.

**Verdict: RISK HIGH. Do not merge as-is.** Four substantive findings, all valid, all now fixed. The review is the reason this bundle's earlier claim that "nothing was dropped silently" is corrected below rather than left standing.

### R1 — an authority regression in §9 (most serious)

§9 stated that the `t1-approved` label, a GitHub review approval and a `pm-verdict/v1` comment "must **originate** from the PM". That is false for T2 and it deletes a ratified mechanism.

`main`'s CLAUDE.md carried the disambiguating sentence — *"For T2, the orchestrator's own `gh pr review --approve` after diff review satisfies the 'GitHub PR review approval' branch — no PM presence or PM_VERDICT comment is mechanically required, for any executor"* (ratified 2026-05-18 under UTV2-979). The rewrite dropped it while generalising the origination rule over all three artifacts.

Corroborated by the reviewer against four independent sources: `.github/workflows/merge-gate.yml` (whose own comment cites CLAUDE.md as the source of the self-approval rule), `DELEGATION_POLICY.md:78,234`, `OPERATING_MODEL_SONNET5.md:58`, and `/three-brain` Rule 9.

Left in, this would have forbidden the exact mechanism by which T2 lanes merge — a governance document silently revoking a ratified authority.

**Fixed:** the origination rule is now scoped to *PM decisions*, and T2 self-approval is stated explicitly as the ratified exception, with what invariant 14 actually requires there (independent review first, then approve on the strength of it). `merge-gate.yml` is named as the tiebreaker.

### R2 — a self-contradiction inside a file this lane edited

`.claude/commands/lane-management.md:3` still opened with *"The lane manifest is the sole authority for active lane state"* — the precise claim this lane exists to correct — one section above the new paragraph explaining it is false.

**Fixed:** the opening now distinguishes *declared* lane state (where the manifest is authoritative, over Linear and chat) from *whether a lane can run* (where leases, worktrees, locks, PR and CI state can each block independently).

### R3 — a duplicated escalation list that had already drifted

§9 paraphrased `/three-brain` Rule 9 as six items against its actual ten, with no cross-reference. `OPERATING_MODEL_SONNET5.md:56` warns against this by name, citing a prior incident where a duplicated copy listed a gate `merge-gate.yml` had removed.

**Fixed:** §9 now points at Rule 9 as canonical and instructs that the list not be restated anywhere, citing the prior drift. This is invariant 11 applied to the constitution itself.

### R4 — content dropped without a home, one of it load-bearing

The audit table classified the old `## Commands` section as a single MOVE row. It actually held the command list **plus three prose rules**, and only the environment-load order survived.

- **The `sleep`-then-poll prohibition** was dropped — and `RUNTIME_RELIABILITY_AGENT_CHARTER.md:56` cites it as living in "root `CLAUDE.md`", so the drop left a dangling cross-reference from another canonical doc.
- **The "read `database.types.ts` before writing any SQL" guard** was dropped with no restatement in `/db-verify`, `/betting-domain` or `/code-structure`.

**Fixed:** both restored to §12. The 18-row document table, which shrank to 9, now ends with a pointer to `docs_authority_map.md` as the index of everything not listed.

### Correction to this bundle

The audit section previously asserted "Nothing was dropped silently." That was **wrong**, and the review proved it. Two rules were dropped, one of them cited by another canonical document. The claim has been corrected in place; the audit's per-section classification stands, but its completeness claim did not survive contact with a reader who checked it.

### R1 follow-up — a third T2 path the rewrite also omitted

Merging PR #1410 immediately afterwards proved the corrected §9 was still incomplete. `gh pr review --approve` returned:

```
failed to create review: GraphQL: Review Can not approve your own pull request
```

GitHub refuses self-approval on an own-authored PR, so the GitHub-review-approval branch is unavailable for exactly the PRs the orchestrator opens. `merge-gate.yml` accepts a third T2 artifact the rewrite never mentioned — an `executor-result/v1` self-attestation from a CODEOWNERS member — and that is what satisfied the gate on #1410.

§9 now names all three T2 artifacts and states which one applies to an own-authored PR. Found by executing the rule rather than by reading it, which is the same standard invariant 13 sets for controls.

### Alignment with the operating-system activation directive

The eight required operating rules map to the file as follows, each verified rather than asserted:

| Required rule | Where | Verified by |
|---|---|---|
| 1. Claude as Engineering Manager / Orchestrator, not default implementer | §1 | Role table plus the explicit rule that implementing directly is a choice to justify |
| 2. Existing capability first | §2, invariant 12 | `ops:automation-coverage-check` named and confirmed to exist |
| 3. Automatic subagent usage | §3 | All 8 agents confirmed present in `.claude/agents/`; situation table matches the directive's list |
| 4. Implementation/review separation | invariant 14, §3 | Applied to this lane itself: independent review found four defects |
| 5. Safety controls prove themselves | invariant 13, §8 | §8 states the assertion standard — assert the forbidden action never ran, not that an error was returned |
| 6. State truth model across populations | invariant 6, §5 | Replaces the false "manifest is the sole authority" claim |
| 7. Parallel execution | §7 | Capacity from `ops:execution-state`, never assumption; conflicting file scopes never parallelised |
| 8. Human escalation boundary | §9 | Categories stated; Rule 9 kept canonical for stop conditions |

The capability map now carries the directive's four-field contract — situation, capability, authority, **fallback** — for all 22 entries. A validation pass over the committed file confirms every capability and every fallback resolves to a real `package.json` script or an agent in `.claude/agents/`, with zero problems.

**Not yet satisfied: machine validation in CI.** The directive requires the map be machine validated. The validation above was run against the committed file, but the checker is not itself checked in, because a new script and its test fall outside this lane's frozen `file_scope_lock`. Widening a frozen scope mid-lane is the failure mode that produced the scope-freeze deadlock previously recorded, so the checker is dispatched as its own lane rather than smuggled in here. Until it lands, the map's correctness rests on a one-time run, which is exactly the weaker control invariant 11 warns about — stated plainly rather than presented as done.

### Not accepted as blocking

The reviewer flagged §12's "required by preflight" for `GITHUB_TOKEN` as slightly overstated, since preflight's check is waivable. Reworded rather than dropped: preflight's check is waivable, pre-merge authorization is not.

### What the reviewer could not verify

The "70 of 76 `ops:`/`ci:` scripts are referenced somewhere an agent reads" figure was taken on faith, and the per-item authority classifications in `CAPABILITY_MAP.json` were spot-checked rather than exhaustively audited. Both are recorded as unverified rather than presented as confirmed.
