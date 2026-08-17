# PROOF: UTV2-1720

MERGE_SHA: f1eb161109286aab7d7e70300dac598a52ecf350

ASSERTIONS:

- This governance lane uses the schema-v2 `static` profile and does not claim successful writable-DB execution from an unidentified target.

EVIDENCE:

```text
runtime proof status: BLOCKED_DEFERRED
configured host: 127.0.0.1
required staging project: xskgrzbteyqdufktjrjx
production mutation performed: false
```

## Runtime verification

Source binding: `f1eb161109286aab7d7e70300dac598a52ecf350`.

This lane changes governance and CI closeout tooling; its declared schema-v2 proof profile is `static`. It does not change application runtime, database schema, or a DB-writing service. The shared contract therefore does not require fabricated runtime queries or monitored-table row counts.

Writable DB status is `BLOCKED_DEFERRED`, not PASS. `pnpm test:db` was stopped by the fail-closed staging identity guard before the node:test runner began:

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
```

Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.

No production mutation or live-channel action was performed. The authoritative writable-DB and full `pnpm verify` receipts must be produced by the PR’s `staging-ci` environment and independently bound to the exact head by required-check provenance.
