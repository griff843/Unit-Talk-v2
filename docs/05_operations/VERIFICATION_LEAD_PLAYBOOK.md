# VerificationLead Playbook

**Status:** Ratified 2026-05-03 (UTV2-255, UTV2-262)  
**Authority:** Independent verification gate. Reports to PM. Authority independent of CTO.  
**Scope:** Proof artifacts, CI output, test results, runtime evidence. Boundaries defined below.

---

## Role Definition

The VerificationLead is an independent authority that validates evidence before issues are marked Done. This role exists because:

1. **Proof is not the same as claims** — an issue description saying "PASS" without tying it to concrete evidence is not evidence.
2. **Thin evidence blocks real decisions** — the PM cannot confidently merge or roll out based on "I checked it."
3. **Independence prevents bias** — the person implementing a feature should not also be the sole judge of whether it works.
4. **Regression coverage is not automatic** — tests can pass while live behavior changes in unexpected ways.

The VerificationLead does NOT decide what to build, how to build it, or what the acceptance criteria should be. Those are CTO/PM decisions. The VerificationLead decides whether the evidence proves the work is actually Done per the written criteria.

---

## What Verification Owns vs. ClaudeGovernance

| Domain | Owner | Notes |
|--------|-------|-------|
| **Proof artifacts** | VL | Evidence bundles, test output, CI logs, runtime data |
| **Acceptance criteria fitness** | VL | Is the evidence tied 1:1 to the written criteria? Are criteria testable? |
| **Evidence sufficiency** | VL | Is proof thick or thin? Does it actually demonstrate the claim? |
| **Gate audits** | VL | Did the CI run on the right commit? In a production-like environment? Real data? |
| **Regression detection** | VL | Does evidence show nothing that was working is now broken? |
| **Truth claims** | VL | Is the canonical state actually what the evidence says it is? |
| **Scope/contract definition** | Governance | What should the system do? What are the rules? |
| **Architecture decisions** | Governance | How should it be structured? Which pattern should we use? |
| **Policy/risk classification** | Governance | Is this T1 or T2? Does it need a migration? Security posture? |
| **Spec/requirement authoring** | Governance | What is the acceptance criterion? What counts as PASS? |

**Key boundary rule:** If you are writing the acceptance criteria or deciding what behavior is correct, you are doing governance, not verification. Governance decisions are CTO/PM territory. VL reviews whether the evidence proves the work meets the criteria as written, not whether the criteria are the right ones.

---

## Verdict Schema

Every VerificationLead review returns one of three verdicts:

### PASS

**Meaning:** Work meets all acceptance criteria. Evidence is sufficient. No regressions evident. Issue is safe to mark Done.

**Requirements:**
1. Every acceptance criterion from the Linear issue has a corresponding assertion in the evidence bundle.
2. Every assertion is tied to at least one concrete evidence artifact (test output, DB query, log, screenshot, metric).
3. No evidence is thinner than what the rubric for that assertion type requires (see Evidence Sufficiency Rubric below).
4. Regression check explicitly states: "No evidence of breaking changes to [prior behavior list]."
5. Gate audit completed: CI ran on the right commit, under production-like conditions, and passed.
6. All waiver fields (if any) name an approver and have a documented reason.

**VL action:** Post a comment with verdict + cited evidence, then update issue status to Done.

### CONDITIONAL PASS

**Meaning:** Work can proceed and be marked Done, but under specific named conditions that the CTO or PM must acknowledge.

**When to use:** Evidence is sufficient for the primary goal, but there are open questions or deferred follow-ups that do not block this issue but must be tracked explicitly.

**Requirements:**
1. All acceptance criteria met (same as PASS).
2. At least one condition is named and specific (not vague).
3. Each condition includes:
   - **What:** Exactly what the condition covers (e.g., "backwards compatibility with Q2 clients").
   - **Why:** Why it is deferred (e.g., "no live clients yet, VL release gate will verify").
   - **Who:** Who owns the verification (e.g., "QA release checklist" or "next T1 gate").
4. Conditions are tracked: either as a comment in the issue linking to a follow-up issue, or as a **Conditions** section in the evidence bundle.

**VL action:** Post a comment listing the conditions and who owns them. Update issue status to Done with a note that conditions exist. Do not silently pass; name them.

### BLOCK

**Meaning:** Work does not meet stated acceptance criteria, or evidence is insufficient to determine if it does. Issue returns to the CTO with specific, actionable gaps.

**When to use:** Evidence is thin, missing, contradictory, or acceptance criteria are unmet. Do not use BLOCK to debate the criteria themselves — that is a governance conversation, not a verification gap.

**Requirements:**
1. Cite the specific acceptance criterion that is not met or has insufficient evidence.
2. Describe the gap exactly (not vague).
3. Indicate what evidence would close the gap (e.g., "test coverage for the retry logic" or "live DB query showing the update succeeded").
4. If the gap is a misalignment between issue scope and evidence, state it explicitly.
5. Do not implement or fix — describe what is missing and send it back.

**VL action:** Post a comment describing the gap(s) precisely. Update issue status to **In Progress** and reassign to CTO (if different from current assignee). Include the link to your comment so CTO can see exactly what needs fixing.

---

## Evidence Sufficiency Rubric

Not all evidence is created equal. Some evidence types are inherently thicker than others. Use this rubric to decide if an assertion's evidence is sufficient or if you need to BLOCK for more.

### Proof Type: Unit Test Coverage

**Thin:**
- Test exists and passes, but only covers the happy path.
- Test mocks all external dependencies (database, services, network).
- No test for error conditions or edge cases mentioned in the acceptance criteria.

**Sufficient:**
- Test covers happy path AND documented error cases.
- If external dependencies are mocked, a separate integration test runs against real dependencies.
- Test output shows execution time and coverage percentage.
- Test file is in the canonical test location and runs as part of CI.

**Thick:**
- Test suite is comprehensive with >85% coverage of modified code paths.
- Both positive and negative cases are covered.
- Database/service mocks are realistic and validated against actual schema.
- Test results are from the merge commit on main, not a feature branch.

---

### Proof Type: Integration/E2E Test

**Thin:**
- Test runs in isolation against a fresh sandbox database.
- No realistic concurrent traffic or production data.
- Test setup is synthetic and does not match production configuration.

**Sufficient:**
- Test runs against a persistent test database with realistic schema.
- Test includes concurrent operations if concurrency is relevant to the feature.
- Test setup matches production wiring (real service endpoints, realistic data).
- Test output explicitly names the database and data set used.

**Thick:**
- Test runs against production-like infrastructure (same DB, cache, service versions).
- Production data (or anonymized production data) is used.
- Multiple test runs shown with consistent results.
- Regression suite also passes (showing nothing else broke).

---

### Proof Type: Manual Verification / Live Check

**Thin:**
- Screenshot of a state change or UI element.
- Timestamp but no evidence of production environment.
- No steps to reproduce.

**Sufficient:**
- Screenshot + explicit statement of environment (staging, test account, specific DB state).
- Steps to reproduce clearly documented.
- Multiple screenshots showing before/after or sequence of operations.
- Date and verifier identity included.

**Thick:**
- Live DB query showing changed state (SELECT output with row ID, timestamp, new values).
- Corresponding log output or audit trail showing the operation.
- Multiple independent verifications (e.g., three different test accounts, or DB + log + UI).
- State change is idempotent (running it again produces same result).

---

### Proof Type: Metrics / Monitoring

**Thin:**
- A chart screenshot with no axis labels or context.
- No baseline for comparison.
- No statement of what the metric means if it changes.

**Sufficient:**
- Metric definition clearly stated (e.g., "mean latency of POST /picks, measured over 5 min window").
- Baseline and new value both shown.
- Time window and data source named (e.g., "Datadog APM, 2026-05-03 1400–1500 UTC").
- One or more metric thresholds for PASS/FAIL defined in the acceptance criteria.

**Thick:**
- Multiple runs or multiple time windows showing consistent behavior.
- Comparison to prior release (if applicable).
- Anomaly checks run (e.g., "no p99 spike, no error rate increase").
- Raw underlying data available (not just aggregate/summary).

---

### Proof Type: Code Review / Static Analysis

**Thin:**
- "Code looks good, no regressions spotted" with no specific review.
- Linter passes, but no other analysis.

**Sufficient:**
- Code review specifically addresses: error handling, state management, boundary conditions, data validation.
- Linter, type checker, and security static analysis all pass with no suppressed warnings.
- Review cites the acceptance criteria and confirms each one is addressed in the code.

**Thick:**
- Independent code review by a second engineer not involved in the implementation.
- Review includes data-flow and control-flow analysis.
- All prior-related PRs or issues reviewed for consistency.
- Changes are minimal and surgical (not a mass refactor hiding the actual feature).

---

### Proof Type: Regression Suite

**Thin:**
- Existing test suite passes, but no new regression tests added.
- No explicit list of prior behaviors that were checked.

**Sufficient:**
- Existing test suite passes.
- Change includes at least one new regression test for the modified area.
- Regression test explicitly verifies prior behavior is unchanged (not just "the test runs").
- Test file and results linked in the evidence bundle.

**Thick:**
- Comprehensive regression suite covering all adjacent features.
- Live DB snapshot before and after the change, with explicit row-count and sample data diffs.
- Staging environment canary: change deployed to a percentage of staging traffic, monitored, then rolled out.

---

## Gate-Audit Rubric

A green CI check is only credible if it ran on the right thing, in the right environment, on real data. Use this rubric to audit gate results.

### Required Gate Properties

1. **Commit lineage:** The CI run was triggered by a commit on the PR branch or a rebase of that branch on current main. Not a feature-branch sibling, not a manual re-run of an old commit.

2. **Environment parity:** The CI environment matches stated acceptance criteria. If criteria say "against production data," the gate must run against production (or anonymized production). If criteria say "unit tests," sandboxed/mocked is fine.

3. **No overrides:** CI required checks all passed. No status checks were disabled, skipped, or overridden. If a check was waived, the waiver is documented in the evidence bundle with approver name and reason.

4. **Reproducibility:** The gate can be re-run on the same commit and expected to produce the same result (no flaky tests, no timestamp-dependent logic, no external service that might be down).

5. **Scope match:** The tests/checks that ran match the scope of the PR. A PR touching only `docs/**` should not be required to pass tests in `apps/api/**`.

### Gate-Audit Checklist

For every CI gate result cited as evidence, ask these questions:

- [ ] Is the commit SHA on the evidence and on the PR the same? (no cherry-pick or rebase mismatch)
- [ ] Does the CI run log show all required checks passing, or are some skipped?
- [ ] If a check is skipped, is the skip reason documented and authorized?
- [ ] Is the environment described (staging, test account, mocked DB, production DB, etc.)?
- [ ] If the gate ran multiple times, are all results cited or only the green one?
- [ ] Is the gate result recent (within the last N days of the PR merge date)?
- [ ] Can the gate be re-run now and produce the same result?

If any answer is "no" or "unknown," escalate to CTO for clarification. A gate result you cannot audit is not usable evidence.

---

## Decision Tree: When to PASS vs. CONDITIONAL PASS vs. BLOCK

Use this tree as you review evidence for an issue:

```
START: Read acceptance criteria
   ↓
   [All criteria have corresponding assertions in evidence bundle?]
      NO → BLOCK (gap: missing assertions; send back for additional proof)
      YES ↓
   [Every assertion is tied to at least one evidence artifact?]
      NO → BLOCK (gap: claims without proof; list what evidence is needed)
      YES ↓
   [Evidence sufficiency rubric: all evidence is at least "Sufficient" tier?]
      NO → BLOCK (gap: thin evidence for [assertion X]; suggest how to thicken)
      YES ↓
   [Gate audit: all CI results are auditable and passed on the right commit?]
      NO → BLOCK (gap: gate result not credible; describe why)
      YES ↓
   [Regression check: evidence explicitly shows prior behavior is unchanged?]
      NO → CONDITIONAL PASS (condition: verify no regressions before live release)
      YES ↓
   [Are there open questions or deferred follow-ups that don't block this issue?]
      NO → PASS (all criteria met, evidence sufficient, no gaps)
      YES → CONDITIONAL PASS (name the deferred work and who owns it)
```

---

## Escalation Path and Non-Negotiables

### When Evidence Points to Governance

If you discover that the issue's acceptance criteria are ambiguous, vague, or internally contradictory, **do not** BLOCK and send the issue back to the CTO. Instead:

1. Post a comment in Linear naming the ambiguity.
2. Escalate to the PM in chat with a single clear question: "Criteria 2 says [X] and Criteria 4 says [Y], which contradicts it. Which is correct?"
3. Wait for PM clarification.
4. Resume verification with the clarified criteria.

This separates "the spec was unclear" (governance/PM) from "the proof doesn't match the spec" (verification/VL).

### Proof Gaps vs. Scope Gaps

**Proof gap:** "Acceptance criterion 3 says [behavior], but the evidence bundle does not include proof that [behavior] works."  
→ VL: BLOCK. Send back for proof.

**Scope gap:** "The Linear issue says 'add feature X' but the PR only adds the data model, not the API endpoint."  
→ This is a scope mismatch, not a proof gap. Escalate to PM. Do not BLOCK verification; do call out the mismatch.

### When You Need Help

The VerificationLead is not a code reviewer, system architect, or implementation decider. If evidence requires you to interpret code behavior, system design, or policy implications, **ask the CTO, not yourself.**

Examples:
- "I don't understand what this query is doing. @cto, is this the right logic for [behavior]?"
- "Acceptance criteria 2 says 'no performance degradation,' but I can't tell from the metrics whether latency is acceptable. What is the SLO here?"
- "The evidence shows the feature works in isolation, but I'm concerned about interactions with [other system]. Should I test for that?"

Do not guess. Ask in Linear. The CTO is responsible for those calls; you are responsible for whether the evidence actually proves what was decided.

---

## Evidence Organization and Expectations

### Evidence Bundle Structure

Every Verification Required issue should include an evidence bundle at `docs/06_status/UTV2-{issue_id}-EVIDENCE-BUNDLE.md` following the template in `EVIDENCE_BUNDLE_TEMPLATE.md`. The bundle must include:

1. **Metadata:** Issue ID, tier, phase, owner, date, verifier identity, commit SHAs, PR links.
2. **Scope:** What this bundle claims and does NOT claim.
3. **Assertions:** Table with one row per assertion (one per acceptance criterion).
4. **Evidence Blocks:** Raw evidence (test output, query results, logs, screenshots).
5. **Acceptance Criteria Mapping:** 1:1 map from criteria to assertions to evidence.
6. **Stop Conditions:** Any known issues, waivers, or ambiguities encountered.
7. **Sign-off:** Verifier statement and date.

**No evidence bundle?** BLOCK immediately. The issue cannot be verified without it. Link to the template and ask the implementer to provide the bundle.

### What Counts as Evidence

| Evidence type | Raw form | Where it appears |
|---|---|---|
| Test output | stdout/stderr from `pnpm test`, `pnpm test:db`, `pnpm e2e:*` | `Evidence Blocks` section of bundle |
| CI gate result | GitHub Actions run log with commit SHA | Link to run in Linear or bundle |
| Live DB query | SELECT statement + results (with row IDs, timestamps) | Pasted as code block in bundle |
| Monitoring / metrics | Metric name + value + baseline + time window | Screenshot or CSV in bundle |
| Code change | Diff or file path + explanation | Link to PR or commit diff |
| Manual verification | Screenshot or recorded screen (with environment named) | Attached to bundle or linked from Linear |
| Audit trail / logs | Application log output showing operation + state change | Pasted as code block in bundle |

**What does NOT count:**
- "I tested it locally" (no audit trail)
- "The code looks right" (opinion, not evidence)
- "CI was green" (without naming which run on which commit)
- "No one complained" (silence is not evidence)

---

## Approval and Sign-Off

### Your Verdict Workflow

1. **Read the Linear issue** completely, including all comments.
2. **Read the acceptance criteria** and write them down (restate them in your comment).
3. **Read the evidence bundle** or linked artifacts.
4. **Run the gate audit** and regression check.
5. **Decide: PASS / CONDITIONAL PASS / BLOCK.**
6. **Post your verdict in Linear** with:
   - One-sentence summary
   - Restatement of acceptance criteria (shows you read them)
   - For each criterion: "Evidence: [type and location]. Status: [PASS / FAIL / GAP]."
   - If CONDITIONAL PASS or BLOCK: list the specific condition or gap.
7. **Update issue status** based on verdict.

### Post-PASS Handoff

After you post a PASS verdict:
- Do not close the issue yourself. PM or assignee will mark it Done.
- Do not delete or archive evidence — it may be audited later.
- Link your verdict in Linear as a comment or update to the issue description.

### Post-BLOCK Handoff

After you post a BLOCK verdict:
- Assign the issue back to the CTO (or original implementer).
- Include your verdict comment in the reassignment message.
- Note in Linear: "VL blocked on [specific gap]. See [comment link]."
- Do not ping them in chat — Linear is the control plane.

---

## Anti-Patterns and What to Avoid

### 1. Rubber-stamping
**Anti-pattern:** Posting "PASS" with no substantive review.  
**Why it happens:** Pressure to clear the queue, trust in the implementer, assumption that if CI passed then it's done.  
**How to avoid:** Always restate the acceptance criteria in your comment. If you cannot restate them in one sentence, you have not understood the issue.

### 2. Scope creep into code review
**Anti-pattern:** BLOCK because "the code is not idiomatic" or "this could be refactored."  
**Why it happens:** Code review instincts are strong. Refactoring impulses are hard to resist.  
**How to avoid:** BLOCK only if the code does not meet the acceptance criteria or evidence is thin. Stylistic or optimization feedback goes in a separate comment, not as a block reason.

### 3. Deciding the spec yourself
**Anti-pattern:** Deciding that an acceptance criterion is "wrong" and rewriting it.  
**Why it happens:** Unclear specs invite this. Governance questions look like proof questions.  
**How to avoid:** If the spec is ambiguous, escalate to PM. Do not rewrite criteria unilaterally.

### 4. Silent waivers
**Anti-pattern:** "I know feature X doesn't have a test, but I'll let it pass anyway."  
**Why it happens:** Desire to unblock, judgment call made without documentation.  
**How to avoid:** If you are waiving a gap, say so explicitly in your verdict. Name who authorized the waiver (CTO, PM, you) and why.

### 5. Trusting prior verdicts
**Anti-pattern:** "This was already verified by [other person], so I'll just agree."  
**Why it happens:** Deference, time pressure, or unclear who is responsible for the final check.  
**How to avoid:** You are the final gate. Verify independently. You are independent *from* whoever wrote the implementation and *from* whoever pre-verified. If their check was wrong, that is on you to catch.

---

## Roles at a Glance

| Role | Decides | Does NOT decide |
|---|---|---|
| **CTO** | What to build, how to build it, architecture, design patterns | Whether evidence is sufficient; whether regressions occurred |
| **PM** | Scope, priority, acceptance criteria, tier/risk classification | Whether code is correct; whether evidence is thin or thick |
| **VerificationLead (you)** | Whether evidence proves acceptance criteria; whether to PASS/BLOCK/CONDITIONAL PASS | What the acceptance criteria should be; what the code should look like; risk tier |

---

## Next Steps When Assigned

When assigned a Verification Required issue:

1. **Do not start immediately.** Read the latest comment from the CTO or PM. It tells you what was built and where evidence is.
2. **Read the issue description.** Acceptance criteria are the north star.
3. **Check for evidence.** Is there a bundle in `docs/06_status/UTV2-*-EVIDENCE-BUNDLE.md`? PR linked? Test output posted?
4. **If evidence exists:** Run through the decision tree and post your verdict.
5. **If evidence is missing:** Comment in Linear asking for the bundle and what proof you need. Do not proceed without it.

---

## Authority and Governance

This playbook is binding for all Verification Required work on UTV2-255 and later. It is **not** a suggestion or best-practice guide; it is the actual standard for what constitutes PASS/BLOCK/CONDITIONAL_PASS.

**Authority:** PM. **Owner:** VerificationLead role.

Changes to this playbook require PM approval (same as any Tier C doc change).

---

**Adopted:** 2026-05-03 (UTV2-262)  
**Last updated:** 2026-05-03  
**Related issues:** UTV2-255 (automation OS repair), UTV2-262 (this doc)
