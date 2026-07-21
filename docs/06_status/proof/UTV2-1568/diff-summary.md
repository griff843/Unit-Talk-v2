# UTV2-1568 Diff Summary

Issue: UTV2-1568
Branch: claude/utv2-1568-fable5-routing-reinstatement
PR: https://github.com/griff843/Unit-Talk-v2/pull/1287

## Files changed

- `.ops/sync/UTV2-1568.yml` — lane sync metadata
- `docs/06_status/lanes/UTV2-1568.json` — lane manifest
- `.claude/commands/three-brain.md` — Fable routing row updated to the bounded-pilot framing
- `docs/05_operations/OPERATING_MODEL_SONNET5.md` — §1 Fable entry rewritten as a bounded pilot (8 tasks/30 days, advisory-only, no T1-M vote); §7 precedent note and §8 model-routing bullet updated to match
- `docs/05_operations/agent-role-contracts.md` — model-ID list comment includes `claude-fable-5`
- `docs/governance/AGENT_SKILL_CONTRACTS.md` — `ClaudeModel` type union includes `claude-fable-5`, comment updated to pilot framing
- `scripts/ops/contract-validator.ts` — `VALID_MODELS` includes `claude-fable-5`, comment updated to pilot framing
- `docs/06_status/proof/UTV2-1568/{diff-summary.md,verification.md,evidence.json}` — this proof bundle

## What changed and why

Reverses UTV2-1390's removal of Fable 5 from active routing, but **only as a bounded, advisory-only
pilot** (8 qualifying real tasks or 30 calendar days, whichever first) — not a permanent
reinstatement. This is a direct revision after PM instruction: an earlier draft of this PR proposed
permanent reinstatement and passed two rounds of adversarial review under that framing; PM
instructed the framing itself be replaced with a bounded pilot before landing.

Grounding evidence for even opening the pilot: 5 controlled Unit-Talk-specific comparison tasks
(Fable 5 vs. the Sonnet-5 baseline, run 2026-07-21) found Fable materially stronger on judgment-heavy
synthesis and live-verification-driven root-cause work (not merely more verbose), and roughly tied
elsewhere — support for a narrow, bounded trial, not broad/default use.

## No implementation of permanent Fable routing

Nothing in this diff makes Fable a binding merge authority, a T1-M quorum voter, or a Rule 9
replacement. All existing escalation triggers fire exactly as before. Mechanical enforcement of the
pilot's own limits (8-task/30-day/budget counters) is not yet built — tracked as UTV2-1569 — and this
document says so plainly rather than claiming compliance that doesn't exist yet.
