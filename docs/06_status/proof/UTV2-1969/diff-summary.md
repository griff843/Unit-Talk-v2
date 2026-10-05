# UTV2-1969 diff summary

STATUS: PR_OPEN
HEAD_AT_PROOF_AUTHORING: 32ce7a9ae158a49e333509a8099496a3f1401c7b

- Added an accessible Smart Form Delivery choice fieldset with Track Only selected by default.
- Wired Request Official Pick Delivery directly to the existing `trackOnly=false` form state.
- Preserved the existing payload builder, server response receipt logic, and Track Only reset.
- Extended the fixture-backed MLB E2E path to inspect actual request bodies for both modes and verify reset behavior.
- Added explicit delivery-to-Track-Only switch-back coverage and server-refused receipt assertions.
- No API, authorization, routing, worker, kill-switch, persistence, or production target changes.
