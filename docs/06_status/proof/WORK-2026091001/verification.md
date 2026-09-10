# WORK-2026091001 verification

MERGE_SHA: pending merge
Execution SHA: 2a24a307e6ff000faf5e234a4aec7cb28c0241de
PR: https://github.com/griff843/Unit-Talk-v2/pull/1556

## Summary

Ordinary explicit non-P0 classification uses the repository tier declaration without a second PM approval. Historical and trusted-base positive P0 obligations, unknown refusal, and existing tier review requirements remain. The lane is bound to PR #1556 through ops:lane-link-pr; files_changed is populated through ops:lane-manifest update. Proof was generated with ops:proof-generate and replaced with measured results.

## Verification

Local pnpm verify: 6323 passes, 0 failures, 0 skips across reported TAP suites. All local static/build/test stages completed; the command exits 1 when the writable DB stage refuses the containment URL. This is not a full gate pass. No staging credentials entered the fixture environment. Smart Form browser E2E was not enabled.

```text
$ pnpm verify
[lint-migrations] Skipping schema baseline replay-root 00000000000000_baseline_live_schema.sql (snapshot, not a forward migration; fidelity verified by Live Schema Parity).
[lint-migrations] 134 migration file(s) checked — no findings.

> @unit-talk/v2@0.1.0 test:live-db /home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__work-2026091001-tracker-independence
> pnpm test:db && pnpm test:t1-proof:live


> @unit-talk/v2@0.1.0 test:db /home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__work-2026091001-tracker-independence
> pnpm ci:assert-staging && tsx --test apps/api/src/database-smoke.test.ts


> @unit-talk/v2@0.1.0 ci:assert-staging /home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__work-2026091001-tracker-independence
> tsx scripts/ci/assert-staging-target.ts

[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
 ELIFECYCLE  Command failed with exit code 1.
 ELIFECYCLE  Command failed with exit code 1.
 ELIFECYCLE  Command failed with exit code 1.
 ELIFECYCLE  Command failed with exit code 1.
```

```text
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 79
Rules matched: (none) — no R-level artifacts required for this diff
```

## Independent review

A separate non-author reviewer examined source 2a24a307e6ff000faf5e234a4aec7cb28c0241de and ran 528 targeted tests: 528 passed, zero failures or skips. Disposition: no additional blocking code defect found in reviewed paths. This is not PM merge approval. The model-routing sidecar records a real bounded desktop subagent execution; it makes no CLI or whole-lane provenance claim.

## Runtime Verification

The actual p0-detect CLI classifies new WORK-999 T3 as non-P0 under stale Linear credentials with fetch/http/https blocked. T1/T2 applicability also avoids the second PM gate. Historical/base P0 obligations and missing declarations still refuse unsafe progression. Scope/parser tests pass 55 tests; exact-lane metadata is allowed while unrelated and protected paths stay outside scope. Independent workflow tests exercise dispatch, receive, packet, preflight, close/finalize, and hooks.

These component checks do not establish successful real ordinary/legacy integration and post-merge closeout. Hook execution proves recovery instructions, not a full fresh or compacted agent recovery. Prior head cf702af5a1f2ffaa2f7f6ba857d212968a48c194 passed CI verify and staging DB proof in run 34477871838; those results are not attributed to this revised source.

## Remaining integration controls

The trusted-base scope guard reports exactly seven paths requiring its existing external scope authorization: the lane manifest/sync, scope guard/parser and their tests, and scope workflow. No human scope verdict has been fabricated. The evaluator foundation must land before the recorded workflow activation patch. Required CI and T1 approval remain binding. See integration.md for the staged commands and dependency. No cutover completion or lane closeout is claimed.
