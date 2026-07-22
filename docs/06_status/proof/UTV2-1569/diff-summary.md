# UTV2-1569 Diff Summary

Issue: UTV2-1569
Branch: claude/utv2-1569-build-enforceable-fable-pilot-routing-cap-evidence-expiry

## Files changed

- `.claude/commands/dispatch.md` — Phase 3 (lane-start) resolves+persists `planning_model_routing` BEFORE the manifest is handed to Phase 4; Phase 4 reads it instead of re-resolving; Phase 5 advisory review calls the record-on-selection function
- `.claude/commands/three-brain.md` — "Fable 5 pilot routing (bounded, UTV2-1569)" section, updated to describe the corrected atomic resolve+record ordering
- `docs/05_operations/FABLE_PILOT_CLOSEOUT_TEMPLATE.md` — closeout packet template (per-task findings, aggregate metrics, fresh YES/NO/EXTEND decision packet)
- `docs/05_operations/FABLE_PILOT_ROLLBACK.md` — documented two-part rollback procedure (mechanical + documentary)
- `docs/05_operations/FABLE_PILOT_STATE.json` — protected-base pilot state file, ships at `status: "pending"` (NOT activated)
- `docs/05_operations/OPERATING_MODEL_SONNET5.md` — §1 Fable entry, updated to describe the corrected atomic resolve+record architecture
- `docs/05_operations/agent-role-contracts.md` — model allowlist gains `claude-fable-5`
- `docs/05_operations/policies/fable-pilot-policy.json` — canonical policy: trigger classes, skip list, caps (now including `estimated_usage_per_task_usd`), independent `pilot_enabled` kill switch
- `docs/05_operations/schemas/fable-review-v1.md` — schema for the advisory Fable review comment format, mandatory `reviewer_independent_of_author: true`
- `docs/05_operations/schemas/lane_manifest_v1.schema.json` — optional `planning_model_routing` block (Claude-only, mirrors `model_routing`'s shape inverted)
- `docs/governance/AGENT_SKILL_CONTRACTS.md` — `ClaudeModel` type union gains `claude-fable-5`
- `package.json` — `test:ops` script wired to run the 3 new test files (PM_VERDICT required correction)
- `scripts/ops/contract-validator.ts` (+test) — `VALID_MODELS` gains `claude-fable-5` (forward-looking; no persistent agent contract declares it in this diff)
- `scripts/ops/fable-pilot-rollback.ts` (+test) — mechanical, idempotent rollback; proven (not asserted) to make Fable unselectable
- `scripts/ops/fable-pilot-state.ts` (+test) — fail-closed pilot state reader; `validateActivationDates()` + `PILOT_DATES_INVALID` for missing/malformed/inconsistent activation windows; pure cap-evaluation/state-transition helpers (activate/suspend/rollback/record-task)
- `scripts/ops/lane-start.ts` (+test) — `--fable-trigger-class`/`--fable-rationale` flags call `resolveAndRecordPlanningModel()`, atomically resolving AND recording the qualifying task/usage before the manifest is written
- `scripts/ops/planning-model-routing.ts` (+test) — `resolveAndRecordPlanningModel()`/`resolveAndRecordFableAdvisoryReview()`, the sole functions that select Fable AND record against pilot state in one operation; `estimated_usage_per_task_usd` policy field
- `scripts/ops/shared.ts` (+test) — `planning_model_routing` manifest field, `createManifest`/`validateManifest` wiring
- `scripts/ops/truth-check-lib.ts` (+test) — `findLatestFableReview()` (real, structurally-validated `fable-review/v1` parser, SHA-bound to the reviewed PR head) replaces the original loose regex-based `evaluateFableRoutingEvidence()`

## What changed and why

Builds the mechanism the earlier doc-only pilot attempt (a now-closed, unmerged PR) was found to be missing: `/dispatch` hard-coded Sonnet regardless of the routing docs; the 8-task/30-day/usage-budget expiry could not mechanically fire; model/rationale/reviewer-independence were not captured as evidence; and the documented rollback did not cover the model allowlists it also touched.

This head is a substantive rework responding to a real `PM_VERDICT: CHANGES_REQUIRED` (bounce 1) posted by `griff843` on the initial implementation — see `verification.md`'s "PM_VERDICT response" section for the full point-by-point mapping of blocking findings to fixes.

## Known scope notes

- `docs/05_operations/LANE_MANIFEST_SPEC.md` is intentionally left untouched (a planned §17 addition documenting `planning_model_routing` was dropped) because a genuinely live, concurrently-running lane (UTV2-1571) holds an active file-scope lease on that exact file. The field is fully documented in `docs/05_operations/schemas/lane_manifest_v1.schema.json`'s JSON schema and in `three-brain.md`/`OPERATING_MODEL_SONNET5.md` instead.
- `package.json` is also under an active file-scope lease held by a separate, genuinely live lane (UTV2-1570, same owner). This diff touches it anyway per the PM's explicit required correction; the two branches will need a routine merge-order coordination on that one line.

## Pilot NOT activated

`docs/05_operations/FABLE_PILOT_STATE.json` ships with `"status": "pending"`, `"activated_at": null`, `"task_count": 0`. Every `resolveAndRecordPlanningModel()`/`resolveAndRecordFableAdvisoryReview()` call currently falls back to Sonnet regardless of trigger class and never writes a task record. Starting the pilot's clock is a real operational decision reserved for Griff, not something this diff does.
