# UTV2-1569 Diff Summary

Issue: UTV2-1569
Branch: claude/utv2-1569-build-enforceable-fable-pilot-routing-cap-evidence-expiry

## Files changed

- `.claude/commands/dispatch.md` — Phase 4 (T1 planning) and Phase 5 (advisory review) now call `resolvePlanningModel()`/`resolveFableAdvisoryReview()` instead of a hardcoded `"sonnet"` literal
- `.claude/commands/three-brain.md` — new "Fable 5 pilot routing (bounded, UTV2-1569)" section: four ratified trigger classes, explicit skip list, mechanical eligibility gate, suspension/kill path, evidence requirements
- `docs/05_operations/FABLE_PILOT_CLOSEOUT_TEMPLATE.md` — new closeout packet template (per-task findings, aggregate metrics, fresh YES/NO/EXTEND decision packet)
- `docs/05_operations/FABLE_PILOT_ROLLBACK.md` — new documented two-part rollback procedure (mechanical + documentary)
- `docs/05_operations/FABLE_PILOT_STATE.json` — new protected-base pilot state file, ships at `status: "pending"` (NOT activated)
- `docs/05_operations/OPERATING_MODEL_SONNET5.md` — §1 Fable entry rewritten from "removed from active routing" to the bounded, mechanically-enforced pilot
- `docs/05_operations/agent-role-contracts.md` — model allowlist gains `claude-fable-5`
- `docs/05_operations/policies/fable-pilot-policy.json` — new canonical policy: trigger classes, skip list, caps, independent `pilot_enabled` kill switch
- `docs/05_operations/schemas/fable-review-v1.md` — new schema for the advisory Fable review comment format, mandatory `reviewer_independent_of_author: true`
- `docs/05_operations/schemas/lane_manifest_v1.schema.json` — new optional `planning_model_routing` block (Claude-only, mirrors `model_routing`'s shape inverted)
- `docs/governance/AGENT_SKILL_CONTRACTS.md` — `ClaudeModel` type union gains `claude-fable-5`
- `scripts/ops/contract-validator.ts` (+test) — `VALID_MODELS` gains `claude-fable-5` (forward-looking; no persistent agent contract declares it in this diff)
- `scripts/ops/fable-pilot-rollback.ts` (+test) — mechanical, idempotent rollback; proven (not asserted) to make Fable unselectable
- `scripts/ops/fable-pilot-state.ts` (+test) — fail-closed pilot state reader, pure cap-evaluation/state-transition helpers (activate/suspend/rollback/record-task)
- `scripts/ops/lane-start.ts` (+test) — new optional `--fable-trigger-class`/`--fable-rationale` flags resolve and persist `planning_model_routing`, Claude-only
- `scripts/ops/planning-model-routing.ts` (+test) — `resolvePlanningModel()`/`resolveFableAdvisoryReview()`, the sole functions `/dispatch` now calls
- `scripts/ops/shared.ts` (+test) — `planning_model_routing` manifest field, `createManifest`/`validateManifest` wiring
- `scripts/ops/truth-check-lib.ts` (+test) — `evaluateFableRoutingEvidence()`, integrated unconditionally into `runTruthCheck`

## What changed and why

Builds the mechanism the earlier doc-only pilot attempt (a now-closed, unmerged PR) was found to be missing: `/dispatch` hard-coded Sonnet regardless of the routing docs; the 8-task/30-day/usage-budget expiry could not mechanically fire; model/rationale/reviewer-independence were not captured as evidence; and the documented rollback did not cover the model allowlists it also touched.

## Known scope note

`docs/05_operations/LANE_MANIFEST_SPEC.md` was intentionally left untouched in this diff (a planned §17 addition documenting `planning_model_routing` was dropped) because a genuinely live, concurrently-running lane (UTV2-1571) held an active file-scope lease on that exact file at implementation time. The field is fully documented in `docs/05_operations/schemas/lane_manifest_v1.schema.json`'s JSON schema comments and in `three-brain.md`/`OPERATING_MODEL_SONNET5.md`'s Fable pilot sections instead. A follow-up doc-only addition to `LANE_MANIFEST_SPEC.md` §17 is recommended once UTV2-1571 closes.

## Pilot NOT activated

`docs/05_operations/FABLE_PILOT_STATE.json` ships with `"status": "pending"`, `"activated_at": null`. Every `resolvePlanningModel()`/`resolveFableAdvisoryReview()` call currently falls back to Sonnet regardless of trigger class. Starting the pilot's clock is a real operational decision reserved for Griff, not something this diff does.
