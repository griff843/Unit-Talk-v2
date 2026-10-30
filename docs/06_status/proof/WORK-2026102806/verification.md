# PROOF: WORK-2026102806

MERGE_SHA: pending merge

## ASSERTIONS:

- [x] Result filtering uses effective correction-chain results and consistent filtered IDs for rows and totals.
- [x] Correction confirmation distinguishes current and proposed results and blocks no-op corrections.
- [x] Authenticated lookup exposes governed wager context and retains the client bundle boundary.
- [x] Desktop and 390 × 844 mobile fixture observations are recorded without production mutations.
- [x] Track Only settlement behavior, score validation and append-only API paths remain preserved.
- [x] PM review recap-feedback repair preserves returned recap outcomes and separates correction persistence from downstream posted, suppressed or unresolved feedback; absent recaps produce no recap panel.

## EVIDENCE:

```text
Command Center tests: 723 passed, 0 failed.
Command Center type-check: PASS.
Command Center production build: PASS.
R-level: PASS (operator-ui).
CI verify and staging proof on 918a48fd4: PASS.
```

Status: Original lane verification and the PM review recap-feedback repair are locally complete. Exact-head CI staging proof and PM approval are still required after the new push. Claude owns CI coordination, routing reconciliation, merge and closeout.

## Verification

- `pnpm exec tsx --test src/lib/data/pick-identity.test.ts src/lib/data/queues-count-relation.test.ts` from `apps/command-center`: PASS, 10 tests on d572c0747.
- `pnpm --filter @unit-talk/command-center test`: PASS, 723 tests on d572c0747.
- `pnpm --filter @unit-talk/command-center type-check`: PASS on d572c0747.
- `pnpm --filter @unit-talk/command-center build`: PASS on d572c0747.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS, operator-ui, on d572c0747.
- `pnpm type-check` and `pnpm test` (repo-wide) run inside `pnpm verify:static` in the CI `verify` job; both passed in the CI runs on 918a48fd4 and 5b73b6fdd linked below.
- `pnpm verify` on 5391c9d6b: static phase PASS; local live database stage refused the loopback target. The work order specifies CI-only staging verification.
- [CI verify and staging database proof](https://github.com/griff843/Unit-Talk-v2/actions/runs/40910243492): PASS on 918a48fd49a003e266c349e3629993f0fbeb2078, including the d572c0747 product code and subsequent proof-only changes. New proof commits trigger a fresh CI run before executor handoff.
- [CI verify and staging database proof on 5b73b6fdd](https://github.com/griff843/Unit-Talk-v2/actions/runs/40919185777): PASS. The subsequent screenshot recapture is proof-only; product source is unchanged.
- `pnpm exec tsx scripts/ops/proof-auditor-gate.ts --proof-dir docs/06_status/proof/WORK-2026102806 --sha 5b73b6fdd6d91a96ccf65624b80201b55ffe78a3 --require-executed-command "pnpm test:db" --json`: PASS after a fresh mobile detail capture. The previous PNG accidentally contained the binary bytes matching the placeholder detector, which the auditor scans as text. The replacement is a genuine browser capture centered on the corrected settlement, not an edited image.

## Browser evidence

An isolated loopback mock with a synthetic pick and two append-only settlement records was used; no production write was performed. On d572c0747, the result filter showed the corrected win and the pick page showed `win (corrected)`. The confirmation displayed `Current: win → Proposed: loss` and preservation of the original record; choosing win disabled submission. The final confirmation was not submitted.

- `corrected-result-filter.png` shows the corrected fixture in the result filter on d572c0747.
- `before-pick-summary.png` shows the prior build displaying the original loss. The initial mock returned a malformed pick object, so its surrounding pick identity is incomplete; the settlement history was the same synthetic correction chain.
- `after-pick-summary.png` and `correction-confirmation.png` show d572c0747 using the corrected mock response.
- `contextual-lookup.png` shows the synthetic pick found by capper after opening the palette with Control+K. Escape closed the palette; Tab reached the skip link.
- The same build returned zero matches for the original loss after correction to win. With the loopback fixture server stopped, the page showed `ACTIVE PICKS UNAVAILABLE`; `results-error.png` captures that state.
- A delayed fixture response displayed `Loading page…` during navigation; see `results-loading.png`.

Chrome device emulation was subsequently run at 390 × 844. Picks, pick detail, and correction confirmation reported innerWidth=390 and document scrollWidth=390. The result-filter controls stacked within the viewport; the pick detail retained its effective corrected result. The correction confirmation showed current win, proposed loss, and preservation of the original record, with Confirm and Cancel visible. Cancel was used; no final mutation was submitted. Captures: `mobile-picks.png`, `mobile-detail.png`, and `mobile-correction.png`.

The current fixture performance page used canonical capper attribution, applied one correction, separated Track Only as internal evidence, and displayed N=1 beside each unrated rate. ROI Overview showed `No published record in these windows` and the Track Only exclusion note. See `performance-samples.png` and `roi-empty-published.png`.

## Accepted follow-up and limitations

Production Claude and Griff directed that #1800 finish as admitted. The unfiltered /picks view can still display its timestamp-selected result; WORK-2026102807 will resolve that after #1800 merges and releases its file locks. The attempted follow-up patch is excluded from this PR. Before-pick evidence has the explicitly noted mock-shape limitation above. No production write, deployment, or merge was performed. The model-routing record reports the actual exposed model; its disagreement with the old lane assignment is deferred governance, not an assertion that a different model executed this work.

## PM review recap-feedback repair

Source commit: `8de7a35c18240a45914e74c618ec9b7863faa723`.

- `pnpm exec tsx --test apps/command-center/src/lib/correction-confirmation.test.ts`: PASS, 6 tests. Five added rendering tests cover posted, suppressed, unresolved, absent, and unknown failure reasons. Existing no-op/current-result assertions remain intact.
- `pnpm --filter @unit-talk/command-center test`: PASS, 728 tests, 0 failures (previously 723).
- `pnpm --filter @unit-talk/command-center type-check`: PASS.
- `pnpm --filter @unit-talk/command-center build`: PASS, optimized production build.
- `pnpm exec eslint apps/command-center/src/components/CorrectionForm.tsx apps/command-center/src/lib/correction-confirmation.ts apps/command-center/src/lib/correction-confirmation.test.ts`: PASS.
- `pnpm verify`: static stages, including repository tests, passed; the writable DB stage refused the loopback target with `assert-staging` requiring `xskgrzbteyqdufktjrjx`. No local staging credentials were added. Required final-head verification must come from CI's staging-only producer and verify job.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS, operator-ui.
- Browser verification used the built production app and the actual CorrectionForm/server-action flow with isolated loopback API responses. Posted and suppressed states were checked at desktop width; unresolved and absent states at 390 × 844. The unresolved state had innerWidth=390 and document scrollWidth=390. Four genuine captures are documented in qa-experience-report.md. These are UI response fixtures, not a claim of live delivery testing.
- Delivery controls, settlement backend/action behavior, score validation and authentication contracts are unchanged. All source changes remain inside the lane's immutable file scope. No production mutation or deployment was performed for this repair.
- External-session routing provenance remains `gpt-6.1-sol / unavailable`; reasoning effort and CLI telemetry are not exposed to the executor. This is a factual report, not a claim of routing-reconciliation approval.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1800
