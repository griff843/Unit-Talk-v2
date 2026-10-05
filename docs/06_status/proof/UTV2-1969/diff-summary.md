# UTV2-1969 diff summary

STATUS: PR_OPEN
HEAD_AT_PROOF_AUTHORING: db6c876f35d953825cb011045c593568a486d9bc

- Added an accessible Smart Form Delivery choice fieldset with Track Only selected by default.
- Wired Request Official Pick Delivery directly to the existing `trackOnly=false` form state.
- Preserved the existing payload builder, server response receipt logic, and Track Only reset.
- Extended the fixture-backed MLB E2E path to inspect actual request bodies for both modes and verify reset behavior.
- No API, authorization, routing, worker, kill-switch, persistence, or production target changes.
