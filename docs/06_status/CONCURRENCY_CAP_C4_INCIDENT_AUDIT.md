# Concurrency Cap C4 Incident Audit

**Issue:** UTV2-1504  
**Tier:** T2  
**Audit timestamp:** 2026-07-14T04:50:06Z  
**Scope:** committed configuration, enforcement implementation, automated simulation, and current lane-manifest state.

## Verdict

The current concurrency control is enforcing the ratified base cap: six total active lanes, two Claude lanes, and four Codex lanes. At the audit timestamp, one Codex hygiene lane was active; the control reported three remaining Codex slots and two remaining Claude slots.

The repository does not retain a committed dispatch/preflight artifact, event record, or manifest snapshot identifying the historical start that exceeded a cap. Therefore, the occurrence and root cause of the named C4 incident cannot be attributed from repository evidence. This is an evidence-retention finding, not evidence that no incident occurred.

## Evidence

| Control | Evidence | Result |
| --- | --- | --- |
| Base limits | `docs/governance/CONCURRENCY_CONFIG.json` sets `total: 6`, `claude: 2`, and `codex: 4`. | PASS |
| Trial expiry | The trial is enabled for 8 total / 3 Claude / 5 Codex, but its `allowed_until` is `2026-06-26`. `getEffectiveConfig()` evaluated at 2026-07-14 reports `trial_active: false` and restores the base limits. | PASS |
| Admission enforcement | `scripts/ops/lane-start.ts` rejects starts at the total and executor caps with `total_cap_exceeded`, `claude_cap_exceeded`, and `codex_cap_exceeded`. | PASS |
| Current state | `pnpm ops:execution-state -- --json` reported one active lane (UTV2-1504), Codex `1/4`, Claude `0/2`, no blocked lanes, and no merge-risk findings. | PASS |
| Regression coverage | `npx tsx --test scripts/ops/concurrency-simulation.test.ts` passed all 23 subtests, including rejection of a seventh lane after trial expiry. | PASS |
| Incident attribution | No historical cap-exceeded preflight result or retained active-manifest snapshot was available in the checked-in workspace. | INCONCLUSIVE |

## Timeline

1. 2026-06-24 — commit `8e8a775a578d835d1e659f33e11b1cba83f38aec` enabled the temporary trial through 2026-06-26.
2. 2026-06-26 — trial expiry; the implementation automatically reverts effective limits to the 6/2/4 base configuration.
3. 2026-07-14 — this audit evaluated the effective configuration and current manifest state. The base cap was active and not exceeded.

## Findings and follow-up

1. **C4-1504-1 — historical incident evidence is not retained in the repository.** The lane manifest references a preflight token path, but that artifact is absent from this worktree; no durable incident record identifies the rejected or over-cap start. Future C4 investigations need a durable, immutable dispatch decision record that includes timestamp, active counts, effective limits, and refusal code.
2. **C4-1504-2 — current controls are operating as designed.** No configuration or runtime-control change is warranted from this audit. The expired trial is already fail-closed to the ratified base caps.
3. **Closeout artifact gap.** The lane manifest requires `docs/06_status/proof/UTV2-1504/model-routing.json`, but the execution packet authorizes only the audit plus two Markdown proof files. The required JSON artifact is absent and cannot be created within this lane's permitted scope. Closeout requires a scope correction or a lane-tooling-generated artifact.

## Non-actions

This audit does not alter concurrency policy, cap values, lane manifests, or orchestration code. Those paths are outside the issue's authorized file scope.
