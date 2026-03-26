# V2 AI Setup Audit

> Generated: 2026-03-24. All findings are grounded in direct repo inspection.
> Working folder: `C:\dev\Unit-Talk-v2`

---

## 1. Executive Summary

**V2 already has a substantively mature Claude workflow.** It is not a blank slate. The infrastructure includes: a comprehensive project guidance document (CLAUDE.md), a post-write hook system, a multi-agent team framework with one completed run, three agent skills, proof/rollback templates, a doc-truth audit gate, and a full AI context/handoff pack (created this session). The governance model (T1/T2/T3 sprints) provides structure equivalent to what "Claude OS" describes under different terminology.

**What is missing** falls into three categories:
1. **Stale assets:** The post-write hook watches superseded status files. Six Vercel Labs skills are locked that have zero relevance to this platform.
2. **Automation gaps:** No auto-generated proofs, no status sync scripts, no context refresh tooling — all currently done manually.
3. **Undefined terms:** "Dream skill" does not exist in V2 under any name.

**Verdict:** V2 has a mature Claude governance model but needs cleanup of stale/irrelevant assets and a few targeted additions to close automation gaps. No large imports from Claude OS are warranted — the existing patterns are already well-adapted to V2's needs.

---

## 2. Current Claude Infrastructure

### 2.1 CLAUDE.md
**Path:** `CLAUDE.md`
**Status:** Present, comprehensive, current.

The primary authority document. Covers:
- All build/test/verify commands
- Start-of-session checklist (5-document precedence hierarchy)
- Lane discipline (Codex = runtime, Claude = verification/governance)
- Full architecture reference (package graph, data flow, app descriptions)
- Promotion gate details and schema facts
- Live Discord targets with channel IDs
- Weekly governance close sequence
- Anti-drift rules (10 patterns to watch for)
- Legacy boundary policy
- Verification preferred order (DB > operator > runtime > logs)
- Session output style guide

**Assessment:** Current, authoritative, actively used. No changes needed.

---

### 2.2 Memory / Import Structure

**Session memory:** `C:\Users\griff\.claude\projects\C--dev-Unit-Talk-v2\memory\MEMORY.md`
- Present and comprehensive
- Persists across conversations
- Covers: key commands, Linear workspace, all migration history, architectural decisions, resolved decisions, current week status

**Project-level AI context:** `docs/ai_context/v2_truth_pack/` (7 files — created 2026-03-24)
- CURRENT_SYSTEM_TRUTH.md
- REPO_MAP.md
- PICK_LIFECYCLE_TRUTH.md
- DISCORD_STATE_TRUTH.md
- LAUNCH_BLOCKERS.md
- CANONICAL_DOC_INDEX.md
- HANDOFF_FOR_CHATGPT.md

**Assessment:** Memory is active and current. Context pack is new and comprehensive. No gaps here.

---

### 2.3 Commands

**`.claude/commands/` directory:** Does not exist.

No custom slash commands are defined. There are no command files anywhere in the repo.

**Assessment:** Gap. V2 has no custom commands. Whether this matters depends on whether there are repeated workflows that would benefit from a `/command` shortcut (e.g., `/sprint-close`, `/run-proof`, `/status-check`). Not urgent.

---

### 2.4 Skills

Three skills exist in `.agents/skills/`:

#### doc-truth-audit
**Path:** `.agents/skills/doc-truth-audit/`
**Files:** `SKILL.md`, `check-doc-truth.ps1`
**Purpose:** Audit docs that claim `metadata.domainAnalysis` runtime consumers. Enforces binary ACTIVE/NOT_CONSUMING classification. Rejects speculative wording. Verifies ACTIVE claims against domain-analysis evidence tokens in code.
**Status:** V2-native, active, correctly scoped.
**Limitation:** V1 scope only — domain-analysis consumer claims. Settlement, lifecycle, and promotion doc claims are NOT verified by this skill. Those surfaces rely on human-enforced policy.
**Assessment:** Keep. Useful. Consider expanding scope in a future V2 version.

#### frontend-design
**Path:** `.agents/skills/frontend-design/`
**Files:** `SKILL.md`
**Purpose:** Create distinctive production-grade frontend interfaces. Typography guidelines, color/theme aesthetics, motion, spatial composition, texture/gradient use. Anti-generic-AI-aesthetic rules.
**Status:** Generic design skill. Not V2-specific. Potentially useful for Smart Form V2 UI work but not scoped to this platform.
**Assessment:** Keep if Smart Form UI design is upcoming work. Otherwise low priority. Not legacy carryover — genuinely useful design guidance.

#### web-design-guidelines
**Path:** `.agents/skills/web-design-guidelines/`
**Files:** `SKILL.md`
**Purpose:** Review UI code for compliance with Vercel Labs' web interface guidelines. Fetches guidelines from `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`.
**Status:** Generic web review skill from Vercel Labs. Not V2-specific.
**Assessment:** Low relevance for V2. This is a Discord delivery platform with a simple intake form — not a product where web interface guidelines drive design decisions. Candidate for archival.

---

### 2.5 Skills Lock (skills-lock.json)

**Path:** `skills-lock.json`
**Contents:** 6 Vercel Labs skills locked:
- `deploy-to-vercel`
- `vercel-cli-with-tokens`
- `vercel-composition-patterns`
- `vercel-react-best-practices`
- `vercel-react-native-skills`
- `web-design-guidelines`

**Assessment:** All 6 are irrelevant to Unit Talk V2. V2 is a sports betting pick platform — not a Vercel-deployed web application. These appear to be carryover from a template or prior project initialization. They are not harmful but represent noise. Candidate for removal.

---

### 2.6 Agents

**`.claude/agents/` directory:** Does not exist.

**Agent framework lives in:** `docs/05_operations/` + `AGENTS.md`

| File | Purpose | Status |
|------|---------|--------|
| `AGENTS.md` | Workspace intent, build rules, documentation truth policy, V1 gate enforcement | Active |
| `docs/05_operations/agent_team_charter_v2_scoring_promotion.md` | Charter for V2 Scoring & Promotion audit team (5 roles: Lead, Repo Truth Auditor, Implementation, Verification, Docs/Governance) | Active — Run 001 completed |
| `docs/05_operations/agent_team_run_template.md` | Reusable 5-phase template (Audit, Decision, Implementation, Verification, Documentation) | Active — reusable |
| `docs/05_operations/team_01_run_001.md` | Instantiated Run 001 for scoring/promotion alignment | Closed — completed 2026-03-23 |

**Subagent logs:** `C:\Users\griff\.claude\projects\C--dev-Unit-Talk-v2\<session-id>\subagents\` — cloud agent state from multi-agent team runs (JSONL traces)

**Assessment:** Agent team framework is present and has been used in production. One completed run. The framework (charter + run template) is well-designed and reusable. This is the most mature part of V2's AI infrastructure.

---

### 2.7 Post-Write Hook

**Path:** `.claude/hooks/artifact-drift-check.sh`
**Trigger:** `PostToolUse` on `Write|Edit`

**Checks:**
1. Warns if `.js`, `.d.ts`, or `.js.map` files are written under `src/` directories
2. Reminds to sync sibling status docs when any of three specific files are edited

**ISSUE — Stale file references:**
The hook watches for edits to:
```bash
status_docs=("status_source_of_truth.md" "current_phase.md" "active_roadmap.md")
```
All three of these files are **superseded** by `PROGRAM_STATUS.md` per `SPRINT_MODEL_v2.md` (adopted 2026-03-21). The canonical status authority is now `docs/06_status/PROGRAM_STATUS.md`. The hook is watching for edits to files that are no longer actively maintained.

**Assessment:** The generated-artifact check (Check 1) is valid and useful. Check 2 is stale — the watched files are superseded. Needs update to watch `PROGRAM_STATUS.md` instead.

---

### 2.8 Supporting Docs (Governance Templates)

| File | Status |
|------|--------|
| `docs/06_status/PROOF_TEMPLATE.md` | Active, reusable T1 proof capture template |
| `docs/06_status/ROLLBACK_TEMPLATE.md` | Active, reusable T1 rollback template |
| `docs/06_status/week_*_proof_template.md` (Weeks 7–15+) | Historical — superseded by reusable template |
| `docs/06_status/week_*_failure_rollback_template.md` | Historical — superseded by reusable template |
| `docs/06_status/week_*_closeout_checklist.md` | Historical — per-sprint artifacts |

---

## 3. Claude OS / Governance Status

**Verdict: PARTIAL — V2 has substantive equivalent governance. It does not use the "Claude OS" name or import the Claude OS framework, but implements the same patterns under its own terminology.**

### Evidence: What V2 does instead of "Claude OS"

| Claude OS Concept | V2 Equivalent | Location |
|-------------------|---------------|----------|
| Plan → implement → verify flow | T1 sprint: contract → implementation → independent verification | `SPRINT_MODEL_v2.md` |
| Proof bundle generation | `PROOF_TEMPLATE.md` — manual capture of command outputs, DB checks, receipts | `docs/06_status/` |
| Sprint closeout checklists | Weekly close sequence (8-step) | `CLAUDE.md § Weekly close sequence` |
| Runbooks | Settlement SOP, restart SOP, discord routing guide | `docs/05_operations/` |
| Evidence folders | `out/sprints/`, `system_snapshot.md` | Various |
| Governance gates | T1 automatic triggers (migrations, live routing, settlement changes) | `SPRINT_MODEL_v2.md` |
| Verification templates | `PROOF_TEMPLATE.md`, `ROLLBACK_TEMPLATE.md` | `docs/06_status/` |
| Issue/finding ledgers | `PROGRAM_STATUS.md § Open Risks`, sprint closeout findings | `docs/06_status/` |
| Status automation | None — PROGRAM_STATUS.md is hand-maintained | Gap |
| Context generation | Manual (truth pack just created) | Gap |

### What V2 has that most "Claude OS" setups don't
- Risk-tiered sprint model with different governance requirements per tier
- Single-writer discipline enforced at the code level
- Post-write hook preventing artifact drift
- Doc-truth audit gate with automated code evidence verification
- Multi-agent team framework with completed execution
- Explicit lane discipline (implementation vs. verification are separate roles)
- Immutable audit log enforced by DB trigger

### Genuine gaps vs. Claude OS
1. **No automated proof generation** — proof bundles are manual captures
2. **No status sync scripts** — PROGRAM_STATUS.md is updated by hand
3. **No context refresh automation** — truth pack was created manually, will need manual updates
4. **No custom commands** — no `/sprint-close` or `/verify-lifecycle` shortcuts
5. **Automated gate coverage is narrow** — doc-truth-audit only covers domain-analysis consumers; settlement, promotion, and lifecycle doc claims are human-verified only

---

## 4. Current Reusable Assets

### Commands
None defined. No `.claude/commands/` directory.

### Skills (3)
| Skill | Relevance | Reuse Value |
|-------|-----------|-------------|
| `doc-truth-audit` | High — V2-native | High |
| `frontend-design` | Medium — Smart Form / operator UI | Medium |
| `web-design-guidelines` | Low — generic web guidelines | Low |

### Prompts
No standalone prompt files. Prompt guidance is embedded in CLAUDE.md and the agent team charter/run template.

### Checklists
| Checklist | Location |
|-----------|----------|
| Start-of-session checklist | `CLAUDE.md § Start-of-Session Checklist` |
| Weekly close sequence (8-step) | `CLAUDE.md § Weekly close sequence` |
| T1 sprint close criteria | `SPRINT_MODEL_v2.md` |
| Verification discipline order | `CLAUDE.md § Verification Discipline` |

### Truth-pack / context files
| File | Status |
|------|--------|
| `docs/ai_context/v2_truth_pack/CURRENT_SYSTEM_TRUTH.md` | New, current |
| `docs/ai_context/v2_truth_pack/REPO_MAP.md` | New, current |
| `docs/ai_context/v2_truth_pack/PICK_LIFECYCLE_TRUTH.md` | New, current |
| `docs/ai_context/v2_truth_pack/DISCORD_STATE_TRUTH.md` | New, current |
| `docs/ai_context/v2_truth_pack/LAUNCH_BLOCKERS.md` | New, current |
| `docs/ai_context/v2_truth_pack/CANONICAL_DOC_INDEX.md` | New, current |
| `docs/ai_context/v2_truth_pack/HANDOFF_FOR_CHATGPT.md` | New, current |

### Scripts / helpers
| Script | Purpose | V2 Relevance |
|--------|---------|-------------|
| `scripts/validate-env.mjs` | Validates required/discouraged env keys | High — used in `pnpm env:check` |
| `scripts/kill-port.mjs` | Cross-platform port cleanup | High — wired to Smart Form `predev` hook |
| `scripts/build-linear.mjs` | Programmatic Linear workspace setup | Medium — one-time setup, already executed |
| `scripts/build-linear.sh` | Bash wrapper for above | Low — exists, not needed independently |

### Agent team framework
| Asset | Status |
|-------|--------|
| Agent team charter (V2 Scoring & Promotion) | Active, can be reused as template for future teams |
| Agent team run template (5-phase) | Active, reusable |
| Run 001 record | Closed, historical |

---

## 5. Gaps

### Clearly Missing
1. **No custom slash commands** — `.claude/commands/` does not exist. No `/sprint-close`, `/verify-lifecycle`, `/pick-status`, or other workflow shortcuts.
2. **No automated proof generation** — T1 proof bundles are manually assembled. There is no script that queries the DB and generates a proof draft.
3. **No status sync script** — `PROGRAM_STATUS.md` requires hand-updating after every sprint close. No automation exists for this.
4. **No context refresh automation** — the truth pack (`docs/ai_context/v2_truth_pack/`) was created manually and will drift as the system evolves. No script regenerates it.
5. **Dream skill** — undefined and absent (see Section 7).

### Outdated
1. **`.claude/hooks/artifact-drift-check.sh` Check 2** — watches `status_source_of_truth.md`, `current_phase.md`, `active_roadmap.md` which are all superseded. Should watch `PROGRAM_STATUS.md` instead.
2. **AGENTS.md V1 gate reference** — references `docs/03_contracts/domain_analysis_consumer_contract.md`, but `docs/03_contracts/` is not in the canonical docs path list. UNVERIFIED whether this file exists.
3. **`system_snapshot.md` snapshot date** — states "Snapshot Date: 2026-03-21" and references Week 6–11 as most recent work. The program has since completed many more sprints. The snapshot is partially stale (evidence sections are historical records, but the "Current Stage" language is outdated relative to PROGRAM_STATUS.md).

### Duplicated
1. **Per-week proof templates** (`week_7_proof_bundle_template.md` through `week_16_...`) — all superseded by the reusable `PROOF_TEMPLATE.md`. They are preserved as historical records but create clutter.
2. **Per-week failure/rollback templates** — same situation.

### Legacy Carryover (not V2-specific)
1. **`skills-lock.json` Vercel Labs skills** (6 entries) — `deploy-to-vercel`, `vercel-cli-with-tokens`, `vercel-composition-patterns`, `vercel-react-best-practices`, `vercel-react-native-skills`, `web-design-guidelines` — zero relevance to a Discord delivery platform.
2. **`web-design-guidelines` skill** — from Vercel Labs' web interface guidelines. Appropriate for a Vercel-hosted web product, not for this platform.

---

## 6. Recommendations

### Keep
| Asset | Reason |
|-------|--------|
| `CLAUDE.md` | Comprehensive, current, authoritative |
| `.claude/settings.json` + `artifact-drift-check.sh` (Check 1 only) | Generated-artifact warning is genuinely useful |
| `AGENTS.md` | Correct workspace intent and documentation truth policy |
| `.agents/skills/doc-truth-audit/` | V2-native, used, correct |
| `.agents/skills/frontend-design/` | Useful for upcoming Smart Form V2 UI work |
| `docs/05_operations/agent_team_charter_v2_scoring_promotion.md` | Template value for future agent team runs |
| `docs/05_operations/agent_team_run_template.md` | Reusable 5-phase template |
| `docs/06_status/PROOF_TEMPLATE.md` | Active T1 governance |
| `docs/06_status/ROLLBACK_TEMPLATE.md` | Active T1 governance |
| `scripts/validate-env.mjs` | Wired to `pnpm env:check` |
| `scripts/kill-port.mjs` | Wired to Smart Form `predev` |
| `docs/ai_context/v2_truth_pack/` | Current, comprehensive, newly created |
| `~/.claude/.../memory/MEMORY.md` | Active session memory |

### Remove / Archive
| Asset | Reason |
|-------|--------|
| `skills-lock.json` + all 6 Vercel Labs entries | Zero relevance to V2 platform |
| `.agents/skills/web-design-guidelines/` | Vercel Labs generic skill; low V2 relevance |
| Per-week proof templates (`week_7`–`week_16` proof/rollback files) | Superseded by reusable templates; keep as historical archive in a subdirectory if desired, but remove from active status folder |

### Upgrade
| Asset | Change |
|-------|--------|
| `.claude/hooks/artifact-drift-check.sh` Check 2 | Replace watched files (`status_source_of_truth.md`, `current_phase.md`, `active_roadmap.md`) with `PROGRAM_STATUS.md` — these files are now superseded per `SPRINT_MODEL_v2.md` |
| `docs/06_status/system_snapshot.md` | Update "Current Stage" and "Snapshot Date" sections to reflect post-Week-21 reality; the evidence sections are valid historical record |
| `AGENTS.md` V1 gate reference | Verify `docs/03_contracts/domain_analysis_consumer_contract.md` exists; if not, update path to correct location |

### Add Now
| Asset | Rationale |
|-------|-----------|
| Fix `artifact-drift-check.sh` Check 2 (stale file watch) | Low-effort, prevents misleading hook feedback on every PROGRAM_STATUS.md edit |
| `.claude/commands/sprint-close.md` | Encodes the 8-step weekly close sequence as an invocable command — reduces friction and prevents missed steps |

### Add Later
| Asset | Rationale |
|-------|-----------|
| `scripts/generate-truth-pack.mjs` | Script that reads key source files and regenerates `docs/ai_context/v2_truth_pack/` stubs — prevents drift as system evolves |
| `scripts/proof-draft.mjs` | Queries live Supabase via REST API and generates a populated PROOF_TEMPLATE.md draft for the last proof run |
| `.claude/commands/verify-lifecycle.md` | Command that runs the verification checklist (DB query order, audit log checks, lifecycle chain) — currently implicit in CLAUDE.md |
| `doc-truth-audit` V2 scope expansion | Extend the PowerShell checker to verify settlement, lifecycle, and promotion doc claims — not just domain-analysis |
| Dream skill (see Section 7) | After clearer definition; not needed immediately |

---

## 7. Specific Answer: Dream Skill

**Does V2 already have anything like a Dream skill?** No. There is no skill, command, or workflow pattern named "Dream" or matching a canonical "Dream skill" definition anywhere in the repo.

**What "Dream skill" likely means in this context:**

Based on the trajectory of this conversation — agent teams, scoring alignment, truth packs — a "Dream skill" in V2 context most likely refers to a **target-state synthesis skill**: given verified current-state truth, generate a coherent specification of what the system *should* look like (the "dream state"). This fills the gap between a truth audit (what exists) and a contract (what to build next).

The closest thing V2 currently has is the **Phase B (Decision Handoff)** step in `agent_team_run_template.md` — the Lead Agent synthesizes audit findings and produces recommended changes. But this is embedded in the agent team run flow, not a standalone reusable skill.

**What exact problem would it solve in V2?**

The current flow is:
```
Truth audit → (gap) → Sprint contract → Implementation
```

The gap is: "we know what we have, but generating the target-state spec still requires a separate manual session." A Dream skill would make that synthesis step explicit, structured, and repeatable.

Concrete V2 use cases:
- After a truth audit like `v2_score_promotion_truth_audit.md`: generate a "Dream State" spec for what the scoring/promotion model should look like when fully built
- After the interim promotion policy: generate the permanent policy contract
- Before Smart Form V2: synthesize current intake gaps into a target-state requirements spec

**Should it be a skill, command, subagent, or doc/workflow pattern?**

For V2 right now: **a doc/workflow pattern first, then a skill.**

The reason: V2's current bottleneck is not lack of synthesis capability — it's lack of clear target-state specs. Before building the Dream skill infrastructure, the more valuable step is to write one Dream State spec for the scoring model (manually) and see what format works. Then encode that format into a reusable skill.

If it becomes a skill, it should be a **Phase B skill** in the agent team framework — invoked after Phase A (audit), producing a structured target-state document as its output artifact.

---

## 8. Specific Answer: Claude OS

**Is Claude OS currently part of V2?** Not by name. No "Claude OS" terminology, no imported Claude OS framework.

**Does V2 have equivalent governance?** Yes — and in several respects V2's model is more mature than a typical Claude OS setup:
- Risk-tiered sprint model (T1/T2/T3) with different governance requirements per tier
- Explicit lane discipline (implementation ≠ verification)
- Post-write hooks for drift detection
- Automated doc-truth gate for a specific doc surface
- Multi-agent team framework that has been executed in production
- Reusable proof/rollback templates

**Should Claude OS be brought over?** Partially, and selectively.

| Claude OS Component | Bring to V2? | Notes |
|--------------------|-------------|-------|
| Plan → implement → verify flow | Already present | V2 T1 sprints enforce this |
| Proof bundle capture | Already present | PROOF_TEMPLATE.md |
| Sprint governance gates | Already present | T1 automatic triggers |
| Issue/finding ledgers | Already present | PROGRAM_STATUS.md Open Risks |
| Status automation scripts | YES — add | Single highest-value gap |
| Context auto-generation | YES — add later | truth pack will drift without it |
| Custom commands for repeated workflows | YES — add 1-2 | `/sprint-close` would pay off immediately |
| Full "OS" orchestration layer | NO | Overkill — V2's governance model is already structured |
| Separate "Claude OS" config files | NO | CLAUDE.md already covers this territory |

**Smallest high-value version:**

Three additions that give most of the "Claude OS" benefit without importing complexity:
1. **Fix the stale hook** (1 edit) — immediate improvement to daily workflow
2. **Add `/sprint-close` command** (1 new file) — encodes the 8-step close sequence
3. **Add `scripts/proof-draft.mjs`** (1 new script, T3 sprint) — automates the most manual T1 step

These three additions fill the actual gaps. A full Claude OS import would mostly duplicate what already exists.

---

## 9. Final Recommendation

**Recommendation: Cleanup + Two targeted additions. Do not import Claude OS. Do not add Dream skill yet.**

### Immediate (this session or next):
1. **Fix `artifact-drift-check.sh`** — update the stale file watch list to reference `PROGRAM_STATUS.md`. Low effort, removes misleading hook output.
2. **Remove `skills-lock.json`** (or clear the Vercel Labs entries) — clean up irrelevant skills that have nothing to do with this platform.

### Next T3 sprint:
3. **Add `.claude/commands/sprint-close.md`** — encode the 8-step close sequence as a slash command. This is the highest-ROI addition for daily workflow.

### Later (when Smart Form V2 or scoring rebuild is scoped):
4. **Dream skill** — define the format via one manual target-state synthesis first, then encode as a reusable Phase B agent skill.
5. **`scripts/generate-truth-pack.mjs`** — prevents the `docs/ai_context/v2_truth_pack/` from drifting.

### Do not do:
- Import Claude OS wholesale
- Add governance ceremony beyond what T1/T2/T3 already provides
- Expand the doc-truth-audit scope until there's a specific failing claim to prevent
- Create agent charters before there's a defined audit task requiring one

**The V2 Claude workflow is already production-quality. The improvements needed are surgical, not architectural.**
