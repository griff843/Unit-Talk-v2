# PROOF: UTV2-1945

MERGE_SHA: pending merge

Issue: UTV2-1945
Tier: T2
Lane type: governance
Branch: codex/utv2-1945-discord-architecture
Execution SHA: fe41f38f0c15af9775bad8cb03024d549e44b6ab
result: STATIC PASS — full live verification delegated to required PR CI by explicit PM disposition

## ASSERTIONS:

- [x] Canonical architecture contract preserves the exact PM blueprint, 25 surfaces, channel jobs and action/audience profiles.
- [x] Migration matrix accounts for all 65 audit channels exactly once with captured IDs and original types; all four missing voice IDs remain unknown.
- [x] Role matrix covers all 84 named roles plus @everyone; Trial=VIP, VIP Best Bets/education, VIP+ intelligence and independent Capper grants are explicit.
- [x] Capper Official/Q&A, consolidated official board, selective Best Bets, public Results and Recaps remain distinct.
- [x] Automation ownership, access reconciliation, rollback waves, acceptance and authority conflict ledger are documented.
- [x] No Discord/server, runtime, commerce or governance-code mutation; Black Label stays parked; production acceptance not executed.
- [ ] Full verification — required PR CI at exact HEAD must pass; local pnpm verify remains a recorded staging-target refusal.
- [x] Documentation PR opened for PM independent review under explicit PM disposition; required CI remains independently enforced.

## EVIDENCE:

Saved audit inventory SHA-256: 2a6cd653ab4f667fe1945324c5c6e7d18effb04049b36aad0859fe277855e2e9.
The accompanying evidence.json records source/document hashes and measured inventory/link checks.
No private message content or credentials are included.

```text
pnpm verify:static (within pnpm verify): PASS
TAP totals across completed suites: pass=6790 fail=0 skipped=0
pnpm verify: exit 1 at test:live-db -> test:db -> ci:assert-staging
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
Writable DB verification requires xskgrzbteyqdufktjrjx.
Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
```

## Verification

- `pnpm type-check`: PASS within pnpm verify.
- `pnpm test`: PASS within pnpm verify; no test decrease or new runtime behavior.
- `pnpm verify`: BLOCKED as recorded above; never represented as green.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS; no rules matched.
- Inventory check: PASS, 65 unique rows, 61 captured IDs, four unknown voice IDs, 25 targets, 85 role names including @everyone, zero broken document links.
- Preflight: PASS, no waivers.
- Canonical `pnpm ops:execution-state -- --json`: PASS at 2026-09-19T19:19:19.204Z; canonical local/open-PR-head union; UTV2-1945 conflict_risk clear.
- Main base: b5b26171b2245ad61aa8cb33b63e745b371db57d; UTV2-1943 done, closed_at 2026-09-19T18:45:32.497Z; stale local lease released through sanctioned lane-close.
- gh version 2.101.0 (2026-09-15).
- Full local verification log: /tmp/utv2-1945-verify.log, SHA-256 f35593238d925f91006c4a4964f02bdbff38be6f75aef85e781c733fcd7c3c44.
- Baseline warning: existing QA glob shadowing; zero new unwired tests/capabilities. No unrelated repair.

## Runtime Verification

Manual sanctioned [Staging DB Proof run 35464411547](https://github.com/griff843/Unit-Talk-v2/actions/runs/35464411547)
passed on head 3ec6c7532f8bcfe8eb68e31639cbfce7329f1ad4: seven DB smoke tests,
zero failures/skips; independent receipt auditor PASS (producer job 105953968247,
auditor job 105954061443). This workflow runs DB smoke only, not test:t1-proof:live.
Local full pnpm verify remains unpassed. PM explicitly directed opening this docs-only
T2 PR on static-green evidence, with full live verification delegated to required
PR-triggered CI at the exact PR HEAD. See LIVE_DB_VERIFY_ISOLATION_BRANCH_PROTECTION.md
for the bounded docs/governance policy. No CI, verification-policy or governance code
was changed. Do not claim full verification green before the required verify context passes.

PR: https://github.com/griff843/Unit-Talk-v2/pull/1619 (tier:T2).
The convenience lane:resume command failed against the shared control checkout's
unrelated dirty closeout files/main drift and existing-lane admission checks. That
attempt is not represented as a preflight PASS. The prior successful admission remains
recorded; the existing resumeLaneManifest transition and validated manifest writer
recorded PM's cleared administrative blocker, followed by ops:lane-link-pr.

Not performed against Discord. All production acceptance boxes remain unchecked.
The local DB guard refused before writable tests; no guard or environment was weakened.
The model-routing sidecar records manifest policy selection, with actual desktop runtime identity explicitly unattested.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1619
Approved PR head: pending merge
Execution SHA: fe41f38f0c15af9775bad8cb03024d549e44b6ab
