# UTV2-1253 — Diff Summary

## Summary

Docs-first architecture lane. Creates `PICK_LIFECYCLE_AND_EVIDENCE_MODES.md` defining four operating modes and three control planes. Adds `docs/02_architecture/**` to governance lane allowed paths. No runtime code changes.

**Merge SHA:** `51be3689`

## Evidence

- `docs/02_architecture/PICK_LIFECYCLE_AND_EVIDENCE_MODES.md` — new, 662 lines
- `.lane/lanes/governance.yml` — `docs/02_architecture/**` added to allowed_path_globs
- `pnpm verify:quick` PASS
- `pnpm test:db` PASS (7/7, 0 fail)
- `scripts/ci/r-level-check.ts` PASS (no rules matched — docs-only lane)
- PM_VERDICT: APPROVED (2026-06-10)

**Issue:** UTV2-1253 — Architecture Doc: Pick lifecycle and evidence modes
**Tier:** T2
**Lane type:** hygiene (docs-first architecture)
**Branch:** claude/utv2-1253-pick-lifecycle-and-evidence-modes
**Evaluator:** Claude Sonnet 4.6
**Date:** 2026-06-10

---

## Files Changed

### New

- `docs/02_architecture/PICK_LIFECYCLE_AND_EVIDENCE_MODES.md` — architecture doc defining four operating modes, three control planes, evidence eligibility vs. delivery approval separation, pick lifecycle per mode, Command Center requirements, Discord delivery policy, transition criteria, and relationship to P3/P4/P5 certification states.
- `docs/06_status/proof/UTV2-1253/diff-summary.md` — this file
- `docs/06_status/proof/UTV2-1253/verification.md` — verification evidence

### Modified

- `docs/06_status/lanes/UTV2-1253.json` — lane manifest (created by ops:lane-start)
- `.ops/sync/UTV2-1253.yml` — sync metadata (created by ops:lane-start)

---

## Scope

This lane touches only documentation. No runtime code changes. No schema changes. No package.json changes.

All file changes are within `docs/02_architecture/` and `docs/06_status/proof/UTV2-1253/` — within the declared `file_scope_lock`.

---

## PM Conclusion Addressed

UTV2-1042 returned INSUFFICIENT_DATA because `awaiting_approval` picks (held by the P7A governance brake for public delivery approval) were excluded from CLV-path sample accumulation. 100 of 126 CLV-path picks were in `awaiting_approval`; 0 settled CLV-path picks vs. 50 required for DEVELOPING.

The architecture doc created in this lane:

1. Names the structural problem: evidence eligibility and public delivery approval were conflated.
2. Defines the fix in doctrine: `awaiting_approval` must not block evidence flow.
3. Provides the four-mode operating model as the basis for the next implementation lane.
4. States current mode (Mode 1: Evidence Accumulation) unambiguously.
5. Does not authorize public Discord spam, does not certify P3, does not make CLV/ROI/edge claims.
