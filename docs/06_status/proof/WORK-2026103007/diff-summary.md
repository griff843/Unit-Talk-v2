# WORK-2026103007 — staging delivery proof preparation

Source: `80670e87765f770410702c62210f622d08791115`.

The API test uses the actual authenticated submission handler and Database repository bundle. It verifies persisted capper attribution/authorization, validated-to-queued lifecycle, one pinned official outbox, zero Track Only outbox, and a removed-allowlist configuration mutation refusing the request without another pick.

The worker test reads that capper-indexed fixture, retargets only its own pending row to a run namespace, and runs the real database-mode worker runner with a SIMULATED Discord adapter. It checks killed-before-claim, release of only the owned switch, atomic claim/confirm, one simulated receipt, posted lifecycle and a second idle cycle. Cleanup deletes only the owned kill-switch row after confirming actor ownership; all canonical fixture/history rows remain.

Both tests assert the exact approved staging host before client construction. Their root live-proof registration is behind the existing staging guard. Local direct runs safely skip, so no local real persistence, real Discord delivery or runtime PASS is claimed.

## Outstanding central decisions

- Run-namespaced targets intentionally skip the real worker dispatch ledger. The packet requires dispatch ledger rows as well, which is incompatible with that namespace boundary under current source. This proof does not fabricate ledger rows or remap repository semantics to pretend it ran a governed target. Central decision requested at #1811 comment 6530788773.
- Canonical DB-writer classifications live in docs/05_operations/db-writer-classification.json, outside this immutable scope. The direct inventory check reports the two missing classifications and their two registered script reachability errors. Central integration requested at #1811 comment 6530848328.

Claude requested branch-only push with no PR while coordinating the staging queue. No production data, target controls, permissions, delivery or deployment was touched.
