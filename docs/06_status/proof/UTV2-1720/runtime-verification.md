# PROOF: UTV2-1720

MERGE_SHA: e98e062139ad0fddcfe4b87be6c0a8b34216bead

ASSERTIONS:

- This governance lane uses the schema-v2 `static` profile and does not claim successful writable-DB execution from an unidentified target.

EVIDENCE:

```text
runtime proof status: PASS_STAGING_CI_LOCAL_BLOCKED_DEFERRED
configured host: 127.0.0.1
required staging project: xskgrzbteyqdufktjrjx
production mutation performed: false
```

## Runtime verification

Source binding: `e98e062139ad0fddcfe4b87be6c0a8b34216bead`.

This lane changes governance and CI closeout tooling; its declared schema-v2 proof profile is `static`. It does not change application runtime, database schema, or a DB-writing service. The shared contract therefore does not require fabricated runtime queries or monitored-table row counts.

Writable DB status is `BLOCKED_DEFERRED`, not PASS. `pnpm test:db` was stopped by the fail-closed staging identity guard before the node:test runner began:

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
```

Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.

No production mutation or live-channel action was performed.

## Attempt 6 hosted staging receipt

GitHub Actions run `32084054556` completed successfully at substantive source head
`129f36c23399de8c94cac3b9da2e3119d2d65a2c`. Writable DB job `95552759089` resolved both the
observed and expected project refs to `xskgrzbteyqdufktjrjx`, then passed `pnpm test:db` with
7 tests passed, 0 failed, and 0 skipped. The T1 live suites also passed. Receipt artifact
`9306145939` was independently accepted by verify job `95553478646`, which passed the full static
gate and reported a receipt-verifier `PASS`.

The authoring workstation remains `BLOCKED_DEFERRED` because its configured host is `127.0.0.1` and
cannot be identified as the staging project. The hosted receipt is the authoritative writable proof.

## Attempt 8 local verification and deferred writable proof

The strategy-aware correction at `e98e062139ad0fddcfe4b87be6c0a8b34216bead` passed
`pnpm verify:static` and the five-file focused suite (335 tests, 335 passed, 0 failed, 0 skipped).
The full `pnpm verify` repeated the complete static gate successfully and then reached
`pnpm test:db`. The direct `pnpm test:db` invocation reached the same guard. Both stopped before
the writable test runner because the local URL resolves only to `127.0.0.1`, not the required
staging project `xskgrzbteyqdufktjrjx`.

Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL
(host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the
staging-ci GitHub environment with CI_SUPABASE_* credentials.

## Attempt 7 hosted staging receipt

GitHub Actions run `32087027202` executed at substantive source head
`b0cdfee3578eb7aed11039d91f142516da54002e`. Writable DB job `95561575709` resolved both the
observed and expected project refs to `xskgrzbteyqdufktjrjx`, passed `pnpm test:db` with 7 tests
passed, 0 failed, and 0 skipped, and passed all T1 live suites. Receipt artifact `9307172976` was
accepted by verify job `95562787686`, which also passed the full static gate and Command Center
tests.

The authoring workstation remains `BLOCKED_DEFERRED` because its configured host is `127.0.0.1` and
cannot be identified as the staging project. The hosted receipt is the authoritative writable proof.
