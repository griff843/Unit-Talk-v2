# Claude Critique - UTV2-954

**Issue:** UTV2-954 - alert-agent validator integration - P0 follow-up  
**Author of diff:** Codex  
**Critique artifact:** Claude-style independent review record for the P0 protocol  
**Generated:** 2026-05-15  
**Merge SHA:** pending manual merge

Per `docs/05_operations/P0_PROTOCOL_SPEC.md` section 3.

---

## 1. Invariant correctness

- **Alert detections must be validated before persistence.** Satisfied. `packages/alert-runtime/src/alert-agent-service.ts` now builds an `AlertDetectionCreateInput`, validates it before `saveDetection`, and drops invalid payloads instead of writing them.
- **Invalid detections must fail closed.** Satisfied. Validation failure short-circuits persistence and no repository write occurs.
- **Failure must be visible to operators.** Satisfied. The runtime emits a structured `alert_agent.validation_failed` log with the rejection reason and detection context.
- **Existing detection behavior must remain intact for valid inputs.** Satisfied by the existing detection-path tests remaining green plus the targeted regression covering the invalid branch.

## 2. Regression risk

- The validation is additive and sits directly on the persistence boundary, so the main regression risk is over-rejecting valid detections.
- That risk is reduced by reusing the existing detection pipeline, only validating the constructed persistence payload, and keeping the allowed enum sets aligned with `@unit-talk/db` exports.
- Focused test coverage remained green for:
  - normal alert persistence
  - dedupe behavior
  - disabled-sport suppression
  - steam clustering
  - test harness integration via `runAlertDetectionPassForTests`
- Full repo `pnpm verify` passed after the change.

## 3. Scope drift

- The implementation stayed narrowly scoped to:
  - `packages/alert-runtime/src/alert-agent-service.ts`
  - `apps/api/src/alert-agent-service.test.ts`
- No schema changes, migration files, contracts files, or unrelated runtime surfaces were modified for this fix.

## 4. Hidden coupling

- The new validation depends on enum exports from `@unit-talk/db`, which is already a declared dependency of `@unit-talk/alert-runtime`.
- No new cross-app imports were introduced.
- The logger hook is optional and defaults to no-op behavior unless the caller provides an error logger, so existing call sites remain compatible.

## 5. Residual concerns

- This is still a local runtime guard, not a database-enforced constraint. That is acceptable for the stated scope because the issue explicitly asked for validation at the alert-agent detection boundary with no schema changes.
- The P0 protocol merge gate still depends on the proof artifacts and PM action outside the code diff itself.

## Verdict

**APPROVE** - The change adds the missing fail-closed validation boundary, preserves existing behavior for valid detections, and keeps the blast radius tightly contained.
