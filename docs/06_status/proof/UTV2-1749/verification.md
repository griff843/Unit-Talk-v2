# PROOF: UTV2-1749

MERGE_SHA: pending merge

Execution SHA: `6a4fb2415e6519de6a1f716b2e33d4d2d5a4cf99`

## ASSERTIONS:

- [x] `alerting-pass` receives `SUPABASE_ANON_KEY` from the matching Actions secret.
- [x] `monitor` receives `SUPABASE_ANON_KEY` from the matching Actions secret.
- [x] `alerting-pass` receives `UNIT_TALK_OPS_ALERT_WEBHOOK_URL` from the matching Actions secret.
- [x] The regression test parses YAML and fails if a required binding is removed or moved away from either named runtime step.
- [x] Cadence, permissions, alert thresholds, member delivery, and system-pick controls are unchanged.
- [ ] Writable DB proof must be produced by the `staging-ci` GitHub environment.
- [ ] A scheduled post-merge workflow run must be observed before runtime success is claimed.
- [ ] Independent exact-head review and T1 approval remain external gates.

## EVIDENCE:

```text
$ pnpm exec tsx --test scripts/ci/ingestor-alert-wiring.test.ts
tests 2; pass 2; fail 0; skipped 0; exit 0

$ pnpm verify:static (final committed head)
exit 1 at automation-coverage before type-check/test
WIRING_TEST_UNWIRED_NEW: scripts/ci/ingestor-alert-wiring.test.ts is not reachable from a package script or workflow command

$ pnpm test:db
blocked/deferred locally by the staging target identity guard; not executed against production
```

## Verification

- [ ] `pnpm type-check`: an earlier pre-tracking static run passed, but the final committed head stopped at executable wiring before this stage; rerun required after scope resolution.
- [ ] `pnpm test`: an earlier pre-tracking static run passed, but the final committed head stopped at executable wiring before this stage; rerun required after scope resolution.
- [ ] `pnpm verify:static`: blocked by `WIRING_TEST_UNWIRED_NEW` for the newly tracked focused test.
- [x] `pnpm exec tsx --test scripts/ci/ingestor-alert-wiring.test.ts`: 2/2 passed.
- [ ] `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: earlier pass covered 5 pre-proof files; rerun required at the eventual final head.
- [ ] `pnpm test:db`: writable live-DB proof is blocked/deferred locally because target identity is `host=unparseable`; run against `xskgrzbteyqdufktjrjx` through `staging-ci` with `CI_SUPABASE_*` credentials.

## Mutation / inversion proof

Baseline workflow SHA-256: `e22d77d0bf2c31755ffeb639e5a63bafe60d506e8a3367e8fd6f32d16cfdf64a`.

Each mutation was applied alone to the real workflow and the named test `scheduled alert workflow gives each runtime step its required configuration` was executed:

1. Removed `alerting-pass` `SUPABASE_ANON_KEY` -> named test failed on the missing `alerting-pass` binding.
2. Removed `alerting-pass` `UNIT_TALK_OPS_ALERT_WEBHOOK_URL` -> named test failed on the missing `alerting-pass` webhook binding.
3. Removed `monitor` `SUPABASE_ANON_KEY` -> named test failed on the missing `monitor` binding.

After every mutation the line was restored with `apply_patch`, and the workflow SHA-256 returned to the baseline value before the next mutation.

## Runtime Verification

Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (`host=unparseable`). Writable DB verification requires `xskgrzbteyqdufktjrjx`. Run it through the `staging-ci` GitHub environment with `CI_SUPABASE_*` credentials.

No scheduled-run success is claimed from YAML. After merge, observe the scheduled workflow and record its run URL, run attempt, `alerting-pass` and `monitor` conclusions, and evidence that the alerting pass reaches the canary-only operations path.

## Current blocker

The repository requires every committed test to be reachable from a required command. The focused test is intentionally located at the packet-authorized path, but root `test:ops` is an explicit file list in `package.json`. Wiring this test requires a one-entry `package.json` change, and that file is outside the authoritative lane scope. No baseline/quarantine entry can solve this in scope: the executable-wiring ledger may shrink but never grow.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Approved PR head: pending
Execution SHA: `6a4fb2415e6519de6a1f716b2e33d4d2d5a4cf99`
