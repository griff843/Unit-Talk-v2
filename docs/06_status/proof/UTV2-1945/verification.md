# PROOF: UTV2-1945

MERGE_SHA: pending merge

Issue: UTV2-1945
Tier: T2
Lane type: governance
Branch: codex/utv2-1945-discord-architecture
Execution SHA: fe41f38f0c15af9775bad8cb03024d549e44b6ab
result: BLOCKED — local writable-DB verification target unavailable

## ASSERTIONS:

- [x] Canonical architecture contract preserves the exact PM blueprint, 25 surfaces, channel jobs and action/audience profiles.
- [x] Migration matrix accounts for all 65 audit channels exactly once with captured IDs and original types; all four missing voice IDs remain unknown.
- [x] Role matrix covers all 84 named roles plus @everyone; Trial=VIP, VIP Best Bets/education, VIP+ intelligence and independent Capper grants are explicit.
- [x] Capper Official/Q&A, consolidated official board, selective Best Bets, public Results and Recaps remain distinct.
- [x] Automation ownership, access reconciliation, rollback waves, acceptance and authority conflict ledger are documented.
- [x] No Discord/server, runtime, commerce or governance-code mutation; Black Label stays parked; production acceptance not executed.
- [ ] Full pnpm verify — static phase passed; live DB phase refused the local target.
- [ ] Documentation PR ready for PM review — depends on the required verification gate.

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

Not performed against Discord. All production acceptance boxes remain unchecked.
The local DB guard refused before writable tests; no guard or environment was weakened.
The model-routing sidecar records manifest policy selection, with actual desktop runtime identity explicitly unattested.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Approved PR head: pending merge
Execution SHA: fe41f38f0c15af9775bad8cb03024d549e44b6ab
