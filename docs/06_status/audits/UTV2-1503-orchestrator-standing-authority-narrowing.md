# UTV2-1503 — Orchestrator Standing Authority: Audit and Narrowing Recommendation

**Status:** Analysis and recommendation only. **No policy file, workflow, branch-protection setting, or authority rule is changed by this lane.** Every Observed claim below was verified against file content or a live read-only `gh api` call at authoring time. Recommendations require PM ratification and a separate approved lane before any of them take effect.

| Field | Value |
|---|---|
| Issue | UTV2-1503 |
| Tier | T1 |
| Lane type | governance |
| Author | Claude (orchestrator) |
| Date | 2026-07-15 |
| Base | `main` at `36f4f204` |

**Identity and independence limitation:** this audit was authored by Claude through a GitHub account shared with Griff. The account display identity, commit authorship, CI output, and Claude's analysis do **not** constitute independent Griff review, an owner approval, or independent certification. For this T1 lane, owner approval remains the exact dual-artifact requirement: the `t1-approved` label **and** a valid Griff-authored `pm-verdict/v1` APPROVED artifact bound to the reviewed PR head. Neither artifact is created or implied by this document.

Sections are strictly separated: **Observed** (verified file/API facts), **Inferred** (risk reasoning built on those facts), **Recommended** (proposed narrower policy, no implementation here), **Unresolved** (open questions this lane could not settle).

---

## 1. OBSERVED — Standing authority and path eligibility are separate controls

Two mechanisms govern different questions and are not interchangeable. The Delegation Policy grants tier-scoped execution and merge authority. Lane-type path allowlists establish whether a lane is eligible to touch a path; they do **not** grant review or merge authority. The mechanisms overlap on path scope and disagree on several classifications, but a path passing Lane Authority Check does not by itself authorize its edit or merge.

### 1.1 Delegation Policy Tier A (`docs/05_operations/DELEGATION_POLICY.md`)

Tier A ("Autonomous"): *"The orchestrator may plan, dispatch, review, merge, and update Linear state without PM confirmation."* Merge policy: *"Tier A PRs may be merged by the orchestrator on green CI without PM pre-approval."*

Eligible-path list (verified verbatim in the "Eligible work" block):

| # | Path | Carve-out |
|---|---|---|
| 1 | `scripts/**` | None. Parenthetical says "(helper scripts, not runtime)" — see Inferred §3.1: this mischaracterizes what lives there. |
| 2 | `.claude/**` | None. |
| 3 | `.github/workflows/**` | *"when it does not change required status checks on protected branches"* — self-assessed; no CI step verifies it (Observed §2.4). |
| 4 | `docs/06_status/**` | "after PM has accepted the underlying work" — narrative gate, not mechanical. |
| 5 | `docs/05_operations/**` | Only `DELEGATION_POLICY.md` itself is excluded by name ("self-amendment requires PM"). No other file in the directory is named. |
| 6 | `.ut-issues/**.yaml` | None. |

The "Self-amendment" section repeats the exclusion for `DELEGATION_POLICY.md` only: *"the orchestrator modifying its own authorization bounds is a conflict of interest."* No equivalent exclusion exists for any other governing file.

### 1.2 Lane-type path eligibility allowlists (`.lane/lanes/*.yml`, enforced by `lane-check.yml`)

`.github/workflows/lane-check.yml` derives the lane type from `docs/06_status/lanes/<issue>.json` and validates the PR's changed files against `allowed_path_globs` in `.lane/lanes/<type>.yml`. The `governance` lane type — the type of this very lane — allows (verified in `.lane/lanes/governance.yml`):

- `.claude/agents/**`, `.claude/commands/**`, `.claude/hooks/**`, `.claude/settings.json`
- `.github/**` — **unqualified**; no required-status-check carve-out at all
- `.lane/**` — includes `governance.yml` itself (self-referential)
- `.ops/**`, `scripts/**`, `deploy/**`
- `docs/05_operations/**` — no exclusion for `DELEGATION_POLICY.md` or any other file
- `docs/00_constitution/**`, `docs/02_architecture/**`, `docs/governance/**`
- `CLAUDE.md`, `docs/START_HERE.md`, `docs/CODEBASE_GUIDE.md`
- `packages/contracts/**`, `packages/db/src/**`, `packages/domain/src/**`
- `package.json`, `pnpm-lock.yaml`, `tsconfig*.json`, `Dockerfile`

`forbidden_path_globs` contains three entries: `supabase/migrations/**`, `database/migrations/**`, and `packages/**/database.types.ts`.

This eligibility allowlist is broader than Delegation Policy Tier A in three verified ways: (a) it does not exclude `DELEGATION_POLICY.md` — a governance-lane PR editing it can pass Lane Authority Check, but still lacks autonomous merge authority; (b) it includes `.lane/**`, so the allowlist file can make a PR that edits itself path-eligible; (c) it includes `packages/contracts/**` and `packages/domain/src/**`, which `DELEGATION_POLICY.md`'s sensitive-path matrix names **Tier C — no autonomous edits**. The mechanisms therefore disagree on path classification, while the Delegation Policy and tier gates remain the authority controls.

A third, per-lane mechanism — `file_scope_lock` in the lane manifest, enforced by `.github/workflows/file-scope-lock-check.yml` via `scripts/ci/file-scope-guard.ts` — constrains each lane to its declared files, but the lane (orchestrator) declares its own scope at lane-start; it is a collision/discipline control, not an authority ceiling.

### 1.3 CLAUDE.md and STANDING_GUARDRAILS.md standing-authority statements

- Root `CLAUDE.md` grants the orchestrator the execution-orchestrator role ("work the Linear backlog, merge on green per tier policy") and states the T2 merge-authority branch: the orchestrator's own `gh pr review --approve` after diff review satisfies T2 merge authority, for any executor. `CLAUDE.md` itself is inside the governance-lane allowlist (§1.2), so the orchestrator can edit the file that states its own merge authority.
- `docs/05_operations/STANDING_GUARDRAILS.md` is PM-maintained prose injected into every prompt by `.claude/hooks/session-start.sh`. It currently carries one live guardrail (2026-07-07: no direct-main bypass for ordinary execution, per `DIRECT_MAIN_BYPASS_POLICY.md`, UTV2-1432). The file sits under `docs/05_operations/**` — standing-authority editable under Tier A and path-eligible for a governance lane — and the hook that injects it lives under `.claude/hooks/**`, with the same separation between authority and eligibility.

## 2. OBSERVED — Which standing-authority paths change enforcement behavior when edited

| Path | Read by `merge-gate.yml`? | Read by truth-check (`scripts/ops/truth-check-lib.ts`)? | Read by `scripts/ci/r-level-check.ts`? | Delegation-authorized / lane-eligible? |
|---|---|---|---|---|
| `docs/05_operations/r1-r5-rules.json` | No | Indirectly (see below) | **Yes — directly parsed** (`r-level-check.ts:256`) | Yes / yes |
| `scripts/ci/r-level-check.ts` | No | Mention-check only (check P14: verification log must reference the script name — a text grep, `truth-check-lib.ts:243-284`) | is the script | Yes / yes (`scripts/**`) |
| `scripts/ops/truth-check-lib.ts`, `scripts/ops/lane-start.ts` | No | are the scripts | No | Yes / yes (`scripts/**`) |
| `scripts/ops/apply-branch-protection.sh` | No | No | No | Yes / yes (`scripts/**`). It is the script that writes `required_status_checks.contexts` (`verify`, `Executor Result Validation`, `Merge Gate`, `P0 Protocol`) via `gh api PATCH` (lines 33-38). |
| `.github/workflows/merge-gate.yml`, `lane-check.yml`, `r-level-compliance-check.yml`, `proof-auditor-gate.yml`, `proof-coverage-guard.yml`, `file-scope-lock-check.yml` | are the gates | No | No | Tier A only with the self-assessed carve-out / yes (`.github/**` unqualified in `governance.yml`) |
| `.lane/lanes/*.yml` | No | No | No | Not established by Tier A / yes (`.lane/**` in `governance.yml`, self-referential eligibility) |
| `docs/05_operations/TRUTH_CHECK_SPEC.md`, `LANE_MANIFEST_SPEC.md`, `EXECUTION_TRUTH_MODEL.md` | No | No — these are the specs the scripts implement, not runtime inputs | No | Yes / yes |
| `docs/06_status/lanes/<issue>.json` (manifest `tier` field) | **Yes** — Merge Gate resolves the authoritative tier from the lane manifest (`merge-gate.yml` "Resolve authoritative tier from lane manifest"); tier labels are evidence only | Yes | No | Conditional Tier A / yes; every lane writes its own manifest by design |
| `.claude/commands/*.md` (incl. `three-brain.md` Rule 9, the PM-escalation trigger list) | No | No | No | Yes / yes |
| `docs/05_operations/schemas/*.md` (pm-verdict-v1, executor-result-v1) | Parsing conventions described here are what the gate/validators implement | No | No | Yes / yes |
| `docs/05_operations/STANDING_GUARDRAILS.md` + `.claude/hooks/session-start.sh` | No | No | No | Yes / yes |

### 2.4 Branch protection point-in-time snapshot (live-verified, read-only `gh api repos/griff843/Unit-Talk-v2/branches/main/protection`, re-captured 2026-07-16)

The observations in this subsection are a dated API snapshot, not a claim about current or future branch-protection state. They must be re-read from GitHub before any implementation or owner decision relies on them.

- `required_status_checks.contexts = ["verify", "Executor Result Validation", "Merge Gate", "P0 Protocol"]`
- `enforce_admins.enabled = false`; `required_approving_review_count = 0`
- **`Lane Authority Check`, `R-Level Compliance Check`, `Proof Auditor Gate`, and `Proof Coverage Guard` are NOT required contexts.** All four can fail on a PR without blocking merge. `merge-gate.yml` does not consult their outputs — it resolves tier from the lane manifest and checks labels / pm-verdict comments only.
- No CI step anywhere diffs a workflow-editing PR against `required_status_checks.contexts` — the Tier A `.github/workflows/**` carve-out ("when it does not change required status checks") is enforced by nothing mechanical.

---

## 3. INFERRED — Risk matrix: where standing authority lets the orchestrator loosen its own gates

Built strictly on the Observed facts above. "Standing-editable" means the Delegation Policy authorizes the edit; "path-eligible" means a lane allowlist permits the path. Lane eligibility alone never supplies review or merge authority. Required-check observations refer only to the dated snapshot in §2.4.

| # | Path | Loosening vector | Severity |
|---|---|---|---|
| 1 | `docs/05_operations/r1-r5-rules.json` | Edit the machine-readable trigger matrix that decides which of the orchestrator's own future diffs require R-level proof; merge on green CI with no PM touchpoint. Sharpest instance: standing-editable AND directly parsed by an enforcement script. Contradicts `docs_authority_map.md`, which names it "Program Owner"-owned. | Critical |
| 2 | `scripts/ci/r-level-check.ts`, `scripts/ops/truth-check-lib.ts`, `scripts/ops/lane-start.ts` | Edit the executable implementation of the done-gate and R-level enforcement. CI for a `scripts/**`-only diff is `verify` (lint/type/build/test) — nothing asserts the enforcement logic still enforces what it did before. Tier A's "helper scripts, not runtime" label is wrong for these: they ARE the governance runtime. | Critical |
| 3 | `.github/workflows/merge-gate.yml` and sibling gate workflows | Delegation Policy Tier A authorizes qualifying workflow edits while the governance allowlist makes them path-eligible; the "does not change required status checks" carve-out is self-assessed with no mechanical verification identified in the dated snapshot (Observed §2.4). | Critical |
| 4 | `.lane/lanes/governance.yml` | Self-referential eligibility: a governance-lane PR can widen the allowlist used to decide path eligibility. That does not independently authorize merge, but it weakens a separate scope control; at the dated §2.4 snapshot, Lane Authority Check was not a required context. | High |
| 5 | `docs/05_operations/EXECUTION_TRUTH_MODEL.md`, `TRUTH_CHECK_SPEC.md`, `LANE_MANIFEST_SPEC.md` | Standing-editable specs defining the truth hierarchy and the meaning of "done". `EXECUTION_TRUTH_MODEL.md` self-describes as T0 yet is absent by name from `docs_authority_map.md`'s ownership table; `TRUTH_CHECK_SPEC.md`/`LANE_MANIFEST_SPEC.md` are mapped "Program Owner" while Tier A simultaneously grants autonomous edit — a direct contradiction between the two documents. | High |
| 6 | `.claude/commands/**` (esp. `three-brain.md` Rule 9), `.claude/hooks/**`, `CLAUDE.md` | The orchestrator can edit the skills that define when it must stop and escalate to the PM, the hook that injects standing guardrails, and the root instruction file stating its own merge authority. Soft controls, but the only place several PM constraints live. | High |
| 7 | `docs/05_operations/STANDING_GUARDRAILS.md` | PM-maintained by convention only; Tier A makes it standing-authority editable and the governance allowlist makes it path-eligible. An orchestrator edit deleting a guardrail line would silently remove it from every future session's injected context. | High |
| 8 | `scripts/ops/apply-branch-protection.sh` | Script content is standing-editable; actually running it requires GitHub admin credentials — a compensating control that exists today but is not named anywhere in policy as the reason this is safe. | Medium |
| 9 | `docs/05_operations/schemas/**` (pm-verdict-v1, executor-result-v1) | Loosening the pm-verdict schema description could desynchronize what the PM believes an approval artifact is from what the gate parses. | Medium |
| 10 | `docs/06_status/lanes/<issue>.json` | Merge Gate takes the authoritative tier from the lane manifest, which the lane itself writes. Partially mitigated by lane-start stamping tier from Linear and Merge Gate re-reading per run; residual risk is a mid-lane manifest tier downgrade (T1→T3) drifting from Linear. | Medium |

**Aggregate inference:** the Delegation Policy's standing-authority surface, the lane path-eligibility surface, and the enforcement-definition surface overlap substantially. Lane Authority Check polices path eligibility rather than merge authority and, at the dated §2.4 snapshot, was advisory in branch-protection effect because it was not a required context.

---

## 4. RECOMMENDED — Narrower policy (no implementation in this lane)

### 4.1 Governance-critical path list

Define a single canonical, machine-readable list (e.g. `docs/05_operations/governance-critical-paths.json`) of paths that **require an owner-ratified T1 lane** and are **never editable under standing authority**, regardless of the PR's tier label or lane type. "Owner-ratified" must preserve the existing exact dual-artifact gate: the `t1-approved` label **and** a valid Griff-authored `pm-verdict/v1` APPROVED artifact bound to the reviewed head. Chat, implementer output, shared-account authorship, or either artifact alone is insufficient.

1. `.github/workflows/merge-gate.yml`
2. The other gate/guard workflows: `lane-check.yml`, `r-level-compliance-check.yml`, `proof-gate.yml`, `proof-coverage-guard.yml`, `file-scope-lock-check.yml`, `branch-discipline-guard.yml`, `direct-main-push-guard.yml`, `p0-protocol.yml`, `executor-result-validator.yml`, `post-merge-lane-close.yml` (`proof-gate.yml` is the active, PR-triggered consolidated Proof Gate; `proof-auditor-gate.yml` is disabled to `workflow_dispatch` only and protecting it instead would leave the active T1 proof gate editable under the same standing-authority surface this list is trying to narrow)
3. `scripts/ci/r-level-check.ts`, `scripts/ci/file-scope-guard.ts`, `scripts/lane-contract.ts`, and any script a gate workflow invokes
4. `scripts/ops/truth-check-lib.ts`, `scripts/ops/lane-start.ts`, `scripts/ops/lane-close*.ts`, `scripts/ops/apply-branch-protection.sh`
5. `docs/05_operations/r1-r5-rules.json` and `R1_R5_OPERATING_RULE.md`
6. `docs/05_operations/DELEGATION_POLICY.md` (already excluded in prose; make it mechanical)
7. `docs/05_operations/EXECUTION_TRUTH_MODEL.md`, `TRUTH_CHECK_SPEC.md`, `LANE_MANIFEST_SPEC.md`, `docs_authority_map.md`
8. `docs/05_operations/STANDING_GUARDRAILS.md` and `.claude/hooks/session-start.sh`
9. `docs/05_operations/schemas/**` (schemas consumed by CI/gate parsing)
10. `docs/00_constitution/**`
11. `.lane/lanes/**` (the lane-authority allowlists themselves)
12. `docs/05_operations/DIRECT_MAIN_BYPASS_POLICY.md` and branch-protection documentation
13. The governance-critical path list file itself

Everything else currently in Tier A / governance allowlists stays delegable unchanged: status docs, proofs, lane manifests, ops helper/reporting scripts, non-gate workflows, issue metadata, and skills that do not carry escalation rules (`three-brain.md` Rule 9 and the escalation sections of `/verification` and `/lane-management` are candidates for inclusion at PM discretion — see Unresolved §5.4).

### 4.2 Mechanical enforcement mapping (existing CI where possible)

| Recommendation | Mechanical carrier |
|---|---|
| Block standing-authority edits to the critical list | New CI check "Governance Self-Amendment Guard": fails any PR touching a listed path unless the PR is T1 and carries **both** the `t1-approved` label and a valid Griff-authored `pm-verdict/v1` APPROVED artifact bound to the reviewed head. No override label or single-artifact alternate route is recommended. Keyed on **file identity, not issue tier**, so a T3 housekeeping PR touching a listed file must be reclassified and complete the T1 dual-artifact gate. Implementation may reuse comment-validation patterns, but must preserve reviewer identity and head-SHA binding. |
| Make the new check binding | Add it to `required_status_checks.contexts` on `main` — otherwise it repeats the Observed §2.4 failure mode (real check, non-blocking). |
| Close the advisory-gate gap generally | Promote `Lane Authority Check` (and, at PM discretion, `R-Level Compliance Check`, `Proof Auditor Gate`, `Proof Coverage Guard`) into required contexts; update `scripts/ops/apply-branch-protection.sh` to write the expanded list. |
| Close the self-referential allowlist loop | Remove `.lane/**` from `governance.yml`'s own `allowed_path_globs`; route `.lane/lanes/**` edits through the critical-path guard instead. |
| Reconcile the two authority mechanisms | Both `DELEGATION_POLICY.md` prose and the new check read the same `governance-critical-paths.json`; drop `packages/contracts/**` and `packages/domain/src/**` from `governance.yml` (Delegation Policy already marks them Tier C). Name-exclude the §4.1 doc set in Tier A's `docs/05_operations/**` bullet so prose and mechanism agree. |
| Verify the `.github/workflows/**` Tier A carve-out | The new guard subsumes it for gate workflows; optionally a small CI step alerts when a PR touches `apply-branch-protection.sh`'s context list. |
| Split `scripts/**` Tier A honestly | Policy text change: helper/reporting scripts (digest, brief, scope-suggest) stay Tier A; the enforcement-implementation set (item 3-4 above) is Tier C. Enforced by the same new guard, not by prose alone. |

All of the above is follow-up work — a separate, PM-scoped, owner-ratified lane (or lanes). Nothing here has taken effect.

---

## 5. UNRESOLVED

1. **`enforce_admins: false` + `required_approving_review_count: 0`** (live-verified): any admin-authenticated actor can `gh pr merge --admin` past all four required checks, regardless of everything above. This is a branch-protection-enforcement question, not a path-authority question, and `--admin` is a deliberately-used escape hatch for stale-check situations today. Needs a standing PM decision and its own tracked issue; deliberately not folded into §4.
2. **Workflow execution ref for `pull_request` events:** whether an edited gate workflow in a PR runs from the base ref or the PR's merge ref for this repo's trigger configuration was not verified here. The §4 recommendation does not depend on the answer, but it affects how exploitable risk item 3 is *pre-merge* (post-merge it is exploitable regardless).
3. **Ownership of `EXECUTION_TRUTH_MODEL.md`:** absent by name from `docs_authority_map.md` despite self-describing as T0 with "this document wins" supremacy. Which ownership row it belongs in is a PM call.
4. **Skill-file scope:** how much of `.claude/commands/**` belongs on the critical list (only escalation-rule-bearing skills vs. all skills) is a trade-off between safety and iteration speed — flagged, not decided.
5. **Manifest-tier drift:** whether lane-start's tier stamping plus Merge Gate's per-run manifest read is sufficient against a mid-lane manifest tier downgrade (risk item 10) was not adversarially tested in this lane.
