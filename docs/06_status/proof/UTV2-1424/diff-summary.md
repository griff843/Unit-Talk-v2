# Diff Summary — UTV2-1424 Model Edge Acceptance Standard Ratification

## Scope

This documentation-only T2 lane ratifies the evidence threshold used for model-edge
labels. It does not change runtime code, database state, delivery configuration, or
any constitutional program state.

## Changes

- `docs/05_operations/MODEL_EDGE_ACCEPTANCE_STANDARD.md`
  - replaces the draft UTV2-999 header with the UTV2-1424 PM-approved-merge
    ratification boundary;
  - makes `UNPROVEN` the outcome when the required evidence bundle is missing,
    stale, or unverifiable; and
  - makes clear that a model label is not P3/P4 certification or launch authority.
- `docs/05_operations/LAUNCH_GATE_DEFINITION.md`
  - requires the Tier B P3 verdict to be evaluated against the active Model Edge
    Acceptance Standard; and
  - records that ratifying the standard does not satisfy P3, P4, or a launch tier.

## Safety

The ratified threshold is fail-closed. It creates no edge, ROI, CLV, P-state, or
launch claim. The issue-specific read-only measurement remains `UNPROVEN`: five
real-edge-backed settled rows, zero CLV coverage, and no stake-based ROI result.
