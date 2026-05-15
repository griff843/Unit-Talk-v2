# Proof Bundle Standard — Unit Talk V2

**Status:** Canonical  
**Authority:** `docs/05_operations/EVIDENCE_BUNDLE_TEMPLATE.md`, `docs/governance/LANE_TAXONOMY.md`  
**Issued under:** UTV2-958  
**Effective:** 2026-05-15  

This document defines the required proof bundle structure for each of the eight lane types in Unit Talk V2. Its goal is to make completion evidence deterministic and machine-checkable across all lanes.

Implementation is not completion. A PR merged to `main` is not Done. Done requires proof that the change did what it claimed, tied to the exact merge SHA.

---

## Core principle: evidence is not narrative

"I verified this" is not proof. Proof is a machine-readable artifact tied to the merge SHA. Every proof format below specifies exactly what artifact must exist, what command produced it, and what a validator will check. If a required artifact cannot be produced mechanically, it is a waiver — and waivers require a named PM approver.

---

## Proof format reference

Three proof formats are used across lane types:

### Format A — Full evidence bundle (T1 mandatory)

File location: `docs/06_status/UTV2-###-EVIDENCE-BUNDLE.md`  
Template: `docs/05_operations/EVIDENCE_BUNDLE_TEMPLATE.md`  
Validator: `pnpm evidence:validate docs/06_status/UTV2-###-EVIDENCE-BUNDLE.md`

Required sections (in order):
1. `## Metadata` — issue ID, tier, owner, date, verifier identity, merge SHA, related PRs
2. `## Scope` — explicit claims and explicit non-claims
3. `## Assertions` — table with one row per assertion: assertion text, evidence type, source, result (PASS/FAIL/WAIVED), evidence ref
4. `## Evidence Blocks` — one `### E<n>` block per assertion; raw artifact (SQL+rows, test output, fixture hash, HTTP response)
5. `## Acceptance Criteria Mapping` — verbatim AC from Linear → assertion row number
6. `## Stop Conditions Encountered` — escalations, or the literal string `None`
7. `## Sign-off` — verifier name/lane and PM acceptance line

**Invalid bundle signals:**
- Any assertion row with `WAIVED` but no `approved by: <name>` in the row
- Any assertion row referencing a placeholder (`TODO`, `TBD`, `<fill-in>`, `FIXME`)
- `Verifier Identity` field is blank or the literal string `claude`
- No mapping rows in `## Acceptance Criteria Mapping`

### Format B — Simple proof file (T2 primary)

File location: `docs/06_status/proof/UTV2-###.md`  
Template: `docs/06_status/proof/PROOF-TEMPLATE.md`

Required sections:
- `# PROOF: UTV2-###`
- `MERGE_SHA: <exact SHA>`
- `ASSERTIONS:` — at least one `- [ ]` or `- [x]` item
- `EVIDENCE:` — at least one fenced code block with real command output

**Invalid proof file signals:**
- `MERGE_SHA` does not match current HEAD SHA
- Assertions or evidence blocks are empty
- Contains placeholder text
- Any required section is missing

### Format C — CI-only (T3)

No proof file required. Done gate is CI green on merge SHA plus `pnpm verify` pass. The PR body must include the R-level compliance output.

---

## Per-lane proof requirements

### 1. Runtime Lane

**Tier:** T1 mandatory  
**Proof format:** Format A (full evidence bundle) — required

**Required artifacts:**
| Artifact | Command | Location |
|---|---|---|
| Full evidence bundle | `pnpm evidence:new UTV2-###` (then populate) | `docs/06_status/UTV2-###-EVIDENCE-BUNDLE.md` |
| Live-DB proof | `pnpm test:db` (last 30 lines) | PR body `## Live-DB proof` section |
| R-level compliance | `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PR body `## R-level compliance` section |

**Required commands (all must pass before PR opens):**
```bash
pnpm verify          # full pipeline
pnpm test:db         # live Supabase
npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
pnpm evidence:validate docs/06_status/UTV2-###-EVIDENCE-BUNDLE.md
```

**Minimum acceptance criteria for bundle:**
- At least one `db-query` assertion proving the runtime state change (not just code presence)
- Every Linear AC mapped to an assertion row
- PM `t1-approved` label set on PR before merge

**Valid proof example:**
- Evidence bundle with 4 assertion rows (2 db-query, 1 test, 1 repo-truth), all PASS
- `pnpm test:db` 30-line output in PR body showing all tests green
- R-level output: `Verdict: PASS`
- PM `t1-approved` label on PR

**Invalid proof examples:**
- PR body contains "I manually verified the pick moved to `awaiting_approval`" with no db-query evidence
- Evidence bundle MERGE_SHA does not match the merge SHA (stale proof from branch HEAD)
- `pnpm test:db` output omitted from PR body
- Evidence bundle includes `approved by: TBD` in any waived row

---

### 2. Modeling Lane

**Tier:** T1 (live scoring path) or T2 (shadow-only)  
**Proof format:** Format A for T1; Format B for T2 shadow-only

**Required artifacts:**
| Artifact | Command | Location | Required when |
|---|---|---|---|
| Shadow scoring report | `npx tsx scripts/shadow-scoring-runner.ts --mode ci --output artifacts/shadow-report.json` | `artifacts/shadow-report.json` | Any scoring logic change |
| Live-data-lab output | `npx tsx scripts/live-data-lab-runner.ts` | `artifacts/live-data-lab-output.json` | When `r2-determinism` rule triggers |
| Full evidence bundle | `pnpm evidence:new UTV2-###` | `docs/06_status/UTV2-###-EVIDENCE-BUNDLE.md` | T1 only |
| Proof file | (Format B) | `docs/06_status/proof/UTV2-###.md` | T2 shadow-only |

**Required commands:**
```bash
pnpm verify
npx tsx scripts/shadow-scoring-runner.ts --mode ci --output artifacts/shadow-report.json
npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
# If T1: pnpm test:db
```

**Minimum acceptance criteria:**
- Shadow report shows before/after scoring distribution for affected picks (T2 shadow)
- Zero picks promoted to live path without explicit `shadow_mode = false` gate (must be locked during Phase 2)
- T1: full evidence bundle with db-query assertions for any live scoring path changes

**Valid proof example (T2 shadow):**
- Format B proof file with shadow report output embedded as evidence block
- R-level PASS output in PR body
- Shadow report diff shows expected scoring delta; no unintended picks promoted

**Invalid proof examples:**
- Shadow report omitted when scoring logic changed
- Assertion: "Model accuracy improved" — not tied to any artifact
- T1 issue with only Format B proof (evidence bundle required for T1)

---

### 3. Verification Lane

**Tier:** T2 or T3  
**Proof format:** Format A (if producing T1 evidence for another issue); Format B for own T2 coordination; Format C for T3 evidence-only

**Required artifacts:**
| Artifact | Required when |
|---|---|
| Evidence bundle for the target issue | Always — this is the lane's primary deliverable |
| Proof file for the verification lane itself | T2 verification coordination |
| `pnpm test:db` output | If target issue is T1 |

**Required commands:**
```bash
pnpm verify     # on the verification lane branch
pnpm test:db    # if target is T1
pnpm evidence:validate docs/06_status/UTV2-###-EVIDENCE-BUNDLE.md
```

**Minimum acceptance criteria:**
- Evidence bundle for the target issue passes `pnpm evidence:validate`
- Evidence bundle MERGE_SHA exactly matches the merge SHA of the target issue's PR (not the branch HEAD SHA)
- All Linear ACs from the target issue are mapped

**Valid proof example:**
- Evidence bundle for UTV2-NNN at `docs/06_status/UTV2-NNN-EVIDENCE-BUNDLE.md`
- `pnpm evidence:validate` exits 0
- PR body: "Evidence bundle validated. MERGE_SHA: `abc123`. Target issue: UTV2-NNN."

**Invalid proof examples:**
- Evidence bundle MERGE_SHA set to branch HEAD SHA instead of merge SHA
- Evidence bundle for target issue contains assertion rows with no evidence blocks
- "Verification complete" in PR body with no artifact reference

---

### 4. Hygiene Lane

**Tier:** T3 mandatory  
**Proof format:** Format C (CI-only)

**Required artifacts:**
| Artifact | Command | Location |
|---|---|---|
| R-level compliance output | `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PR body `## R-level compliance` |

**Required commands:**
```bash
pnpm verify     # must exit 0
npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD   # must be PASS; r0-ci only
```

**Minimum acceptance criteria:**
- `pnpm verify` green on merge SHA
- R-level check PASS with only `r0-ci` triggered (no r2, r3, r4 artifacts required)
- Diff review in PR body confirming zero behavioral changes (required — this is the anti-escalation gate)

**Valid proof example:**
- R-level: `Verdict: PASS / Rules matched: r0-ci`
- PR body includes diff summary: "Removes 3 unused imports; no behavioral changes"
- CI green on merge SHA

**Invalid proof examples:**
- R-level flags `r2-determinism` for a "hygiene" change — this escalates the lane to Modeling or Runtime
- PR body contains "refactored for clarity" with no diff confirmation of zero behavior change
- `pnpm verify` run only on branch HEAD, not on merge SHA

---

### 5. Migration Lane

**Tier:** T1 mandatory  
**Proof format:** Format A (full evidence bundle) — required, plus rollback drill

**Required artifacts:**
| Artifact | Command | Location |
|---|---|---|
| Full evidence bundle | `pnpm evidence:new UTV2-###` | `docs/06_status/UTV2-###-EVIDENCE-BUNDLE.md` |
| Live-DB proof | `pnpm test:db` (last 30 lines) | PR body `## Live-DB proof` |
| Rollback drill confirmation | Manual or scripted via `scripts/backup/` | Evidence bundle assertion row |
| Migration version audit | `node scripts/check-migration-versions.mjs` | Evidence bundle assertion row |
| Migration lint | `node scripts/lint-migrations.mjs` | Evidence bundle assertion row |

**Required commands:**
```bash
pnpm verify
pnpm test:db
node scripts/check-migration-versions.mjs
node scripts/lint-migrations.mjs
npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
pnpm evidence:validate docs/06_status/UTV2-###-EVIDENCE-BUNDLE.md
```

**Minimum acceptance criteria:**
- Rollback drill: a named person or script confirmed the migration can be rolled back, with the rollback method documented
- Migration version uniqueness: `check-migration-versions.mjs` exits 0
- DB smoke test green after migration applied
- Serial deploy order declared: if a prior migration must be applied first, it is named in the evidence bundle's scope section
- PM `t1-approved` label set before merge

**Valid proof example:**
- Evidence bundle with 5 assertions: migration file lint pass, version uniqueness, `pnpm test:db` pass, rollback drill confirmed (manual, approved by PM), schema shape query showing new column
- `pnpm test:db` output in PR body
- `## Serial deploy order: none required` in PR body

**Invalid proof examples:**
- "Migration applied successfully" with no `pnpm test:db` output
- Rollback drill waived with `approved by: TBD`
- Migration merged concurrently with a Runtime lane PR

---

### 6. Governance Lane

**Tier:** T3 default; T2 for constraint-tightening; Tier C for policy self-amendment  
**Proof format:** Format C (CI-only) for T3; Format B for T2; PM in-session for Tier C

**Required artifacts:**
| Artifact | Required when |
|---|---|
| R-level compliance output in PR body | Always |
| Governance review confirmation in PR body | Always |
| Format B proof file | T2 constraint-tightening |
| PM in-session explicit merge approval | Tier C (DELEGATION_POLICY.md or proof-coverage-guard paths) |

**Required commands:**
```bash
pnpm verify     # exits 0 (fast for docs-only)
npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
```

**Minimum acceptance criteria:**
- `pnpm verify` green
- PR body includes governance review confirmation: which invariants are affected, whether any runtime enforcement is needed
- If constraint-tightening: note which existing enforcement mechanism implements the new constraint, or open a follow-up issue if mechanical enforcement is not yet in place

**Valid proof example (T3 governance):**
- R-level: `Verdict: PASS / Rules matched: (none)`
- PR body: "No code changes. Governance review: taxonomy aligns with DELEGATION_POLICY.md Tier A/B/C definitions. No runtime enforcement changes required."

**Valid proof example (T2 constraint-tightening):**
- Format B proof file with assertion: "New constraint X is enforced by `proof-coverage-guard.yml` at line Y"
- Evidence block: grep output showing the constraint exists in the CI file

**Invalid proof examples:**
- Governance doc amends `DELEGATION_POLICY.md` without PM Tier C approval in-session
- PR body: "Updated docs" with no governance review confirmation
- Constraint added to docs but no check that mechanical enforcement exists or follow-up issue opened

---

### 7. Delivery/UI Lane

**Tier:** T2 default (member-visible); T3 for isolated non-member-facing scaffolding  
**Proof format:** Format B for T2; Format C for T3

**Required artifacts:**
| Artifact | Command | Required when |
|---|---|---|
| QA experience report | `pnpm qa:experience --regression --mode fast` | Any visual change or member-visible behavior change |
| Playwright screenshot evidence | `pnpm qa:experience` | Visual regression possible |
| R-level compliance output | `npx tsx scripts/ci/r-level-check.ts` | Always |
| Format B proof file | T2 | `docs/06_status/proof/UTV2-###.md` |

**Required commands:**
```bash
pnpm verify
pnpm qa:experience --regression --mode fast   # if visual changes
npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
```

**Minimum acceptance criteria:**
- QA experience report PASS if any member-visible behavior changes
- No deferred Discord channel activated (check `apps/discord-bot/src/` for `exclusive-insights`, `game-threads`, `strategy-room` references)
- For T2: Format B proof file with QA report evidence block

**Valid proof example (T2 Delivery/UI):**
- Format B proof file: MERGE_SHA correct, assertions include "QA experience report PASS", evidence block shows report output
- PR body: R-level PASS, "No new delivery targets activated"

**Invalid proof examples:**
- Visual change merged without QA experience report
- Discord channel wiring change without PM in-session confirmation
- T2 member-visible change using Format C (CI-only) — Format B is required

---

### 8. Data/Canonical Lane

**Tier:** T1 (live canonical data) or T2 (reference-only)  
**Proof format:** Format A for T1; Format B for T2

**Required artifacts:**
| Artifact | Command | Required when |
|---|---|---|
| Full evidence bundle | `pnpm evidence:new UTV2-###` | T1 |
| Database truth query output | db-query via Supabase MCP or `pnpm test:db` | Always |
| R-level compliance output | `npx tsx scripts/ci/r-level-check.ts` | Always |
| Format B proof file | T2 | `docs/06_status/proof/UTV2-###.md` |

**Required commands:**
```bash
pnpm verify
pnpm test:db            # for T1 or any canonical table change
npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
# T1: pnpm evidence:validate
```

**Minimum acceptance criteria:**
- At least one db-query assertion proving the canonical data state after change
- No live DB row mutations outside the normal write path (always-escalate if present)
- For `provider_market_aliases`, `market_type_id`, or canonical offer tables: `pnpm test:db` required regardless of tier

**Valid proof example (T2 reference-only):**
- Format B proof file: MERGE_SHA correct, assertion "provider alias backfill applied to N rows", evidence block shows `SELECT count(*)` result
- `pnpm test:db` output in PR body

**Invalid proof examples:**
- Live DB row mutation without PM in-session escalation
- Canonical data change with no db-query evidence (narrative claim only)
- T1 canonical data change using only Format B (evidence bundle required)

---

## Proof bundle summary table

| Lane | Tier | Format | Key artifacts | PM gate? |
|---|---|---|---|---|
| Runtime | T1 | A (bundle) | Evidence bundle, `pnpm test:db`, R-level | Yes (`t1-approved` label) |
| Modeling | T1/T2 | A or B | Shadow report, evidence bundle (T1), proof file (T2) | T1: yes |
| Verification | T2/T3 | A or B | Evidence bundle for target issue | T1 target: yes |
| Hygiene | T3 | C (CI-only) | R-level PASS, diff summary | No |
| Migration | T1 | A (bundle) | Evidence bundle, rollback drill, `pnpm test:db`, version check | Yes (`t1-approved` label) |
| Governance | T3/T2 | C or B | R-level PASS, governance review note | Tier C: yes (in-session) |
| Delivery/UI | T2/T3 | B or C | QA experience report (T2), R-level | T2 member-visible: yes |
| Data/Canonical | T1/T2 | A or B | db-query truth, evidence bundle (T1), proof file (T2) | T1: yes |

---

## What makes proof invalid (universal rules)

These signals make any proof bundle invalid regardless of lane type:

1. **Stale SHA** — MERGE_SHA set to branch HEAD SHA, not the merge SHA after the PR merges
2. **Placeholder text** — any `TODO`, `TBD`, `<fill-in>`, `FIXME` in an assertion or evidence block
3. **Narrative-only assertion** — "I confirmed the feature works" with no artifact
4. **Missing acceptance criteria mapping** — Linear ACs not traced to assertion rows (Format A only)
5. **Anonymous waiver** — `WAIVED` row without `approved by: <name>`
6. **Unqualified verifier identity** — `claude` or blank (must be `claude/<session-id>` or human name)
7. **Missing mandatory artifact** — e.g., no `pnpm test:db` for T1, no shadow report for modeling changes
8. **Format mismatch** — T1 issue using Format B (CI-only) or Format C proof

---

## Proof bundle lifecycle

```
Branch open → implementation → pnpm verify (green) → proof artifacts generated
→ PR opened → proof artifacts linked in PR body → merge SHA known
→ proof bundle updated with merge SHA → validator run → pm gate (T1)
→ merge to main → lane manifest updated → ops:truth-check pass → Done
```

Proof artifacts must be updated with the merge SHA **after** the PR merges. A proof tied to the branch HEAD SHA is stale and invalid.

---

## Authoritative references

- `docs/05_operations/EVIDENCE_BUNDLE_TEMPLATE.md` — Format A template and validator rules
- `docs/06_status/proof/PROOF-TEMPLATE.md` — Format B template
- `docs/governance/LANE_TAXONOMY.md` — lane type definitions
- `docs/governance/LANE_CONCURRENCY_POLICY.md` — concurrency rules
- `docs/05_operations/DELEGATION_POLICY.md` — tier authorization and PM gate policy
- `docs/05_operations/TRUTH_CHECK_SPEC.md` — done-gate mechanics
