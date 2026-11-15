# WORK-2026102806 QA experience report

Environment: authenticated local production build, synthetic loopback PostgREST fixture. Code: d572c07472136798984a5da416b9b0cab965858d. Production was inspected read-only in earlier checks; no production mutation was submitted.

| Check | Observed result |
|---|---|
| Desktop result filter | Corrected win selected; original loss has zero matches; totals match visible fixture. |
| Pick detail | Effective win is marked corrected despite correction timestamp predating original. |
| Correction confirmation | Current win → proposed loss; original record preservation explained; no-op win blocks submission. |
| Keyboard | Tab reaches skip link; Control+K opens palette; capper search returns contextual pick; Escape closes palette. |
| Loading | Delayed fixture displays Loading page. |
| Error | Unavailable fixture displays Active Picks Unavailable. |
| Empty | Original-loss filter displays zero matches and an explicit empty row. |
| Mobile 390 × 844 | Filters stack; document width remains 390; corrected detail and confirmation remain available. |
| Performance | Canonical fixture capper, effective correction, internal Track Only cohort, N=1 labels. |
| Published ROI | No published record plus explicit Track Only exclusion. |

Screenshots in this directory document these observations. The final correction was cancelled. This does not claim production write-path testing or a complete automated accessibility audit. The known unfiltered-result defect is explicitly accepted for WORK-2026102807 after merge.

## PM review follow-up: correction recap feedback

The updated production build was exercised through the actual CorrectionForm and settlePick server action using loopback-only synthetic PostgREST and API responses. The fixture API required the expected bearer credential and authenticated fixture-operator actor. These checks verify presentation of returned recap outcomes; they do not exercise real delivery policy, Discord, or production writes.

| Returned correction outcome | Browser observation | Capture |
|---|---|---|
| posted | Green correction persistence panel and a separate green recap-posted panel. | correction-recap-posted.png |
| suppressed | Green correction persistence panel and an amber recap-not-posted panel containing the kill-switch explanation and reason. | correction-recap-suppressed.png |
| unresolved | Green persistence panel and amber unresolved panel; check-before-retrying guidance and returned reason remain visible. At 390 × 844, innerWidth and document scrollWidth both equal 390. | correction-recap-unresolved.png |
| absent | Persistence panel only; no invented suppressed or posted recap panel. | correction-recap-absent.png |

Each check selected loss against current win, filled the attestation, reviewed the current/proposed confirmation, and submitted only to the synthetic loopback API. The desktop viewport was 1424 × 1248; mobile emulation was reset after checking. The prior cancelled-correction observations above refer to the original lane verification.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1800
