# WORK-2026103020 — effective settlement timestamp

MERGE_SHA: 286ecb3bc20a1433bd3b7e353dbc69a359b82d07

Source: `286ecb3bc20a1433bd3b7e353dbc69a359b82d07`.

Pick Detail now projects Settled At from the effective settlement already resolved by the canonical identity reader. It does not use the pick lifecycle's timestamp or add a history request. Non-settled, absent and missing/invalid effective timestamps show the existing unknown marker.

Three source/test files changed: the existing identity projection helper, its registered tests, and the detail page's value binding. Lifecycle, authentication, write actions and correction-chain selection are unchanged.

Focused tests: 9 passed. Command Center suite: 741 passed. Mutation mapping the timestamp back to the pick row failed the three new behavior cases; restoration passed all 9 tests. Genuine isolated browser evidence is in qa-experience-report.md and desktop/mobile PNG plus AX files.

Repository verification passed all static stages, then its writable staging guard refused loopback. Exact-head CI staging verification remains required. No production acceptance or deployment is claimed; the real-pick fix waits for a separately authorized deployment.
