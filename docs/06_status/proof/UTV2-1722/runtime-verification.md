# PROOF: UTV2-1722

MERGE_SHA: 52e43d1ec2dcbe74b3de6af3bb41a2953d1257c0

ASSERTIONS:

- [x] The governance runtime contract is covered by static and focused regression gates.
- [x] The local writable-DB command was refused before mutation because the target cannot be attested as staging.
- [x] Hosted writable-DB verification remains delegated to the credential-gated `staging-ci` environment.

EVIDENCE:

```text
static gate: PASS
focused issue regressions: PASS (505 tests, 0 failed, 0 skipped)
local writable DB: BLOCKED_DEFERRED by target identity guard
production mutation performed: false
```

## Verification

This governance lane changes closeout automation and proof-verification contracts. It does not change application runtime, database schema, or production data.

## Static runtime-contract coverage

- Profile selection is manifest-authoritative and fails closed for unknown profiles.
- Migration and static evidence remain non-destructive during proof generation.
- Schema-v2 evidence never receives author-side verifier identity.
- The workflow evaluates the same working-tree bind that it persists, and persistence occurs only after the closeout gate passes.
- P10/R3 verifier provenance uses the shared, strategy-aware merged-PR attestation resolver for squash, rebase, and two-parent merges.
- Authentic historical bundles pass only with their matching attestations; stale, swapped, malformed, and unverifiable receipts fail closed by named code.

The required focused suite passed 505 tests with zero failures and zero skipped tests. The complete static gate also passed.

## Writable live-DB proof

`pnpm test:db` was executed and the staging identity guard refused the local target before any write-capable test ran:

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
```

Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.

No production mutation was performed, and no query or row-count evidence was fabricated. Hosted writable verification remains a `staging-ci` responsibility using `CI_SUPABASE_*` credentials.
