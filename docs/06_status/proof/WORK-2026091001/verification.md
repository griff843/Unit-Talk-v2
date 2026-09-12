# PROOF: WORK-2026091001

MERGE_SHA: pending merge
Execution SHA: 1759314ea7e34addf3cb9f6b57488d6f6e9509a4
PR: https://github.com/griff843/Unit-Talk-v2/pull/1556

## Summary

Ordinary non-P0 declarations use the existing repository tier without a second PM gate. Historical and trusted-base positive P0 obligations, unresolved-classification refusal, and existing tier review remain. The lane is bound through ops:lane-link-pr; files_changed is populated through ops:lane-manifest update. Required proof was generated through ops:proof-generate and populated from measured results.

## ASSERTIONS:

- [x] Ordinary applicability no longer adds universal exact-head PM approval.
- [x] Historical/base P0, proper tier approvals and unresolved refusal remain.
- [x] Lane binding and measured proof are present.
- [x] Return-review packet honors existing authenticated, exact-head scope overrides.
- [ ] Reserved scope/T1 integration approvals are issued.
- [ ] Consumer activation and real ordinary/existing PR integration and closeout are proven.

## EVIDENCE:

The source at 1759314ea7e34addf3cb9f6b57488d6f6e9509a4 produced 6404 passing tests, zero test failures, and zero reported skips, across 6404 reported. Static, build, test and command checks passed. pnpm verify exits 1 at its staging target guard; this is not a full gate pass. No staging credentials entered fixtures. Smart Form browser E2E was not enabled.

## Verification

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
Changed files: 89
Rules matched: (none) — no R-level artifacts required for this diff
```

## Independent review

A separate non-author reviewer found no additional defect at source 1759314ea7e34addf3cb9f6b57488d6f6e9509a4. Independent runs passed 528 earlier targeted tests, 67 workflow tests, and 26 final packet/recovery tests (overlapping runs). This is not PM merge approval. The model-routing sidecar records an actual bounded desktop subagent; it does not claim CLI execution or whole-lane provenance.

## Runtime Verification

Actual p0-detect CLI fixtures classify new WORK-999 T3 as non-P0 with stale tokens and fetch/http/https blocked; new T1/T2 applicability also avoids a second PM gate. Historical and base-positive P0 remain protected. Actual truth CLI covers repository/legacy identities under absent, invalid, timeout, deleted and capped tracker credentials, preserving unmerged refusal. Tests cover dispatch, packet, preflight, close/finalize, scoped metadata and authenticated overrides. Unavailable, stale, wrong-identity, bot or unauthorized scope comments grant nothing.

A fresh context agent recovered mission, active work, PR and next safe action from actual repository records without network. Its stale recovery-instruction findings were corrected and rechecked. Actual fresh/post-compaction hooks pass with network tools blocked and emit current authority references. A separate complete compacted-agent experiment is not yet proven. Main-checkout instructions remain old until foundation integration.

These checks do not prove a real ordinary task and existing PR have completed protected integration and post-merge closeout. Prior head cf702af5a1f2ffaa2f7f6ba857d212968a48c194 passed CI verify and staging DB proof in run 34477871838; those results are not attributed to this source. Final-head CI is still required.

## Remaining integration controls

The trusted-base scope guard requires its existing external authorization for nine paths: manifest/sync, scope guard/parser and their tests, scope and return-review workflows, and the return-review test file. No human verdict is fabricated and admission history is unchanged. T1 review/merge controls remain binding. The evaluator foundation precedes the recorded consumer patch; see integration.md. No cutover completion or closeout is claimed.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1556
Approved PR head: pending merge
Execution SHA: 1759314ea7e34addf3cb9f6b57488d6f6e9509a4
