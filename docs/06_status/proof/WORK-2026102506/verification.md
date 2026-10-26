# PROOF: WORK-2026102506

MERGE_SHA: pending merge

Issue: WORK-2026102506
Tier: T2
result: pass

## ASSERTIONS:

- [x] The polished form builds, lints and type-checks, and the Smart Form unit tests pass.
- [x] Five browser regressions pass: Track Only payload and receipt, delivery request awaiting approval, mobile player-prop identity, incomplete input never submits, catalog failure retry.
- [x] No existing browser test newly fails: the 17 failures in the full Playwright suite fail identically on origin/main (see Verification).

## EVIDENCE:

Local runs in the lane worktree on the code commit `89a2885bc` (the later commits add only proof files):

```
pnpm lint          -> exit 0
pnpm type-check    -> exit 0
pnpm --filter @unit-talk/smart-form test -> tests 211, pass 211, fail 0
tsx --test e2e/ui-polish.browser.ts (local next dev, intercepted API) -> tests 5, pass 5, fail 0
```

Baseline comparison (full `playwright test` run, fixture mode, same environment, origin/main `eed54bab5` versus PR head `fbe284a8d`, which has the same code as this lane): 17 failures of 51 on both trees, identical tests and assertions. They are stale assertions (`Pick Saved`, `Track Only · Internal`) in phase-one, offline-offer-slip and real-reference specs, plus three auth-gate tests that the QA auth bypass defeats. No failure is new.

Browser evidence: `docs/06_status/proof/WORK-2026102506/ (the png and json files beside this document)` (flat files, no nested directory, so the proof auditor sees no markdown-less proof directory; desktop, mobile, player-prop at 320/390/1440, receipts, catalog error). It is a local read-only preview, not evidence of real authentication or production submission.

## Verification

Commands executed locally: `pnpm lint`, `pnpm type-check`, `pnpm --filter @unit-talk/smart-form test`, and `tsx --test e2e/ui-polish.browser.ts`, with the results above. `pnpm verify` was not run locally because its staging proof step cannot pass on a workstation; CI's `verify` job is the authority and its result is recorded on the PR.

Model-routing sidecar: Codex implemented this lane in its own desktop session, not through `scripts/ops/codex-exec.ts`, so no `model-routing.json` exists and none was fabricated. `ops:proof-generate` therefore refuses with `missing_required_sidecar`.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
