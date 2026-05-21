## Diff Summary — UTV2-1008

**Issue:** UTV2-1008 — Agent guarantee classification: ratify enforcement disposition for all agent/tooling surfaces
**Tier:** T2
**Branch:** claude/utv2-1008-agent-guarantee-classification
**Merge SHA:** (to be set post-merge)

### Changes

1. **`docs/05_operations/AGENT_TOOLING_CLASSIFICATION.md`** — Added PM-Ratified Enforcement Disposition section (UTV2-1008). Classifies prompt-only reviewers as advisory-only, CI/script tools as enforcement candidates, scheduled monitors, and persistent-service candidates (none approved). Updated Tracking Issues table with status column.

2. **`.claude/agents/ci-triage.md`** — Added ENFORCEMENT DISCLAIMER blockquote after frontmatter. Clarifies this agent is prompt-only, reactive diagnostic only, MUST NOT be cited as autonomous enforcement.

3. **`.claude/agents/codex-return-reviewer.md`** — Added ENFORCEMENT DISCLAIMER blockquote after frontmatter. Clarifies APPROVE/REJECT findings are recommendations only, not enforceable verdicts.

4. **`.claude/agents/pr-risk-reviewer.md`** — Added ENFORCEMENT DISCLAIMER blockquote after frontmatter. Clarifies RISK ratings are recommendations only, not enforceable verdicts.

### Impact

- No runtime code changed. Pure governance documentation and prompt-agent metadata.
- Closes the false-confidence gap where prompt-agent existence could be mistaken for enforcement.
- Establishes PM-ratified canonical record of which agents enforce vs. advise.
