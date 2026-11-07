# Diff summary: WORK-2026110702

Navigation only. Two agent command files stop pointing at the superseded `PROGRAM_STATUS.md` as a status source. No policy, gate, tier, workflow, proof archive or closed lane manifest is changed.

| File | Change |
|---|---|
| `.claude/commands/system-state-loader.md` | Step 4 now reads `docs/mission/plan.md` and the dated snapshot `docs/06_status/CURRENT_STATE.md`; `PROGRAM_STATUS.md` named superseded history |
| `.claude/commands/t1-proof.md` | T1 trigger "`PROGRAM_STATUS.md` routing-state table changed" replaced with "delivery kill-switch, containment mode (`syndicate_machine_mode`) or delivery target registry configuration changed", so the item tracks real routing state rather than a superseded document |

`.claude/commands/execution-truth.md:21` only calls `PROGRAM_STATUS.md` a "view" and is unchanged.

## SHA Binding

Merge SHA: 1f0a4332029fe9c82a9e5d97c0fececbdffc0451
PR: pending
