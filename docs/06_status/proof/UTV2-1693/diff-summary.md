# Diff summary: UTV2-1693

MERGE_SHA: ac409d4e50b1890ff64a5d2a9ef54b9dd7457722

Governance content only. No runtime, domain, DB, delivery or workflow-authority code.

| File | Change |
|---|---|
| `CLAUDE.md` | Rewritten as a thin operating constitution — 215 lines, 12 numbered sections plus two closing pointers. Every previous section classified KEEP/UPDATE/REMOVE/MOVE before rewriting; the audit table is in `verification.md`. |
| `docs/05_operations/CAPABILITY_MAP.json` | **New.** 22 situations mapped to a command, skill or agent, each with an explicit authority level (`authoritative` / `blocking` / `advisory`). Carries the eight previously-undocumented commands. |
| `.claude/commands/dispatch.md` | `lane-governor` changed from "the operator may ask" to a required Phase 0 step, with its advisory status and the disagreement rule stated. |
| `.claude/commands/verification.md` | Added "Step 1 — merge readiness": `pnpm ops:merge-ready` is run, not asserted. Added two T1 checks: `runtime_proof.queries`/`row_counts` must be non-empty, and verifier identity must be read rather than trusted to P10. |
| `.claude/commands/lane-management.md` | Lane-start overlap check now spans manifests **and** leases, with the command for each, plus the false-all-clear reproduction. |

## Substantive changes

**Invariant 6 corrected.** It claimed the lane manifest is the sole authority for active lane state. It is not: all six target files for a lane returned FREE against manifests, and `ops:lane-start` then refused on a lease conflict. The replacement names the populations and states that any one can independently block a lane.

**Three invariants added.** 12 — check existing capability before building new capability. 13 — a safety control is proven only by a test that fails when the control is removed. 14 — the implementer is never the sole validator of a control-plane change.

**Two new sections carry rules that were previously unwritten.** §9 separates execution identity, review identity and approval authority, and forbids authoring an approval artifact on the PM's behalf. §8 requires dry-running before mutating where a dry run exists.

## Defect found in the draft before commit

§4 claimed the capability map "is machine-validated by `pnpm ops:capability-audit`". That command does not exist. Found by checking every referenced command against `package.json` before committing, and corrected to name `ops:automation-coverage-check`, which does. Detail in `verification.md`.

## Known deviation

Acceptance criterion 3 asks for the eight commands in a "Commands block"; there is no longer one. They are in `CAPABILITY_MAP.json` with situation and authority instead. Deliberate, and flagged for PM review in `verification.md`.
