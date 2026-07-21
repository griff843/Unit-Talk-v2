# Schema: fable-review/v1

> Comment schema for a Fable 5 pilot advisory review claim (UTV2-1569). Posted on PRs
> or Linear issues by the `.claude/agents/fable-pilot-reviewer.md` subagent, or by an
> orchestrator session reporting a Fable planning/review pass.
> Validated (advisory only, non-blocking) by `ops:truth-check` for any lane whose
> manifest carries a `planning_model_routing` block with `model: "claude-fable-5"`.
> Not validated by `.github/workflows/merge-gate.yml` — this schema never gates merge.

## What this is not

This is **not** a merge authority, **not** a `pm-verdict/v1` substitute, and **never**
counts as a vote in any T1-M quorum. A `fable-review/v1` comment is advisory input to
Griff's decision or to the implementing lane's own revision — nothing more. See
`docs/05_operations/OPERATING_MODEL_SONNET5.md` §1 and
`.claude/commands/three-brain.md`'s Fable pilot routing section.

## Format

```
FABLE_REVIEW: ADVISORY
schema: fable-review/v1
Issue: UTV2-###
Trigger class: repeated_architecture_bounce | live_state_root_cause | product_synthesis_no_precedent | build_mode_certification_review
Policy version: <fable-pilot-policy.json policy_version at time of review>
Reviewed head SHA: <exact 40-char SHA the review was performed against>
binding: false
advisory_only: true
reviewer_independent_of_author: true

Findings:
- <specific, actionable finding, or "none">

Owner questions:
- <a question this review raised for Griff that would not otherwise have been raised, or "none">
```

## Validation Rules

1. Line 1 must be exactly `FABLE_REVIEW: ADVISORY` (there is no other verdict value —
   Fable never returns APPROVE/REJECT/BLOCK; that would imply binding authority it does
   not have).
2. Line 2 must be exactly `schema: fable-review/v1`.
3. `Issue:` must match `UTV2-\d+`.
4. `Trigger class:` must be exactly one of the four ratified pilot classes in
   `docs/05_operations/policies/fable-pilot-policy.json`'s `trigger_classes`. Any other
   value (including a plausible-sounding invented class) fails validation.
5. `Policy version:` must be present and is checked by `ops:truth-check` against the
   current `fable-pilot-policy.json`'s `policy_version` for drift detection.
6. `Reviewed head SHA:` must be present and exactly match the PR's evaluated head SHA —
   same binding discipline as `pm-verdict/v1`'s `Head SHA:` field. A review bound to a
   stale head is not valid evidence for the current head.
7. `binding: false` and `advisory_only: true` must be present and literally `false`/`true`
   — this is not configurable per review; a comment that flips either value is
   malformed, not a more assertive review.
8. `reviewer_independent_of_author: true` is **mandatory, with no override**. A
   `fable-review/v1` comment missing this line, or asserting `false`, is invalid
   evidence — `ops:truth-check`'s Fable-routing check (see
   `scripts/ops/truth-check-lib.ts`) treats it the same as no review having happened at
   all. Reviewer independence means the reviewing identity did not author the material
   change under review and did not curate the framing the reviewer saw (it reviews
   `git diff main`, not an author-selected summary).

## Authorization

Any identity may post this comment — it carries no merge authority, so there is no
CODEOWNERS restriction the way `pm-verdict/v1` has. What matters is `Reviewed head SHA:`
binding and `reviewer_independent_of_author: true`, both mechanically checked.

## Integration with truth-check

For any lane manifest whose `planning_model_routing.model` is `claude-fable-5`,
`ops:truth-check` requires at least one valid `fable-review/v1` comment (or an
equivalent evidence-bundle entry) bound to the reviewed head SHA, with
`reviewer_independent_of_author: true` asserted. Missing, malformed, or non-independent
evidence fails the lane's Fable-routing check — this is a fail-closed gate on the
*evidence*, not a re-litigation of the pilot's eligibility (which was already decided at
routing time by `scripts/ops/planning-model-routing.ts`).
